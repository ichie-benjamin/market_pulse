import axios from 'axios';
import { BaseProvider, ErrorResponse } from '../base';
import { Asset, AssetCategory, AssetAdditionalData, createAsset, validateAsset } from '../../models';
import { SUPPORTED_CATEGORIES, API_CONFIG, formatOandaSymbol } from './constants';
import { ALLOWED_ASSETS } from '../../constants';

/**
 * Interface for Oanda price response
 */
interface OandaPriceResponse {
    prices: OandaPrice[];
    time?: string;
}

/**
 * Interface for Oanda price data
 */
interface OandaPrice {
    instrument: string;
    type: string;
    time: string;
    status: string;
    bids: OandaPriceBucket[];
    asks: OandaPriceBucket[];
    closeoutBid: string;
    closeoutAsk: string;
    tradeable: boolean;
}

/**
 * Interface for Oanda price bucket
 */
interface OandaPriceBucket {
    price: string;
    liquidity: number;
}

/**
 * Oanda provider implementation
 * Focused on commodities (including metals) and indices
 */
class OandaProvider extends BaseProvider {
    /**
     * Initialize the provider
     */


    constructor(apiKey?: string) {
        super('oanda', SUPPORTED_CATEGORIES, apiKey);
    }

    async initialize(): Promise<void> {
        this.logger.info('Initializing Oanda provider');

        if (!this.apiKey) {
            throw new Error('Oanda API key (Bearer token) is required');
        }

        try {
            // Test connection with a minimal request
            // Choose a common asset from allowed assets list to test
            const testAsset = ALLOWED_ASSETS.commodities.length > 0 ? ALLOWED_ASSETS.commodities[0].name : 'GCUSD';
            const testInstrument = formatOandaSymbol(testAsset);

            await this.makeApiRequest([testInstrument]);
            this.initialized = true;
            this.logger.info('Oanda provider initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize Oanda provider', { error });
            throw error;
        }
    }

