import axios, { AxiosResponse } from 'axios';
import WebSocket from 'ws';
import CircuitBreaker from 'opossum';
import { BaseProvider, ErrorResponse, ProviderConnection } from '../base';
import {
    Asset,
    AssetAdditionalData,
    AssetCategory,
    createAsset,
    validateAsset
} from '../../models';
import {
    API_CONFIG,
    SUPPORTED_CATEGORIES,
    WS_CONFIG,
    mapFromTwelvedataSymbol,
    mapToTwelvedataSymbol
} from './constants';
import { ALLOWED_ASSETS } from '../../constants';

/**
 * Shape of a single quote in a Twelvedata batch /quote response.
 *
 * Numeric fields arrive as strings on the wire; we coerce them at the
 * transform stage.
 */
interface TwelvedataQuote {
    symbol: string;
    name?: string;
    exchange?: string;
    mic_code?: string;
    currency?: string;
    datetime?: string;
    timestamp?: number;
    last_quote_at?: number;
    open?: string;
    high?: string;
    low?: string;
    close?: string;
    volume?: string;
    previous_close?: string;
    change?: string;
    percent_change?: string;
    average_volume?: string;
    is_market_open?: boolean;
    fifty_two_week?: {
        low?: string;
        high?: string;
        low_change?: string;
        high_change?: string;
        low_change_percent?: string;
        high_change_percent?: string;
        range?: string;
    };
    code?: number;
    message?: string;
    status?: string;
}

interface TwelvedataPriceMessage {
    event: 'price';
    symbol: string;
    currency_base?: string;
    currency_quote?: string;
    exchange?: string;
    type?: string;
    timestamp: number;
    price: number;
    bid?: number;
    ask?: number;
    day_volume?: number;
}

interface TwelvedataSubscribeStatus {
    event: 'subscribe-status' | 'unsubscribe-status';
    status: 'ok' | 'error';
    success?: Array<{ symbol: string; exchange?: string; type?: string }>;
    fails?: Array<{ symbol: string; reason?: string; ['fail_reason']?: string }> | null;
}

interface TwelvedataHeartbeatMessage {
    event: 'heartbeat';
    status: 'ok' | 'error';
}

type TwelvedataInbound =
    | TwelvedataPriceMessage
    | TwelvedataSubscribeStatus
    | TwelvedataHeartbeatMessage
    | { event: string; [k: string]: any };

/**
 * Maintain a directory of (twelvedataSymbol -> { internalSymbol, category })
 * so streamed price updates can be transformed without re-scanning the
 * allowed-assets table on every tick.
 */
interface SymbolDescriptor {
    internalSymbol: string;
    category: AssetCategory;
    displayName: string;
    tradingViewSymbol?: string;
}

class TwelvedataWebSocketConnection implements ProviderConnection {
    private ws: WebSocket | null = null;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private dataHandler: ((data: any) => void) | null = null;
    private statusHandler: ((data: any) => void) | null = null;
    private closeHandler: ((data: any) => void) | null = null;

    constructor(
        private readonly url: string,
        private readonly logger: any,
        private readonly onClose: (code: number, reason: string) => void
    ) {}

