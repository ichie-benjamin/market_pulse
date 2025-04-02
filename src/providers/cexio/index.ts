import WebSocket from 'ws';
import { BaseProvider, ErrorResponse, ProviderConnection } from '../base';
import { Asset, AssetCategory, AssetAdditionalData } from '../../models';
import { createAsset, validateAsset } from '../../models';
import { SUPPORTED_CATEGORIES, WS_CONFIG, mapToCexioSymbol, mapFromCexioSymbol } from './constants';
import { ALLOWED_ASSETS } from '../../constants';

/**
 * CEX.IO WebSocket message formats
 */
interface CexioWebSocketMessage {
    e: string;
    oid?: string;
    ok?: string;
    data?: any;
    error?: string;
}

/**
 * CEX.IO ticker data format
 */
interface CexioTickerData {
    bestBid: string;
    bestAsk: string;
    bestBidChange: string;
    bestBidChangePercentage: string;
    bestAskChange: string;
    bestAskChangePercentage: string;
    volume30d: string;
    low: string;
    high: string;
    volume: string;
    quoteVolume: string;
    lastTradeVolume: string;
    last: string;
    lastTradePrice: string;
    priceChange: string;
    priceChangePercentage: string;
    lastTradeDateISO: string;
    volumeUSD: string;
}

/**
 * Custom WebSocket connection for CEX.IO
 */
class CexioWebSocketConnection implements ProviderConnection {
    private ws: WebSocket | null = null;
    private pingInterval: NodeJS.Timeout | null = null;
    private eventHandlers: Map<string, ((data: any) => void)[]> = new Map();
    private dataHandler: ((data: any) => void) | null = null;

    constructor(private url: string, private logger: any, private reconnectCallback: () => void) {}

    /**
     * Connect to CEX.IO WebSocket
     */
    public connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.url);

                this.ws.on('open', () => {
                    this.logger.info('WebSocket connection opened');
                    this.setupPingInterval();
                    resolve();
                });

                this.ws.on('message', (data: WebSocket.Data) => {
                    try {
                        const message = JSON.parse(data.toString()) as CexioWebSocketMessage;

                        // Handle pong response
                        if (message.e === 'pong') {
                            this.logger.debug('Received pong from CEX.IO');

                            // Dispatch to pong handlers if any
                            if (this.eventHandlers.has('pong')) {
                                const handlers = this.eventHandlers.get('pong') || [];
                                handlers.forEach(handler => handler(message));
                            }
                            return;
                        }

                        // Dispatch message to appropriate event handlers
                        const eventType = message.e;
                        if (eventType && this.eventHandlers.has(eventType)) {
                            const handlers = this.eventHandlers.get(eventType) || [];
                            handlers.forEach(handler => handler(message));
                        }

                        // If this is a ticker update, send to data handler
                        if (eventType === 'get_ticker' && message.ok === 'ok' && this.dataHandler) {
                            this.dataHandler(message);
                        }
                    } catch (error) {
                        this.logger.error('Error parsing WebSocket message:', { error, data: data.toString() });
                    }
                });

                this.ws.on('error', (error) => {
                    this.logger.error('WebSocket error:', { error });
                    reject(error);
                });

                this.ws.on('close', (code, reason) => {
                    this.logger.warn('WebSocket connection closed', { code, reason: reason.toString() });
                    this.clearPingInterval();
                    // Trigger reconnection callback
                    this.reconnectCallback();
                });
            } catch (error) {
                this.logger.error('Failed to create WebSocket connection', { error });
                reject(error);
            }
        });
    }

    /**
     * Register event handler
     */
    public on(event: string, callback: (data: any) => void): void {
        // Special handling for 'data' event which should be unique
        if (event === 'data') {
            this.dataHandler = callback;
            return;
        }

        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }

        const handlers = this.eventHandlers.get(event) || [];
        handlers.push(callback);
        this.eventHandlers.set(event, handlers);
    }

    /**
     * Close WebSocket connection
     */
    public close(): void {
        this.clearPingInterval();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Send message to WebSocket server
     */
    public send(message: any): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const messageStr = JSON.stringify(message);
            this.logger.debug('Sending WebSocket message', { message });
            this.ws.send(messageStr);
        } else {
            this.logger.warn('Cannot send message - WebSocket not open', { readyState: this.ws?.readyState });
        }
    }

    /**
     * Set up ping interval to keep connection alive
     */
    private setupPingInterval(): void {
        this.clearPingInterval();

        this.pingInterval = setInterval(() => {
            this.send({ e: 'ping' });
            this.logger.debug('Sent ping to CEX.IO');
        }, WS_CONFIG.pingInterval);
    }

    /**
     * Clear ping interval
     */
    private clearPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
}