    /**
     * Make an API request to Oanda
     * @param instruments Array of Oanda instrument IDs
     * @returns Promise with the response data
     */
    private async makeApiRequest(instruments: string[]): Promise<OandaPriceResponse> {
        if (!instruments || instruments.length === 0) {
            throw new Error('No instruments specified for Oanda API request');
        }

        // Build URL with account ID
        const url = `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.pricing.replace('{accountId}', API_CONFIG.accountId)}`;

        // Build query parameters
        const params = {
            instruments: instruments.join(',')
        };

        this.logger.debug('Making Oanda API request', {
            url,
            instruments
        });

        try {
            const response = await axios.get(url, {
                params,
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Accept-Datetime-Format': 'RFC3339'
                }
            });

            this.logger.debug('Oanda API request successful', {
                status: response.status,
                instrumentCount: response.data?.prices?.length || 0
            });

            return response.data;
        } catch (error) {
            this.logger.error('Oanda API request failed', { error });
            throw error;
        }
    }


    async getAllAssets(): Promise<Asset[] | ErrorResponse> {
        try {
            this.logger.info('Fetching all assets from Oanda for supported categories');

            const allAssets: Asset[] = [];

            // Fetch assets for each supported category
            for (const category of SUPPORTED_CATEGORIES) {
                const categoryAssets = await this.getAssetsByCategory(category);

                // If we got an error response, continue to the next category
                if ('error' in categoryAssets) {
                    this.logger.warn(`Error fetching ${category} assets, continuing with other categories`, {
                        error: categoryAssets.error
                    });
                    continue;
                }

                // Add the assets to our collection
                allAssets.push(...categoryAssets);
            }

            this.logger.info('Successfully fetched all assets from Oanda', {
                totalAssets: allAssets.length
            });

            return allAssets;
        } catch (error) {
            return this.handleError(error as Error, 'getAllAssets');
        }
    }


    /**
     * Fetch assets for a specific category
     * @param category Asset category to fetch
     * @returns Promise with assets or error
     */
    async getAssetsByCategoryOld(category: AssetCategory): Promise<Asset[] | ErrorResponse> {
        try {
            if (!this.supportsCategory(category)) {
                return this.handleError(
                    new Error(`Category ${category} not supported by Oanda provider`),
                    'getAssetsByCategory',
                    { category }
                );
            }

            // Get allowed assets for this category
            const allowedAssets = ALLOWED_ASSETS[category];

            if (!allowedAssets || allowedAssets.length === 0) {
                this.logger.info('No allowed assets for category', { category });
                return [];
            }

            // Convert each asset name to Oanda format
            const oandaInstruments = allowedAssets.map(asset => formatOandaSymbol(asset.name));

            // Make API request for these instruments
            const response = await this.makeApiRequest(oandaInstruments);

            // Transform to standard format
            const assets = this.transform(response, category);

            this.logger.info(`Fetched ${category} assets from Oanda`, {
                category,
                requestedCount: oandaInstruments.length,
                receivedCount: assets.length
            });

            return assets;
        } catch (error) {
            return this.handleError(error as Error, 'getAssetsByCategory', { category });
        }
    }


    async getAssetsByCategory(category: AssetCategory): Promise<Asset[] | ErrorResponse> {
        try {
            this.logger.info(`OANDA: getAssetsByCategory called for ${category}`);

            if (!this.supportsCategory(category)) {
                this.logger.error(`OANDA: Category ${category} not supported!`);
                return this.handleError(
                    new Error(`Category ${category} not supported by Oanda provider`),
                    'getAssetsByCategory',
                    { category }
                );
            }

            // Get allowed assets for this category
            const allowedAssets = ALLOWED_ASSETS[category];

            this.logger.info(`OANDA: Found ${allowedAssets.length} allowed assets for ${category}`);

            if (!allowedAssets || allowedAssets.length === 0) {
                this.logger.info('No allowed assets for category', { category });
                return [];
            }

            // Convert each asset name to Oanda format
            const oandaInstruments = allowedAssets.map(asset => formatOandaSymbol(asset.name));

            this.logger.info(`OANDA: Making API request with ${oandaInstruments.length} instruments`, {
                sampleInstruments: oandaInstruments.slice(0, 5)
            });

            // Make API request for these instruments
            try {
                const response = await this.makeApiRequest(oandaInstruments);
                this.logger.info(`OANDA: API request successful`, {
                    receivedItems: response.prices?.length || 0
                });

                // Transform to standard format
                const assets = this.transform(response, category);

                this.logger.info(`OANDA: Transformed data for ${category}`, {
                    inputCount: response.prices?.length || 0,
                    outputCount: assets.length
                });

                return assets;
            } catch (apiError) {
                this.logger.error(`OANDA: API request failed`, {
                    error: apiError,
                    category
                });
                throw apiError;
            }
        } catch (error) {
            this.logger.error(`OANDA: Error in getAssetsByCategory`, {
                error: error,
            });
            return this.handleError(error as Error, 'getAssetsByCategory', { category });
        }
    }



    /**
     * Fetch assets by symbols
     * @param symbols Array of asset symbols to fetch
     * @returns Promise with assets or error
     */
    async getAssetsBySymbols(symbols: string[]): Promise<Asset[] | ErrorResponse> {
        try {
            if (!symbols || symbols.length === 0) {
                return [];
            }

            // Filter symbols to ones that belong to our supported categories
            const filteredSymbols = symbols.filter(symbol => {
                for (const category of SUPPORTED_CATEGORIES) {
                    if (ALLOWED_ASSETS[category].some(asset => asset.name === symbol)) {
                        return true;
                    }
                }
                return false;
            });

            if (filteredSymbols.length === 0) {
                this.logger.info('No supported symbols found in request', { symbols });
                return [];
            }

            // Convert each asset name to Oanda format
            const oandaInstruments = filteredSymbols.map(symbol => formatOandaSymbol(symbol));

            // Make API request for all instruments
            const response = await this.makeApiRequest(oandaInstruments);

            // Transform to standard format
            // We don't know the category for each symbol here, so we'll determine it in transform
            const assets = this.transform(response);

            this.logger.info('Fetched assets by symbols from Oanda', {
                requestedCount: symbols.length,
                filteredCount: filteredSymbols.length,
                receivedCount: assets.length
            });

            return assets;
        } catch (error) {
            return this.handleError(error as Error, 'getAssetsBySymbols', { symbols });
        }
    }

    /**
     * Transform Oanda data to standard asset format
     * @param data Oanda price response data
     * @param defaultCategory Default category to use if not determined otherwise
     * @returns Array of standardized assets
     */
    transform(data: OandaPriceResponse, defaultCategory?: AssetCategory): Asset[] {
        if (!data || !data.prices || !Array.isArray(data.prices) || data.prices.length === 0) {
            return [];
        }

        const assets: Asset[] = [];

        try {
            for (const priceItem of data.prices) {
                try {
                    // Skip non-tradeable instruments
                    if (!priceItem.tradeable) {
                        this.logger.debug('Skipping non-tradeable instrument', {
                            instrument: priceItem.instrument
                        });
                        continue;
                    }

                    // Get the original symbol from the Oanda instrument
                    // This is a reverse of formatOandaSymbol
                    const originalSymbol = priceItem.instrument.replace('_', '');

                    // Determine which category this symbol belongs to
                    let assetCategory = defaultCategory;
                    let assetInfo = null;

                    if (!assetCategory) {
                        // Try to find which category this symbol belongs to
                        for (const category of SUPPORTED_CATEGORIES) {
                            const found = ALLOWED_ASSETS[category].find(asset =>
                                formatOandaSymbol(asset.name) === priceItem.instrument
                            );

                            if (found) {
                                assetCategory = category;
                                assetInfo = found;
                                break;
                            }
                        }

                        // If we couldn't determine category, skip
                        if (!assetCategory) {
                            this.logger.debug('Unable to determine category for instrument, skipping', {
                                instrument: priceItem.instrument
                            });
                            continue;
                        }
                    }

                    // If we have a category but don't have asset info yet, find it
                    if (!assetInfo) {
                        assetInfo = ALLOWED_ASSETS[assetCategory].find(asset =>
                            formatOandaSymbol(asset.name) === priceItem.instrument
                        );
                    }

                    // If we still can't find the asset info, skip
                    if (!assetInfo) {
                        this.logger.debug('Asset not found in ALLOWED_ASSETS, skipping', {
                            instrument: priceItem.instrument,
                            category: assetCategory
                        });
                        continue;
                    }

                    // Calculate the mid price from bid and ask
                    const bestBid = parseFloat(priceItem.closeoutBid);
                    const bestAsk = parseFloat(priceItem.closeoutAsk);
                    const midPrice = (bestBid + bestAsk) / 2;

                    // Create additional data
                    const additionalData: AssetAdditionalData = {
                        // Add TradingView symbol if available
                        tradingViewSymbol: assetInfo.tv_sym || undefined
                    };

                    // Create standard asset
                    const asset = createAsset(
                        assetCategory,
                        assetInfo.name,
                        assetInfo.displayName || assetInfo.name,
                        midPrice,
                        additionalData
                    );

                    // Validate the asset
                    const { error } = validateAsset(asset);
                    if (error) {
                        this.logger.warn('Invalid asset after transformation', {
                            error: error.message,
                            instrument: priceItem.instrument,
                            symbol: assetInfo.name
                        });
                        continue;
                    }

                    assets.push(asset);
                } catch (error) {
                    this.logger.error('Error transforming Oanda price item', {
                        error,
                        instrument: priceItem.instrument
                    });
                }
            }

            this.logger.debug('Transformed Oanda data', {
                inputCount: data.prices.length,
                outputCount: assets.length
            });

            return assets;
        } catch (error) {
            this.logger.error('Error in transform method', { error });
            return [];
        }
    }
}

export default OandaProvider;