    public connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.url);

                this.ws.on('open', () => {
                    this.logger.info('Twelvedata WebSocket opened');
                    this.startHeartbeat();
                    resolve();
                });

                this.ws.on('message', (raw: WebSocket.Data) => {
                    this.handleMessage(raw);
                });

                this.ws.on('error', (err) => {
                    this.logger.error('Twelvedata WebSocket error', { error: err });
                    reject(err);
                });

                this.ws.on('close', (code, reason) => {
                    const reasonStr = reason?.toString() || '';
                    this.logger.warn('Twelvedata WebSocket closed', {
                        code,
                        reason: reasonStr
                    });
                    this.stopHeartbeat();

                    if (this.closeHandler) {
                        this.closeHandler({ code, reason: reasonStr });
                    }
                    this.onClose(code, reasonStr);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    public on(event: string, callback: (data: any) => void): void {
        if (event === 'data') {
            this.dataHandler = callback;
            return;
        }
        if (event === 'status') {
            this.statusHandler = callback;
            return;
        }
        if (event === 'close') {
            this.closeHandler = callback;
            return;
        }
    }

    public close(): void {
        this.stopHeartbeat();
        if (this.ws) {
            try {
                this.ws.close();
            } catch (err) {
                this.logger.warn('Error closing Twelvedata WebSocket', { error: err });
            }
            this.ws = null;
        }
    }

    public send(payload: Record<string, unknown>): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.logger.warn('Cannot send Twelvedata WS payload — socket not open', {
                readyState: this.ws?.readyState
            });
            return;
        }
        this.ws.send(JSON.stringify(payload));
    }

    public subscribe(symbols: string[]): void {
        if (symbols.length === 0) return;
        this.send({
            action: 'subscribe',
            params: { symbols: symbols.join(',') }
        });
    }

    public unsubscribe(symbols: string[]): void {
        if (symbols.length === 0) return;
        this.send({
            action: 'unsubscribe',
            params: { symbols: symbols.join(',') }
        });
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            this.send({ action: 'heartbeat' });
        }, WS_CONFIG.heartbeatInterval);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private handleMessage(raw: WebSocket.Data): void {
        let parsed: TwelvedataInbound;
        try {
            parsed = JSON.parse(raw.toString());
        } catch (err) {
            this.logger.warn('Failed to parse Twelvedata WS message', { error: err });
            return;
        }

        const event = (parsed as { event?: string }).event;

        if (event === 'price' && this.dataHandler) {
            this.dataHandler(parsed);
            return;
        }

        if (
            (event === 'subscribe-status' || event === 'unsubscribe-status') &&
            this.statusHandler
        ) {
            this.statusHandler(parsed);
            return;
        }

        if (event === 'heartbeat') {
            this.logger.debug('Twelvedata heartbeat ack');
            return;
        }
    }
}

class TwelvedataProvider extends BaseProvider {
    private readonly baseUrl: string;
    private readonly circuitBreaker: CircuitBreaker<
        [string, Record<string, any>?],
        any
    >;
    private lastApiRequest = 0;
    private reconnectAttempts = 0;
    private symbolDirectory: Map<string, SymbolDescriptor> = new Map();

    constructor(apiKey?: string) {
        super('twelvedata', SUPPORTED_CATEGORIES, apiKey);
        this.baseUrl = API_CONFIG.baseUrl;

        this.circuitBreaker = new CircuitBreaker(
            this.makeApiRequest.bind(this),
            {
                timeout: API_CONFIG.requestTimeoutMs,
                errorThresholdPercentage: 50,
                resetTimeout: 30_000,
                name: 'twelvedata-api'
            }
        );

        this.circuitBreaker.on('open', () =>
            this.logger.warn('Twelvedata circuit breaker opened')
        );
        this.circuitBreaker.on('close', () =>
            this.logger.info('Twelvedata circuit breaker closed')
        );
        this.circuitBreaker.on('halfOpen', () =>
            this.logger.info('Twelvedata circuit breaker half-open')
        );
    }

    async initialize(): Promise<void> {
        this.logger.info('Initializing Twelvedata provider');

        if (!this.apiKey) {
            throw new Error('Twelvedata API key is required');
        }

        try {
            const usage = await this.circuitBreaker.fire(
                API_CONFIG.endpoints.usage
            );

            this.logger.info('Twelvedata provider initialized successfully', {
                plan: usage?.plan_category,
                planLimit: usage?.plan_limit,
                planDailyLimit: usage?.plan_daily_limit,
                currentUsage: usage?.current_usage,
                dailyUsage: usage?.daily_usage
            });

            this.buildSymbolDirectory();
            this.initialized = true;
        } catch (err) {
            this.logger.error('Failed to initialize Twelvedata provider', { error: err });
            throw err;
        }
    }

    private async makeApiRequest(
        endpoint: string,
        params: Record<string, any> = {}
    ): Promise<any> {
        await this.respectRateLimit();

        const url = `${this.baseUrl}${endpoint}`;
        const requestParams = { ...params, apikey: this.apiKey };

        this.logger.debug('Twelvedata API request', {
            url,
            params: { ...requestParams, apikey: '[REDACTED]' }
        });

        const startedAt = Date.now();
        try {
            const response: AxiosResponse = await axios.get(url, {
                params: requestParams,
                timeout: API_CONFIG.requestTimeoutMs
            });

            this.lastApiRequest = Date.now();

            const data = response.data;

            // /quote with a single failing symbol returns { code, message, status:'error' }
            if (data && typeof data === 'object' && data.status === 'error') {
                throw new Error(
                    `Twelvedata error ${data.code ?? ''}: ${data.message ?? 'unknown error'}`
                );
            }

            this.logger.debug('Twelvedata API request OK', {
                url,
                duration: Date.now() - startedAt,
                status: response.status
            });

            return data;
        } catch (err) {
            this.logger.error('Twelvedata API request failed', {
                error: err,
                url,
                duration: Date.now() - startedAt,
                status: (err as any).response?.status
            });
            throw err;
        }
    }

