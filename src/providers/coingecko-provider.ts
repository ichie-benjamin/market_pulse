import { BaseProvider } from './base-provider';
import { Asset, AssetCategory, generateAssetId, createBasicAsset } from '../models/asset';
import { logger } from '../utils/logger';

// CoinGecko API response interfaces
interface CoinGeckoAsset {
    id: string;
    symbol: string;
    name: string;
    image?: string;
    current_price: number;
    market_cap: number;
    market_cap_rank: number;
    fully_diluted_valuation?: number;
    total_volume: number;
    high_24h: number;
    low_24h: number;
    price_change_24h: number;
    price_change_percentage_24h: number;
    market_cap_change_24h: number;
    market_cap_change_percentage_24h: number;
    circulating_supply: number;
    total_supply?: number;
    max_supply?: number;
    ath: number;
    ath_change_percentage: number;
    ath_date: string;
    atl: number;
    atl_change_percentage: number;
    atl_date: string;
    last_updated: string;
}

interface CoinGeckoPriceUpdate {
    [key: string]: {
        usd: number;
        usd_24h_change?: number;
        usd_24h_vol?: number;
    };
}

/**
 * CoinGecko provider implementation
 */
export class CoinGeckoProvider extends BaseProvider {
    private assetMap: Map<string, Asset> = new Map();
    private coinIdMap: Map<string, string> = new Map(); // Maps symbol to coin ID

    constructor(apiBaseUrl: string, wsUrl: string, apiKey?: string) {
        super(
            'coingecko',
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
            const response = await this.apiClient.get('/ping');
            
            if (!response.data || response.data.gecko_says !== '(V3) To the Moon!') {
                throw new Error('Invalid API response');
            }
        } catch (error) {
            logger.error('CoinGecko API connection test failed:', error);
            throw new Error('CoinGecko API connection failed');
        }
    }

