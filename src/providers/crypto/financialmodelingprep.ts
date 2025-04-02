import axios, { AxiosResponse } from 'axios';
import CircuitBreaker from 'opossum';
import { BaseProvider, ErrorResponse, ProviderConnection } from '../provider';
import { createAsset, validateAsset, Asset, AssetCategory, AssetAdditionalData } from '../../models';

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

                // Determine price with fallback to 0
                const price = typeof item.price === 'number' ? item.price :
                    typeof item.currentPrice === 'number' ? item.currentPrice :
                        typeof item.regularMarketPrice === 'number' ? item.regularMarketPrice :
                            typeof item.lastPrice === 'number' ? item.lastPrice :
                                0;

                // Fix for known problematic assets like LUAUSD with extreme changesPercentage values
                let changePercentage = typeof item.changesPercentage === 'number' ? item.changesPercentage : undefined;

                if (changePercentage !== undefined) {
                    // Check if it's an unusually large value that's likely incorrect
                    if (Math.abs(changePercentage) > 1000) {
                        // Apply a reasonable cap to percentage changes
                        this.logger.debug('Capping extreme percentage change', {
                            symbol: item.symbol,
                            originalValue: changePercentage,
                            cappedValue: Math.sign(changePercentage) * 100
                        });

                        // Cap at +/-100%
                        changePercentage = Math.sign(changePercentage) * 100;
                    }
                }

                // Create additional data with proper type handling
                const additionalData: AssetAdditionalData = {};

                // Only add properties if they have valid values
                if (typeof item.dayLow === 'number') {
                    additionalData.priceLow24h = item.dayLow;
                } else if (typeof item.low === 'number') {
                    additionalData.priceLow24h = item.low;
                }

                if (typeof item.dayHigh === 'number') {
                    additionalData.priceHigh24h = item.dayHigh;
                } else if (typeof item.high === 'number') {
                    additionalData.priceHigh24h = item.high;
                }

                if (typeof item.change === 'number') {
                    additionalData.change24h = item.change;
                } else if (typeof item.priceChange === 'number') {
                    additionalData.change24h = item.priceChange;
                }

                // Use our sanitized changePercentage value
                if (changePercentage !== undefined) {
                    additionalData.changePercent24h = changePercentage;
                } else if (typeof item.priceChangePercent === 'number') {
                    // Also check the other percent field for extreme values
                    if (Math.abs(item.priceChangePercent) > 1000) {
                        additionalData.changePercent24h = Math.sign(item.priceChangePercent) * 100;
                    } else {
                        additionalData.changePercent24h = item.priceChangePercent;
                    }
                }

                if (typeof item.volume === 'number') {
                    additionalData.volume24h = item.volume;
                }

                // Create standard asset
                const asset = createAsset(
                    this.category,
                    item.symbol,
                    item.name || `${item.symbol} ${this.category}`,
                    price, // price is always a number now
                    additionalData // all properties have explicit type checks
                );

                // Validate the asset
                const { error } = validateAsset(asset);
                if (error) {
                    this.logger.warn('Invalid asset after transformation', {
                        error: error.message,
                        symbol: item.symbol,
                        category: this.category
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
