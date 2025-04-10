import axios, {AxiosResponse} from 'axios';
import CircuitBreaker from 'opossum';
import {BaseProvider, ErrorResponse} from '../base';
import {Asset, AssetAdditionalData, AssetCategory, createAsset, validateAsset} from '../../models';
import {API_ENDPOINTS, SUPPORTED_CATEGORIES} from './constants';

import {ALLOWED_ASSETS, getAllAllowedAssets} from '../../constants';

// FMP API response interfaces
interface FMPQuote {
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

class FinancialModelingPrepProvider extends BaseProvider {
    private baseUrl: string;
    private circuitBreaker: CircuitBreaker<[string, Record<string, any>?], any>;

    constructor(apiKey?: string) {
        super('financialmodelingprep', SUPPORTED_CATEGORIES, apiKey);
        this.baseUrl = 'https://financialmodelingprep.com/api/v3';

        // Set up circuit breaker for API calls
        this.circuitBreaker = new CircuitBreaker(this.makeApiRequest.bind(this), {
            timeout: 10000, // 10 seconds
            errorThresholdPercentage: 50,
            resetTimeout: 30000, // 30 seconds
            name: 'fmp-api'
        });

        // Add circuit breaker event listeners
        this.circuitBreaker.on('open', () => {
            this.logger.warn('Circuit breaker opened');
        });

        this.circuitBreaker.on('close', () => {
            this.logger.info('Circuit breaker closed');
        });

        this.circuitBreaker.on('halfOpen', () => {
            this.logger.info('Circuit breaker half-open');
        });
    }

    /**
     * Initialize the provider
     */
    async initialize(): Promise<void> {
        this.logger.info('Initializing FMP provider');

        if (!this.apiKey) {
            throw new Error('FMP API key is required');
        }

        // Test connection with a sample API call
        try {
            await this.circuitBreaker.fire('/quote/AAPL', { apikey: this.apiKey });
            this.initialized = true;
            this.logger.info('FMP provider initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize FMP provider', { error });
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
                status: response.status
            });

