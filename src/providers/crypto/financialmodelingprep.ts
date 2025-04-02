import axios, { AxiosResponse } from 'axios';
import CircuitBreaker from 'opossum';
import { BaseProvider, ErrorResponse, ProviderConnection } from '../provider';
import { createAsset, validateAsset, Asset, AssetCategory } from '../../models';

// FMP API response interfaces
interface FMPCryptoQuote {
    symbol: string;
    name?: string;
    price?: number;
    changesPercentage?: number;
    change?: number;
    dayLow?: number;
    dayHigh?: number;
    yearHigh?: number;
    yearLow?: number;
    marketCap?: number;
    priceAvg50?: number;
    priceAvg200?: number;
    volume?: number;
    avgVolume?: number;
    exchange?: string;
    open?: number;
    previousClose?: number;
    eps?: number;
    pe?: number;
    earningsAnnouncement?: string;
    sharesOutstanding?: number;
    timestamp?: number;
    [key: string]: any;
}

class FinancialModelingPrepCryptoProvider extends BaseProvider {
    private baseUrl: string;
    private circuitBreaker: CircuitBreaker<[string, Record<string, any>?], any>;

    constructor(category: AssetCategory, apiKey?: string) {
        super('financialmodelingprep', category, apiKey);
        this.baseUrl = 'https://financialmodelingprep.com/api/v3';

        // Set up circuit breaker for API calls
        this.circuitBreaker = new CircuitBreaker(this.makeApiRequest.bind(this), {
            timeout: 10000, // 10 seconds
            errorThresholdPercentage: 50,
            resetTimeout: 30000, // 30 seconds
            name: `fmp-${category}`
        });

        // Add circuit breaker event listeners
        this.circuitBreaker.on('open', () => {
            this.logger.warn('Circuit breaker opened', { category: this.category });
        });

        this.circuitBreaker.on('close', () => {
            this.logger.info('Circuit breaker closed', { category: this.category });
        });

        this.circuitBreaker.on('halfOpen', () => {
            this.logger.info('Circuit breaker half-open', { category: this.category });
        });
    }

    /**
     * Initialize the provider
     */
    async initialize(): Promise<void> {
        this.logger.info('Initializing FMP provider', { category: this.category });

        if (!this.apiKey) {
            throw new Error('FMP API key is required');
        }

        // Test connection
        try {
            await this.fetchAssets();
            this.initialized = true;
            this.logger.info('FMP provider initialized successfully', { category: this.category });
        } catch (error) {
            this.logger.error('Failed to initialize FMP provider', {
                error,
                category: this.category
            });
            throw error;
        }
    }

    /**
     * Make an API request with circuit breaker
     */
    async makeApiRequest(endpoint: string, params: Record<string, any> = {}): Promise<any> {
        const url = `${this.baseUrl}${endpoint}`;
        const requestParams = {
            ...params,
            apikey: this.apiKey
        };

        this.logger.debug('Making API request', {
            url,
            params: { ...requestParams, apikey: '[REDACTED]' }
        });

        const startTime = Date.now();

        try {
            const response: AxiosResponse = await axios.get(url, { params: requestParams });

            const duration = Date.now() - startTime;

            this.logger.debug('API request successful', {
                url,
                duration,
                status: response.status,
                dataSize: JSON.stringify(response.data).length
            });

            return response.data;
        } catch (error) {
            const duration = Date.now() - startTime;

            this.logger.error('API request failed', {
                error,
                url,
                duration,
                status: (error as any).response?.status,
                statusText: (error as any).response?.statusText,
                errorData: (error as any).response?.data
            });

            throw error;
        }
    }