/**
 * CEX.IO provider implementation
 */
class CexioProvider extends BaseProvider {
    private tickerRequestId = 1;
    private reconnectAttempts = 0;

    constructor(apiKey?: string) {
        super('cexio', SUPPORTED_CATEGORIES, apiKey);
    }

    /**
     * Initialize the provider
     */
    async initialize(): Promise<void> {
        this.logger.info('Initializing CEX.IO provider');

        try {
            await this.connectWebSocket();
            this.initialized = true;
            this.logger.info('CEX.IO provider initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize CEX.IO provider', { error });
            throw error;
        }
    }

    /**
     * Connect to CEX.IO WebSocket
     */
    async connectWebSocket(): Promise<ProviderConnection> {
        this.logger.info('Connecting to CEX.IO WebSocket');

        try {
            // Create WebSocket connection
            const connection = new CexioWebSocketConnection(
                WS_CONFIG.url,
                this.logger,
                // Reconnection callback
                () => this.handleReconnection()
            );

            // Connect to WebSocket server
            await connection.connect();

            // Set up event handlers
            connection.on('connected', (data) => {
                this.logger.info('Connected to CEX.IO WebSocket', { data });
                this.reconnectAttempts = 0;

                // Subscribe to ticker data for allowed crypto assets
                this.subscribeToTickers(connection);
            });

            connection.on('disconnected', (data) => {
                this.logger.warn('CEX.IO WebSocket disconnected', { data });
            });

            // Set up data handler to process ticker updates
            connection.on('data', (data) => {
                this.processTickerData(data);
            });

            // Store connection
            this.connection = connection;

            return connection;
        } catch (error) {
            this.logger.error('Failed to connect to CEX.IO WebSocket', { error });
            throw error;
        }
    }

    /**
     * Handle WebSocket reconnection
     */
    private async handleReconnection(): Promise<void> {
        if (this.reconnectAttempts >= WS_CONFIG.maxReconnectAttempts) {
            this.logger.error('Max reconnect attempts reached for CEX.IO WebSocket');
            return;
        }

        this.reconnectAttempts++;

        // Exponential backoff for reconnection attempts
        const delay = WS_CONFIG.reconnectDelay * Math.pow(1.5, this.reconnectAttempts);

        this.logger.info('Reconnecting to CEX.IO WebSocket', {
            attempt: this.reconnectAttempts,
            delay,
            maxAttempts: WS_CONFIG.maxReconnectAttempts
        });

        setTimeout(async () => {
            try {
                await this.connectWebSocket();
            } catch (error) {
                this.logger.error('Failed to reconnect to CEX.IO WebSocket', { error });
            }
        }, delay);
    }

    /**
     * Subscribe to tickers for allowed crypto assets
     */
    private subscribeToTickers(connection: CexioWebSocketConnection): void {
        // Get allowed crypto assets and convert to CEX.IO format
        const pairs = ALLOWED_ASSETS.crypto
            .filter(symbol => this.isSupportedSymbol(symbol))
            .map(symbol => mapToCexioSymbol(symbol));

        if (pairs.length === 0) {
            this.logger.warn('No allowed crypto assets for CEX.IO');
            return;
        }

        // Create request ID
        const requestId = `${Date.now()}_${this.tickerRequestId++}_get_ticker`;

        // Create subscription message
        const message: CexioWebSocketMessage = {
            e: 'get_ticker',
            oid: requestId,
            data: {
                pairs
            }
        };

        this.logger.info('Subscribing to CEX.IO tickers', {
            pairs,
            requestId
        });

        // Send subscription message
        connection.send(message);
    }

