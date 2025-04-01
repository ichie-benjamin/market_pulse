import { BaseProvider } from './base-provider';
import { Asset, AssetCategory, generateAssetId } from '../models/asset';
import { logger } from '../utils/logger';

// CoinCap API response interfaces
interface CoinCapAsset {
    id: string;
    rank: string;
    symbol: string;
    name: string;
    supply: string;
    maxSupply: string | null;
    marketCapUsd: string;
    volumeUsd24Hr: string;
    priceUsd: string;
    changePercent24Hr: string;
    vwap24Hr: string;
}

interface CoinCapApiResponse {
    data: CoinCapAsset | CoinCapAsset[];
    timestamp: number;
}

interface CoinCapWsUpdate {
    [key: string]: string;  // Symbol: price mapping
}

/**
 * CoinCap provider implementation
 */
export class CoinCapProvider extends BaseProvider {
    private assetMap: Map<string, Asset> = new Map();

    constructor(apiBaseUrl: string, wsUrl: string, apiKey?: string) {
        super(
            'coincap',
            AssetCategory.CRYPTOCURRENCY,
            apiBaseUrl,
            wsUrl,
            apiKey
        );
    }

    /**
     * Test API connection
     */
    protected async testApiConnection(): Promise<void> {
        try {
            const response = await this.apiClient.get('/assets?limit=1');
            if (!response.data || !response.data.data) {
                throw new Error('Invalid API response');
            }
        } catch (error) {
            logger.error('CoinCap API connection test failed:', error);
            throw new Error('CoinCap API connection failed');
        }
    }

    /**
     * Handle WebSocket message
     */
    protected handleWsMessage(message: string): void {
        try {
            // Parse the update data
            const update = JSON.parse(message) as CoinCapWsUpdate;

            // Process each symbol update
            Object.entries(update).forEach(([symbol, price]) => {
                // Convert the symbol to uppercase (CoinCap uses lowercase)
                const upperSymbol = symbol.toUpperCase();

                // Generate the asset ID
                const assetId = generateAssetId(upperSymbol, this.name, this.category);

                // Get the existing asset or create a basic one
                const existingAsset = this.assetMap.get(assetId);

                if (existingAsset) {
                    // Update the price
                    const newPrice = parseFloat(price);

                    // Calculate the change if we have previous price
                    let change24h = existingAsset.change24h;
                    if (existingAsset.price > 0) {
                        const priceDiff = newPrice - existingAsset.price;
                        // Update 24h change only if we have a previous price to compare
                        change24h = (priceDiff / existingAsset.price) * 100;
                    }

                    // Update the asset with new data
                    const updatedAsset: Asset = {
                        ...existingAsset,
                        price: newPrice,
                        change24h,
                        timestamp: new Date().toISOString()
                    };

                    // Store in memory and emit update
                    this.assetMap.set(assetId, updatedAsset);
                    this.emit('asset', updatedAsset);
                } else {
                    // If we don't have asset metadata, fetch it via API
                    this.fetchAsset(upperSymbol)
                        .then(asset => {
                            if (asset) {
                                // Store in memory and emit update
                                this.assetMap.set(asset.assetId, asset);
                                this.emit('asset', asset);
                            }
                        })
                        .catch(error => {
                            logger.error(`Error fetching asset metadata for ${upperSymbol}:`, error);
                        });
                }
            });
        } catch (error) {
            logger.error('Error handling CoinCap WebSocket message:', error);
        }
    }

    /**
     * Called when WebSocket connection is opened
     */
    protected onWsOpen(): void {
        logger.info('CoinCap WebSocket connected');

        // No specific auth needed after connection for CoinCap
        // The authentication is handled in the connection URL
    }

    /**
     * Get HTTP headers for API requests
     */
    protected getApiHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        return headers;
    }

    /**
     * Get WebSocket headers
     */
    protected getWsHeaders(): Record<string, string> {
        // CoinCap WebSocket doesn't require headers, authentication is in URL
        return {};
    }

    /**
     * Fetch asset data via API
     */
    public async fetchAsset(symbol: string): Promise<Asset | null> {
        try {
            // First, get all assets to find the ID
            const assets = await this.fetchAssets([symbol]);

            if (!assets.length) {
                logger.warn(`Asset not found: ${symbol}`);
                return null;
            }

            return assets[0];
        } catch (error) {
            logger.error(`Error fetching asset ${symbol}:`, error);
            return null;
        }
    }

    /**
     * Fetch multiple assets via API
     */
    public async fetchAssets(symbols?: string[]): Promise<Asset[]> {
        try {
            // First fetch the list to get IDs
            const response = await this.apiClient.get('/assets');

            if (!response.data || !response.data.data || !Array.isArray(response.data.data)) {
                throw new Error('Invalid API response');
            }

            let assets = response.data.data as CoinCapAsset[];

            // Filter by symbols if provided
            if (symbols && symbols.length > 0) {
                const symbolsUpper = symbols.map(s => s.toUpperCase());
                assets = assets.filter(a => symbolsUpper.includes(a.symbol.toUpperCase()));
            }

            // Transform to our unified asset format
            return assets.map(this.transformAsset.bind(this));
        } catch (error) {
            logger.error('Error fetching assets:', error);
            return [];
        }
    }

    /**
     * Transform CoinCap asset to unified format
     */
    private transformAsset(asset: CoinCapAsset): Asset {
        const symbol = asset.symbol.toUpperCase();
        const assetId = generateAssetId(symbol, this.name, this.category);

        const transformedAsset: Asset = {
            assetId,
            symbol,
            name: asset.name,
            category: this.category,
            provider: this.name,
            price: parseFloat(asset.priceUsd),
            change24h: parseFloat(asset.changePercent24Hr),
            volume24h: parseFloat(asset.volumeUsd24Hr),
            marketCap: parseFloat(asset.marketCapUsd),
            supply: parseFloat(asset.supply),
            maxSupply: asset.maxSupply ? parseFloat(asset.maxSupply) : undefined,
            timestamp: new Date().toISOString(),
            originalId: asset.id,
            metadata: {
                rank: parseInt(asset.rank, 10)
            }
        };

        // Update the in-memory map
        this.assetMap.set(assetId, transformedAsset);

        return transformedAsset;
    }
}
