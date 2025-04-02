import axios, { AxiosResponse } from 'axios';
import CircuitBreaker from 'opossum';
import { BaseProvider, ErrorResponse } from '../provider';
import { createAsset, validateAsset, Asset } from '../../models';

// FMP API response interfaces
interface FMPStockQuote {
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

interface FMPStockListItem {
    symbol: string;
    name: string;
    price: number;
    exchange: string;
    exchangeShortName: string;
    type: string;
}

class FinancialModelingPrepStocksProvider extends BaseProvider {
    private baseUrl: string;
    private circuitBreaker: CircuitBreaker<[string, Record<string, any>?], any>;

    constructor(apiKey?: string) {
        super('financialmodelingprep', 'stocks', apiKey);
        this.baseUrl = 'https://financialmodelingprep.com/api/v3';

        // Set up circuit breaker for API calls
        this.circuitBreaker = new CircuitBreaker(this.makeApiRequest.bind(this), {
            timeout: 10000, // 10 seconds
            errorThresholdPercentage: 50,
            resetTimeout: 30000, // 30 seconds
            name: 'fmp-stocks'
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
        this.logger.info('Initializing FMP stocks provider');

        if (!this.apiKey) {
            throw new Error('FMP API key is required');
        }

        // Test connection
        try {
            // Try to fetch a sample stock to test connection
            await this.circuitBreaker.fire('/quote/AAPL');
            this.initialized = true;
            this.logger.info('FMP stocks provider initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize FMP stocks provider', { error });
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
     * Fetch all assets from FMP
     */
    async fetchAssets(): Promise<Asset[] | ErrorResponse> {
        try {
            // For stocks, we'll use the stock/list endpoint to get all stocks
            // Then batch fetch the quotes for active stocks
            const allStocks: FMPStockListItem[] = await this.circuitBreaker.fire('/stock/list');

            if (!Array.isArray(allStocks)) {
                throw new Error(`Invalid response from FMP. Expected array, got: ${typeof allStocks}`);
            }

            // Filter to get active stocks (can adjust this as needed)
            const activeStocks = allStocks
                .filter(stock => stock.type === 'stock' && stock.exchange !== '')
                .slice(0, 100); // Limit to avoid rate limits in demo mode

            const symbols = activeStocks.map(stock => stock.symbol).join(',');

            if (!symbols) {
                return [];
            }

            // Get quotes for active stocks
            const quotes: FMPStockQuote[] | FMPStockQuote = await this.circuitBreaker.fire(`/quote/${symbols}`);

            const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

            this.logger.info('Fetched stock data from FMP', {
                totalStocks: allStocks.length,
                activeStocks: activeStocks.length,
                quotesReceived: quotesArray.length
            });

            // Transform to standard format
            const assets = this.transform(quotesArray);

            return assets;
        } catch (error) {
            return this.handleError(error as Error, 'fetchAssets');
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

            const symbolsString = symbols.join(',');
            const data: FMPStockQuote[] | FMPStockQuote = await this.circuitBreaker.fire(`/quote/${symbolsString}`);

            // Ensure we always have an array
            const quotesArray = Array.isArray(data) ? data : [data];

            this.logger.info('Fetched stocks by symbols from FMP', {
                requestedSymbols: symbols.length,
                receivedQuotes: quotesArray.length
            });

            // Transform to standard format
            const assets = this.transform(quotesArray);

            return assets;
        } catch (error) {
            return this.handleError(error as Error, 'fetchBySymbols', { symbols });
        }
    }

    /**
     * Transform FMP stock data to standard format
     */
    transform(data: FMPStockQuote[]): Asset[] {
        try {
            const assets: Asset[] = data.map(stock => {
                // Skip if no symbol or invalid data
                if (!stock.symbol) {
                    this.logger.warn('Stock missing symbol, skipping', { stock });
                    return null;
                }

                // Create standard asset
                const asset = createAsset(
                    'stocks',
                    stock.symbol,
                    stock.name || `${stock.symbol} Stock`,
                    stock.price || stock.currentPrice || 0,
                    {
                        priceLow24h: stock.dayLow || 0,
                        priceHigh24h: stock.dayHigh || 0,
                        change24h: stock.change || 0,
                        changePercent24h: stock.changesPercentage || 0,
                        volume24h: stock.volume || 0
                    }
                );

                // Validate the asset
                const { error } = validateAsset(asset);
                if (error) {
                    this.logger.warn('Invalid stock asset after transformation', {
                        error: error.message,
                        asset
                    });
                    return null;
                }

                return asset;
            }).filter((asset): asset is Asset => asset !== null); // Type guard to filter out nulls

            this.logger.debug('Transformed FMP stock data', {
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

export default FinancialModelingPrepStocksProvider;