    private async respectRateLimit(): Promise<void> {
        const elapsed = Date.now() - this.lastApiRequest;
        const min = API_CONFIG.minRequestSpacingMs;
        if (elapsed < min) {
            const wait = min - elapsed;
            await new Promise((resolve) => setTimeout(resolve, wait));
        }
    }

    /**
     * Resolve every internal allowed asset to its Twelvedata wire
     * symbol so we can quickly translate streamed updates back into
     * standard Asset records.
     */
    private buildSymbolDirectory(): void {
        this.symbolDirectory.clear();

        for (const category of this.supportedCategories) {
            for (const asset of ALLOWED_ASSETS[category]) {
                const wire = mapToTwelvedataSymbol(asset.name, category);
                if (!wire) continue;

                this.symbolDirectory.set(wire, {
                    internalSymbol: asset.name,
                    category,
                    displayName: asset.displayName ?? asset.name,
                    tradingViewSymbol: asset.tv_sym ?? undefined
                });
            }
        }

        this.logger.info('Built Twelvedata symbol directory', {
            entries: this.symbolDirectory.size
        });
    }

    async getAllAssets(): Promise<Asset[] | ErrorResponse> {
        try {
            const allWireSymbols = Array.from(this.symbolDirectory.keys());
            if (allWireSymbols.length === 0) {
                return [];
            }
            return await this.fetchQuotesForWireSymbols(allWireSymbols);
        } catch (err) {
            return this.handleError(err as Error, 'getAllAssets');
        }
    }

    async getAssetsByCategory(
        category: AssetCategory
    ): Promise<Asset[] | ErrorResponse> {
        try {
            if (!this.supportsCategory(category)) {
                return this.handleError(
                    new Error(`Category ${category} not supported by Twelvedata provider`),
                    'getAssetsByCategory',
                    { category }
                );
            }

            const wireSymbols: string[] = [];
            for (const asset of ALLOWED_ASSETS[category]) {
                const wire = mapToTwelvedataSymbol(asset.name, category);
                if (wire) wireSymbols.push(wire);
            }

            if (wireSymbols.length === 0) {
                this.logger.info('No mappable assets for category', { category });
                return [];
            }

            return await this.fetchQuotesForWireSymbols(wireSymbols, category);
        } catch (err) {
            return this.handleError(err as Error, 'getAssetsByCategory', { category });
        }
    }

    async getAssetsBySymbols(
        symbols: string[]
    ): Promise<Asset[] | ErrorResponse> {
        try {
            if (!symbols || symbols.length === 0) return [];

            const wireSymbols: string[] = [];

            for (const internal of symbols) {
                // Look up the descriptor by trying each supported category until found.
                for (const category of this.supportedCategories) {
                    const allowed = ALLOWED_ASSETS[category].some(
                        (a) => a.name === internal
                    );
                    if (!allowed) continue;

                    const wire = mapToTwelvedataSymbol(internal, category);
                    if (wire) wireSymbols.push(wire);
                    break;
                }
            }

            if (wireSymbols.length === 0) {
                this.logger.info('No mappable Twelvedata symbols in request', { symbols });
                return [];
            }

            return await this.fetchQuotesForWireSymbols(wireSymbols);
        } catch (err) {
            return this.handleError(err as Error, 'getAssetsBySymbols', { symbols });
        }
    }