    /**
     * Handle WebSocket message
     */
    protected handleWsMessage(message: string): void {
        try {
            // Parse the update data
            const update = JSON.parse(message) as CoinGeckoPriceUpdate;

            // Process each coin update
            Object.entries(update).forEach(([coinId, priceData]) => {
                // Get the symbol from our mapping
                const symbol = this.getSymbolFromCoinId(coinId);
                if (!symbol) {
                    // Skip this update if we don't have the symbol mapped
                    return;
                }

                const upperSymbol = symbol.toUpperCase();
                const assetId = generateAssetId(upperSymbol, this.name, this.category);
                
                // Get the existing asset or create a basic one
                const existingAsset = this.assetMap.get(assetId);
                
                if (existingAsset) {
                    // Update the price
                    const newPrice = priceData.usd;
                    
                    // Get change from the update or use existing
                    const change24h = priceData.usd_24h_change !== undefined 
                        ? priceData.usd_24h_change 
                        : existingAsset.change24h;
                    
                    // Get volume from the update or use existing
                    const volume24h = priceData.usd_24h_vol !== undefined 
                        ? priceData.usd_24h_vol 
                        : existingAsset.volume24h;
                    
                    // Update the asset with new data
                    const updatedAsset: Asset = {
                        ...existingAsset,
                        price: newPrice,
                        change24h: change24h,
                        volume24h: volume24h,
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
            logger.error('Error handling CoinGecko WebSocket message:', error);
        }
    }

    /**
     * Called when WebSocket connection is opened
     */
    protected onWsOpen(): void {
        logger.info('CoinGecko WebSocket connected');
        
        // CoinGecko WebSocket may require subscription to specific channels
        // This would be implemented here if needed
    }

    /**
     * Get HTTP headers for API requests
     */
    protected getApiHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        
        if (this.apiKey) {
            headers['x-cg-pro-api-key'] = this.apiKey;
        }
        
        return headers;
    }

    /**
     * Get WebSocket headers
     */
    protected getWsHeaders(): Record<string, string> {
        // CoinGecko WebSocket headers
        return {};
    }

    /**
     * Fetch asset data via API
     */
    public async fetchAsset(symbol: string): Promise<Asset | null> {
        try {
            // CoinGecko requires the coin ID for single asset fetch
            let coinId = this.getCoinIdForSymbol(symbol);
            
            if (!coinId) {
                // If we don't have the ID mapped yet, get the list of coins first
                await this.buildCoinIdMap();
                coinId = this.getCoinIdForSymbol(symbol);
                
                if (!coinId) {
                    logger.warn(`Asset not found: ${symbol}`);
                    return null;
                }
            }
            
            // Fetch the coin data
            const response = await this.apiClient.get(`/coins/${coinId}`, {
                params: {
                    localization: false,
                    tickers: false,
                    market_data: true,
                    community_data: false,
                    developer_data: false,
                    sparkline: false
                }
            });
            
            if (!response.data) {
                throw new Error('Invalid API response');
            }
            
            // Convert to our unified format
            const asset = this.transformAssetDetail(response.data);
            return asset;
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
            // Fetch market data for coins
            const response = await this.apiClient.get('/coins/markets', {
                params: {
                    vs_currency: 'usd',
                    order: 'market_cap_desc',
                    per_page: 250,
                    page: 1,
                    sparkline: false,
                    price_change_percentage: '24h'
                }
            });
            
            if (!response.data || !Array.isArray(response.data)) {
                throw new Error('Invalid API response');
            }
            
            let assets = response.data as CoinGeckoAsset[];
            
            // Update the coin ID mapping
            this.updateCoinIdMap(assets);
            
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
     * Transform CoinGecko asset to unified format
     */
    private transformAsset(asset: CoinGeckoAsset): Asset {
        const symbol = asset.symbol.toUpperCase();
        const assetId = generateAssetId(symbol, this.name, this.category);
        
        const transformedAsset: Asset = {
            assetId,
            symbol,
            name: asset.name,
            category: this.category,
            provider: this.name,
            price: asset.current_price,
            change24h: asset.price_change_percentage_24h,
            volume24h: asset.total_volume,
            marketCap: asset.market_cap,
            high24h: asset.high_24h,
            low24h: asset.low_24h,
            supply: asset.circulating_supply,
            maxSupply: asset.max_supply,
            timestamp: new Date().toISOString(),
            originalId: asset.id,
            metadata: {
                rank: asset.market_cap_rank,
                image: asset.image
            }
        };
        
        // Update the in-memory map
        this.assetMap.set(assetId, transformedAsset);
        
        return transformedAsset;
    }

    /**
     * Transform detailed coin data to unified format
     */
    private transformAssetDetail(data: any): Asset {
        const symbol = data.symbol.toUpperCase();
        const assetId = generateAssetId(symbol, this.name, this.category);
        
        const transformedAsset: Asset = {
            assetId,
            symbol,
            name: data.name,
            category: this.category,
            provider: this.name,
            price: data.market_data.current_price.usd,
            change24h: data.market_data.price_change_percentage_24h,
            volume24h: data.market_data.total_volume.usd,
            marketCap: data.market_data.market_cap.usd,
            high24h: data.market_data.high_24h.usd,
            low24h: data.market_data.low_24h.usd,
            supply: data.market_data.circulating_supply,
            maxSupply: data.market_data.max_supply,
            timestamp: new Date().toISOString(),
            originalId: data.id,
            metadata: {
                rank: data.market_data.market_cap_rank,
                image: data.image?.large
            }
        };
        
        // Update the in-memory map
        this.assetMap.set(assetId, transformedAsset);
        
        return transformedAsset;
    }

    /**
     * Build a mapping of symbol to coin ID
     */
    private async buildCoinIdMap(): Promise<void> {
        try {
            const response = await this.apiClient.get('/coins/list');
            
            if (!response.data || !Array.isArray(response.data)) {
                throw new Error('Invalid API response');
            }
            
            // Clear the current map
            this.coinIdMap.clear();
            
            // Build the mapping
            response.data.forEach((coin: { id: string; symbol: string; name: string }) => {
                this.coinIdMap.set(coin.symbol.toUpperCase(), coin.id);
            });
            
            logger.debug(`Built CoinGecko ID map with ${this.coinIdMap.size} coins`);
        } catch (error) {
            logger.error('Error building coin ID map:', error);
        }
    }
    
    /**
     * Update coin ID mapping from market data
     */
    private updateCoinIdMap(assets: CoinGeckoAsset[]): void {
        assets.forEach(asset => {
            this.coinIdMap.set(asset.symbol.toUpperCase(), asset.id);
        });
    }
    
    /**
     * Get coin ID for a symbol
     */
    private getCoinIdForSymbol(symbol: string): string | undefined {
        return this.coinIdMap.get(symbol.toUpperCase());
    }
    
    /**
     * Get symbol from coin ID (reverse lookup)
     */
    private getSymbolFromCoinId(coinId: string): string | undefined {
        for (const [symbol, id] of this.coinIdMap.entries()) {
            if (id === coinId) {
                return symbol;
            }
        }
        return undefined;
    }
}