            return response.data;
        } catch (error) {
            const duration = Date.now() - startTime;

            this.logger.error('API request failed', {
                error,
                url,
                duration,
                status: (error as any).response?.status,
                statusText: (error as any).response?.statusText
            });

            throw error;
        }
    }

    /**
     * Fetch all allowed assets across supported categories
     */

    async getAllAssets(): Promise<Asset[] | ErrorResponse> {
        try {
            const allowedAssets = getAllAllowedAssets();

            if (allowedAssets.length === 0) {
                this.logger.info('No allowed assets configured');
                return [];
            }

            // Split into chunks of 20 symbols to avoid URL length limitations
            const chunkSize = 100;
            const chunks = [];

            for (let i = 0; i < allowedAssets.length; i += chunkSize) {
                chunks.push(allowedAssets.slice(i, i + chunkSize));
            }

            let allQuotes: FMPQuote[] = [];

            // Process each chunk
            for (const chunk of chunks) {
                const symbolsParam = chunk.join(',');
                const endpoint = `${API_ENDPOINTS.quote}${symbolsParam}`;

                const response = await this.circuitBreaker.fire(endpoint);

                if (!response) {
                    continue;
                }

                const quotes: FMPQuote[] | FMPQuote = response;
                const quotesArray: FMPQuote[] = Array.isArray(quotes) ? quotes : [quotes];

                allQuotes = [...allQuotes, ...quotesArray];
            }

            this.logger.info('Fetched all allowed assets from FMP', {
                requestedCount: allowedAssets.length,
                receivedCount: allQuotes.length
            });

            // Transform to standard format
            return this.transform(allQuotes);
        } catch (error) {
            return this.handleError(error as Error, 'getAllAssets');
        }
    }


    /**
     * Fetch assets for a specific category
     */
    async getAssetsByCategory(category: AssetCategory): Promise<Asset[] | ErrorResponse> {
        try {
            if (!this.supportsCategory(category)) {
                return this.handleError(
                    new Error(`Category ${category} not supported by this provider`),
                    'getAssetsByCategory',
                    { category }
                );
            }

            const allowedAssets = ALLOWED_ASSETS[category].map(asset => asset.name);

            if (!allowedAssets || allowedAssets.length === 0) {
                this.logger.info('No allowed assets for category', { category });
                return [];
            }

            // Create comma-separated list of symbols
            const symbolsParam = allowedAssets.join(',');

            // Use the quote endpoint directly with all symbols
            const endpoint = `${API_ENDPOINTS.quote}${symbolsParam}`;

            const response = await this.circuitBreaker.fire(endpoint);

            if (!response) {
                return [];
            }

            const quotes: FMPQuote[] | FMPQuote = response;
            const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

            this.logger.info(`Fetched ${category} assets from FMP`, {
                category,
                requestedCount: allowedAssets.length,
                receivedCount: quotesArray.length
            });

            // Transform to standard format with the specific category
            const assets = this.transform(quotesArray, category);

            return assets;
        } catch (error) {
            return this.handleError(error as Error, 'getAssetsByCategory', { category });
        }
    }

    /**
     * Fetch specific assets by symbols
     */
    async getAssetsBySymbols(symbols: string[]): Promise<Asset[] | ErrorResponse> {
        try {
            if (!symbols || symbols.length === 0) {
                return [];
            }

            // Filter to only allowed assets
            const allowedAssetsSet = new Set(getAllAllowedAssets());
            const filteredSymbols = symbols.filter(symbol => allowedAssetsSet.has(symbol));

            if (filteredSymbols.length === 0) {
                this.logger.info('No allowed assets in requested symbols');
                return [];
            }

            // Get data for filtered symbols
            const symbolsParam = filteredSymbols.join(',');
            const endpoint = `${API_ENDPOINTS.quote}${symbolsParam}`;

            const response = await this.circuitBreaker.fire(endpoint);

            if (!response) {
                return [];
            }

            const quotes: FMPQuote[] | FMPQuote = response;
            const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

            this.logger.info('Fetched assets by symbols from FMP', {
                requestedCount: symbols.length,
                allowedCount: filteredSymbols.length,
                receivedCount: quotesArray.length
            });

            // Transform to standard format
            const assets = this.transform(quotesArray);

            return assets;
        } catch (error) {
            return this.handleError(error as Error, 'getAssetsBySymbols', { symbols });
        }
    }

    /**
     * Transform FMP quote data to standard format
     */
    transform(data: FMPQuote[], category?: AssetCategory): Asset[] {
        if (!data || !Array.isArray(data) || data.length === 0) {
            return [];
        }

        try {
            const assets: Asset[] = [];

            for (const item of data) {
                // Skip if no symbol
                if (!item.symbol) {
                    this.logger.warn('Item missing symbol, skipping', { item });
                    continue;
                }

                // Determine category for this asset
                let assetCategory: AssetCategory | undefined;

                if (category) {
                    // Use provided category if specified
                    assetCategory = category;
                } else {
                    // Try to determine category from symbol
                    // For FMP, we rely on the allowed asset lists
                    for (const [cat, symbols] of Object.entries(ALLOWED_ASSETS)) {
                        if (symbols.some(asset => asset.name === item.symbol)) {
                            assetCategory = cat as AssetCategory;
                            break;
                        }
                    }

                    // If still not found, skip asset
                    if (!assetCategory) {
                        this.logger.debug('Unable to determine category for asset, skipping', { symbol: item.symbol });
                        continue;
                    }
                }

                // Find the allowed asset to get the display name
                const allowedAsset = ALLOWED_ASSETS[assetCategory].find(a => a.name === item.symbol);

                // Determine price with fallback to 0
                const price = typeof item.price === 'number' ? item.price :
                    typeof item.currentPrice === 'number' ? item.currentPrice :
                        typeof item.regularMarketPrice === 'number' ? item.regularMarketPrice :
                            typeof item.lastPrice === 'number' ? item.lastPrice :
                                0;

                // Fix for known problematic assets with extreme percentage values
                let changePercentage = typeof item.changesPercentage === 'number' ? item.changesPercentage : undefined;

                if (changePercentage !== undefined && Math.abs(changePercentage) > 1000) {
                    // Cap at +/-100%
                    this.logger.debug('Capping extreme percentage change', {
                        symbol: item.symbol,
                        originalValue: changePercentage,
                        cappedValue: Math.sign(changePercentage) * 100
                    });

                    changePercentage = Math.sign(changePercentage) * 100;
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
                    assetCategory,
                    item.symbol,
                    // Use display name from allowed assets if available, otherwise fallback to symbol name
                    allowedAsset?.displayName || item.name || `${item.symbol} ${assetCategory}`,
                    price,
                    additionalData
                );

                // Validate the asset
                const { error } = validateAsset(asset);
                if (error) {
                    this.logger.warn('Invalid asset after transformation', {
                        error: error.message,
                        symbol: item.symbol
                    });
                    continue;
                }

                assets.push(asset);
            }

            this.logger.debug('Transformed FMP data', {
                inputCount: data.length,
                outputCount: assets.length
            });

            return assets;
        } catch (error) {
            this.handleError(error as Error, 'transform', { dataSize: data.length });
            return [];
        }
    }
}

export default FinancialModelingPrepProvider;