    /**
     * Hit the /quote endpoint in chunks and return the merged set of
     * standardised assets. When a category is provided, the transform
     * is biased toward that category in case the same Twelvedata wire
     * symbol exists under multiple categories.
     */
    private async fetchQuotesForWireSymbols(
        wireSymbols: string[],
        category?: AssetCategory
    ): Promise<Asset[]> {
        const unique = Array.from(new Set(wireSymbols));
        const chunks: string[][] = [];
        for (let i = 0; i < unique.length; i += API_CONFIG.chunkSize) {
            chunks.push(unique.slice(i, i + API_CONFIG.chunkSize));
        }

        const allQuotes: TwelvedataQuote[] = [];

        for (const chunk of chunks) {
            try {
                const response = await this.circuitBreaker.fire(
                    API_CONFIG.endpoints.quote,
                    { symbol: chunk.join(',') }
                );

                if (!response) continue;

                if (Array.isArray(response)) {
                    allQuotes.push(...(response as TwelvedataQuote[]));
                } else if (
                    typeof response === 'object' &&
                    'symbol' in response
                ) {
                    // Single-symbol shape
                    allQuotes.push(response as TwelvedataQuote);
                } else if (typeof response === 'object') {
                    // Multi-symbol shape: { "AAPL": {...}, "BTC/USD": {...}, "GOOG": { code: 404, ... } }
                    for (const [wireSymbol, quote] of Object.entries(
                        response as Record<string, TwelvedataQuote>
                    )) {
                        if (!quote || typeof quote !== 'object') continue;
                        if (quote.status === 'error') {
                            this.logger.warn('Twelvedata quote returned error', {
                                symbol: wireSymbol,
                                code: quote.code,
                                message: quote.message
                            });
                            continue;
                        }
                        allQuotes.push({ ...quote, symbol: quote.symbol ?? wireSymbol });
                    }
                }
            } catch (err) {
                this.logger.error('Twelvedata quote chunk failed', {
                    error: err,
                    chunkSize: chunk.length
                });
            }
        }

        return this.transform(allQuotes, category);
    }

    /**
     * Transform a batch of Twelvedata quote objects to the standard
     * Asset shape used by the rest of the system.
     */
    transform(data: TwelvedataQuote[], category?: AssetCategory): Asset[] {
        if (!data || !Array.isArray(data) || data.length === 0) return [];

        const assets: Asset[] = [];

        for (const quote of data) {
            try {
                if (!quote || !quote.symbol) continue;

                const descriptor = this.resolveDescriptor(quote.symbol, category);
                if (!descriptor) {
                    this.logger.debug('No descriptor for Twelvedata symbol', {
                        wire: quote.symbol
                    });
                    continue;
                }

                const priceRaw =
                    quote.close ??
                    quote.previous_close ??
                    undefined;
                const price = priceRaw !== undefined ? Number(priceRaw) : NaN;
                if (!isFinite(price)) {
                    this.logger.debug('Skipping quote with non-finite price', {
                        symbol: quote.symbol
                    });
                    continue;
                }

                const additionalData: AssetAdditionalData = {};

                if (quote.low !== undefined) {
                    additionalData.priceLow24h = Number(quote.low);
                }
                if (quote.high !== undefined) {
                    additionalData.priceHigh24h = Number(quote.high);
                }
                if (quote.change !== undefined) {
                    additionalData.change24h = Number(quote.change);
                }
                if (quote.percent_change !== undefined) {
                    additionalData.changePercent24h = Number(quote.percent_change);
                }
                if (quote.volume !== undefined) {
                    additionalData.volume24h = Number(quote.volume);
                }
                if (descriptor.tradingViewSymbol) {
                    additionalData.tradingViewSymbol = descriptor.tradingViewSymbol;
                }

                const asset = createAsset(
                    descriptor.category,
                    descriptor.internalSymbol,
                    descriptor.displayName,
                    price,
                    additionalData
                );

                const { error } = validateAsset(asset);
                if (error) {
                    this.logger.warn('Invalid Twelvedata asset after transform', {
                        error: error.message,
                        symbol: descriptor.internalSymbol
                    });
                    continue;
                }

                assets.push(asset);
            } catch (err) {
                this.logger.error('Error transforming Twelvedata quote', {
                    error: err,
                    symbol: quote?.symbol
                });
            }
        }

        return assets;
    }