    /**
     * Check if a symbol is supported by CEX.IO
     * This could be expanded with a more complete list of supported symbols
     */
    private isSupportedSymbol(symbol: string): boolean {
        // Most common crypto assets on CEX.IO
        const supportedBaseAssets = ['BTC', 'ETH', 'XRP', 'ADA', 'DOGE', 'LTC', 'BCH', 'SOL', 'MATIC', 'SHIB'];

        // Most common fiat currencies on CEX.IO
        const supportedQuoteAssets = ['USD', 'EUR', 'GBP'];

        // Check if the symbol matches a supported pattern
        for (const base of supportedBaseAssets) {
            for (const quote of supportedQuoteAssets) {
                if (symbol === `${base}${quote}`) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Process ticker data from CEX.IO
     */
    private processTickerData(message: CexioWebSocketMessage): void {
        if (!message.data) {
            this.logger.warn('Received ticker message without data', { message });
            return;
        }

        try {
            // Transform ticker data to standard assets
            const assets = this.transform(message.data);

            if (assets.length > 0) {
                // Emit data event with transformed assets
                this.logger.debug('Processed CEX.IO ticker data', {
                    assetCount: assets.length
                });

                // This will be forwarded to the provider manager via the 'data' event
                if (this.connection) {
                    // Now we can use the getEventHandlers method from BaseProvider
                    const dataEventHandlers = this.getEventHandlers('data');
                    dataEventHandlers.forEach((handler: (data: any) => void) => handler(assets));
                }
            }
        } catch (error) {
            this.logger.error('Error processing CEX.IO ticker data', { error, data: message.data });
        }
    }

    /**
     * Disconnect WebSocket
     */
    async disconnectWebSocket(): Promise<void> {
        if (this.connection) {
            this.connection.close();
            this.connection = null;
        }
    }

    /**
     * Transform CEX.IO ticker data to standard assets
     */
    transform(data: Record<string, CexioTickerData>, category?: AssetCategory): Asset[] {
        const assets: Asset[] = [];

        // If specific category is requested, filter to that category
        const targetCategory: AssetCategory = category || 'crypto';

        // Process each ticker in the data
        for (const [cexioPair, ticker] of Object.entries(data)) {
            try {
                // Convert CEX.IO pair format to our internal format
                const internalSymbol = mapFromCexioSymbol(cexioPair);

                console.log('internalSymbol', internalSymbol)

                // Skip if not in our allowed assets list
                if (!ALLOWED_ASSETS[targetCategory].includes(internalSymbol)) {
                    continue;
                }

                // Create additional data with proper type handling
                const additionalData: AssetAdditionalData = {};

                if (ticker.low) {
                    additionalData.priceLow24h = ticker.low;
                }

                if (ticker.high) {
                    additionalData.priceHigh24h = ticker.high;
                }

                if (ticker.priceChange) {
                    additionalData.change24h = ticker.priceChange;
                }

                if (ticker.priceChangePercentage) {
                    additionalData.changePercent24h = ticker.priceChangePercentage;
                }

                if (ticker.volume) {
                    additionalData.volume24h = ticker.volume;
                }

                // Create standard asset using our internal symbol format
                const asset = createAsset(
                    targetCategory,
                    internalSymbol,
                    `${internalSymbol.slice(0, -3)} / ${internalSymbol.slice(-3)}`, // e.g., "BTC / USD"
                    ticker.last || ticker.lastTradePrice || '0',
                    additionalData
                );



                // Validate the asset
                const { error } = validateAsset(asset);
                if (error) {
                    this.logger.warn('Invalid asset after transformation', {
                        error: error.message,
                        pair: cexioPair,
                        symbol: internalSymbol
                    });
                    continue;
                }

                assets.push(asset);
            } catch (error) {
                this.logger.error('Error transforming CEX.IO ticker data', {
                    error,
                    pair: cexioPair
                });
            }
        }

        return assets;
    }

    /**
     * Fetch all allowed assets
     * Note: This is not used for WebSocket providers, but required by BaseProvider
     */
    async getAllAssets(): Promise<Asset[] | ErrorResponse> {
        // CEX.IO is WebSocket-based, so we don't fetch data via REST API
        // Instead, we return an empty array as this method isn't used
        return [];
    }

    /**
     * Fetch assets for a specific category
     * Note: This is not used for WebSocket providers, but required by BaseProvider
     */
    async getAssetsByCategory(category: AssetCategory): Promise<Asset[] | ErrorResponse> {
        // CEX.IO is WebSocket-based, so we don't fetch data via REST API
        // Instead, we return an empty array as this method isn't used
        return [];
    }

    /**
     * Fetch specific assets by symbols
     * Note: This is not used for WebSocket providers, but required by BaseProvider
     */
    async getAssetsBySymbols(symbols: string[]): Promise<Asset[] | ErrorResponse> {
        // CEX.IO is WebSocket-based, so we don't fetch data via REST API
        // Instead, we return an empty array as this method isn't used
        return [];
    }
}

export default CexioProvider;