    /**
     * Fetch all assets from FMP
     */
    async fetchAssets(): Promise<Asset[] | ErrorResponse> {
        try {
            let endpoint;

            switch (this.category) {
                case 'crypto':
                    endpoint = '/quotes/crypto';
                    break;
                case 'stocks':
                    endpoint = '/quotes/stock';
                    break;
                case 'forex':
                    endpoint = '/quotes/forex';
                    break;
                case 'indices':
                    endpoint = '/quotes/index';
                    break;
                case 'commodities':
                    endpoint = '/quotes/commodity';
                    break;
                default:
                    throw new Error(`Unsupported category: ${this.category}`);
            }

            const data: FMPCryptoQuote[] = await this.circuitBreaker.fire(endpoint);

            if (!Array.isArray(data)) {
                throw new Error(`Invalid response from FMP. Expected array, got: ${typeof data}`);
            }

            this.logger.info('Fetched assets from FMP', {
                category: this.category,
                count: data.length
            });

            // Transform to standard format
            const assets = this.transform(data);

            return assets;
        } catch (error) {
            return this.handleError(error as Error, 'fetchAssets', { category: this.category });
        }
    }

    /**
     * Fetch specific assets by symbols
     */
    async fetchBySymbols(symbols: string[]): Promise<Asset[] | ErrorResponse> {
        try {
            if (!symbols || symbols.length === 0) {
                return [];
            }

            let endpoint;
            const symbolsParam = symbols.join(',');

            switch (this.category) {
                case 'crypto':
                    endpoint = `/quote/${symbolsParam}`;
                    break;
                case 'stocks':
                    endpoint = `/quote/${symbolsParam}`;
                    break;
                case 'forex':
                    endpoint = `/quote/${symbolsParam}`;
                    break;
                case 'indices':
                    endpoint = `/quote/${symbolsParam}`;
                    break;
                case 'commodities':
                    endpoint = `/quote/${symbolsParam}`;
                    break;
                default:
                    throw new Error(`Unsupported category: ${this.category}`);
            }

            const data: FMPCryptoQuote | FMPCryptoQuote[] = await this.circuitBreaker.fire(endpoint);

            const dataArray: FMPCryptoQuote[] = Array.isArray(data) ? data : [data];

            this.logger.info('Fetched assets by symbols from FMP', {
                category: this.category,
                symbols,
                count: dataArray.length
            });

            // Transform to standard format
            const assets = this.transform(dataArray);

            return assets;
        } catch (error) {
            return this.handleError(error as Error, 'fetchBySymbols', {
                category: this.category,
                symbols
            });
        }
    }

    /**
     * Transform FMP data to standard format
     */
    transform(data: FMPCryptoQuote[]): Asset[] {
        try {
            const assets: Asset[] = data.map(item => {
                // Basic validation
                if (!item.symbol) {
                    this.logger.warn('Item missing symbol, skipping', { item });
                    return null;
                }

                let price = item.price;

                // If price is not available, try to find it in other fields
                if (price === undefined || price === null) {
                    price = item.currentPrice ||
                        item.regularMarketPrice ||
                        item.lastPrice ||
                        0;
                }

                // Create standard asset
                const asset = createAsset(
                    this.category,
                    item.symbol,
                    item.name || `${item.symbol} ${this.category}`,
                    price,
                    {
                        priceLow24h: item.dayLow || item.low || undefined,
                        priceHigh24h: item.dayHigh || item.high || undefined,
                        change24h: item.change || item.priceChange || undefined,
                        changePercent24h: item.changesPercentage || item.priceChangePercent || undefined,
                        volume24h: item.volume || undefined
                    }
                );

                // Validate the asset
                const { error } = validateAsset(asset);
                if (error) {
                    this.logger.warn('Invalid asset after transformation', {
                        error: error.message,
                        asset
                    });
                    return null;
                }

                return asset;
            }).filter((asset): asset is Asset => asset !== null); // Type guard to filter out nulls

            this.logger.debug('Transformed FMP data', {
                inputCount: data.length,
                outputCount: assets.length
            });

            return assets;
        } catch (error) {
            this.handleError(error as Error, 'transform', {
                dataSize: data.length
            });
            return [];
        }
    }
}

export default FinancialModelingPrepCryptoProvider;