    /**
     * Map a Twelvedata wire symbol back to its (internal, category)
     * descriptor. When a hint category is given (typical for
     * getAssetsByCategory), prefer it so symbols that exist in
     * multiple categories (e.g. metals + commodities) map cleanly.
     */
    private resolveDescriptor(
        wireSymbol: string,
        hint?: AssetCategory
    ): SymbolDescriptor | undefined {
        if (hint) {
            const internal = mapFromTwelvedataSymbol(wireSymbol, hint);
            const allowed = ALLOWED_ASSETS[hint].find((a) => a.name === internal);
            if (allowed) {
                return {
                    internalSymbol: allowed.name,
                    category: hint,
                    displayName: allowed.displayName ?? allowed.name,
                    tradingViewSymbol: allowed.tv_sym ?? undefined
                };
            }
        }
        return this.symbolDirectory.get(wireSymbol);
    }

    async connectWebSocket(): Promise<ProviderConnection> {
        if (!this.apiKey) {
            throw new Error('Twelvedata API key is required for WebSocket');
        }

        if (this.symbolDirectory.size === 0) {
            this.buildSymbolDirectory();
        }

        const url = `${WS_CONFIG.baseUrl}?apikey=${encodeURIComponent(this.apiKey)}`;

        const connection = new TwelvedataWebSocketConnection(
            url,
            this.logger,
            (code, reason) => this.handleReconnection(code, reason)
        );

        await connection.connect();

        connection.on('status', (status: TwelvedataSubscribeStatus) => {
            const failedCount = Array.isArray(status.fails) ? status.fails.length : 0;
            this.logger.info('Twelvedata subscription status', {
                event: status.event,
                status: status.status,
                successCount: Array.isArray(status.success) ? status.success.length : 0,
                failedCount
            });
            if (failedCount > 0) {
                this.logger.warn('Twelvedata subscription failures', {
                    fails: status.fails
                });
            }
        });

        connection.on('data', (msg: TwelvedataPriceMessage) => {
            this.handlePriceTick(msg);
        });

        const wireSymbols = Array.from(this.symbolDirectory.keys());
        connection.subscribe(wireSymbols);
        this.logger.info('Twelvedata WebSocket subscribed', {
            symbolCount: wireSymbols.length
        });

        this.connection = connection;
        this.reconnectAttempts = 0;
        return connection;
    }

    async disconnectWebSocket(): Promise<void> {
        if (this.connection) {
            this.connection.close();
            this.connection = null;
        }
    }

    private handlePriceTick(msg: TwelvedataPriceMessage): void {
        try {
            if (!msg || !msg.symbol || typeof msg.price !== 'number') return;

            const descriptor = this.symbolDirectory.get(msg.symbol);
            if (!descriptor) return;

            const additionalData: AssetAdditionalData = {};
            if (descriptor.tradingViewSymbol) {
                additionalData.tradingViewSymbol = descriptor.tradingViewSymbol;
            }
            if (typeof msg.day_volume === 'number') {
                additionalData.volume24h = msg.day_volume;
            }

            const asset = createAsset(
                descriptor.category,
                descriptor.internalSymbol,
                descriptor.displayName,
                msg.price,
                additionalData
            );

            const { error } = validateAsset(asset);
            if (error) {
                this.logger.warn('Invalid streamed Twelvedata asset', {
                    error: error.message,
                    symbol: descriptor.internalSymbol
                });
                return;
            }

            const handlers = this.getEventHandlers('data');
            for (const handler of handlers) {
                handler([asset]);
            }
        } catch (err) {
            this.logger.error('Error processing Twelvedata price tick', {
                error: err,
                symbol: msg?.symbol
            });
        }
    }

    private async handleReconnection(code: number, reason: string): Promise<void> {
        if (this.reconnectAttempts >= WS_CONFIG.maxReconnectAttempts) {
            this.logger.error('Twelvedata WebSocket max reconnect attempts reached', {
                code,
                reason
            });
            return;
        }

        this.reconnectAttempts++;
        const delay = WS_CONFIG.reconnectDelay * Math.pow(1.5, this.reconnectAttempts);

        this.logger.info('Reconnecting Twelvedata WebSocket', {
            attempt: this.reconnectAttempts,
            delay,
            maxAttempts: WS_CONFIG.maxReconnectAttempts
        });

        setTimeout(async () => {
            try {
                await this.connectWebSocket();
            } catch (err) {
                this.logger.error('Twelvedata WebSocket reconnect failed', { error: err });
            }
        }, delay);
    }
}

export default TwelvedataProvider;
