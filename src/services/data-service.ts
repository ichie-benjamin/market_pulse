import { Asset } from '../models/asset';
import { getProvider } from '../providers';
import { logger } from '../utils/logger';
import { storeAsset, getAsset } from './redis-service';

/**
 * Fetch asset data from provider and store in Redis
 */
export async function fetchAndStoreAsset(symbol: string): Promise<Asset | null> {
    try {
        const provider = getProvider();

        // Fetch asset data from provider
        const asset = await provider.fetchAsset(symbol);

        if (!asset) {
            logger.warn(`Asset not found: ${symbol}`);
            return null;
        }

        // Store in Redis
        await storeAsset(asset);

        logger.debug(`Fetched and stored asset: ${asset.assetId}`);
        return asset;
    } catch (error) {
        logger.error(`Error fetching asset ${symbol}:`, error);
        return null;
    }
}

/**
 * Fetch and store multiple assets
 */
export async function fetchAndStoreAssets(symbols?: string[]): Promise<Asset[]> {
    try {
        const provider = getProvider();

        // Fetch assets from provider
        const assets = await provider.fetchAssets(symbols);

        // Store each asset in Redis
        for (const asset of assets) {
            await storeAsset(asset);
        }

        logger.debug(`Fetched and stored ${assets.length} assets`);
        return assets;
    } catch (error) {
        logger.error('Error fetching assets:', error);
        return [];
    }
}

/**
 * Get asset data with optional refresh
 */
export async function getAssetData(
    assetId: string,
    refresh: boolean = false
): Promise<Asset | null> {
    try {
        // Try to get from Redis first
        let asset = await getAsset(assetId);

        // If not found or refresh requested, fetch from provider
        if (!asset || refresh) {
            // Parse the asset ID to get provider and symbol
            const [provider, category, symbol] = assetId.split('_');

            if (!provider || !symbol) {
                throw new Error(`Invalid asset ID: ${assetId}`);
            }

            // Check if provider matches active provider
            const activeProvider = getProvider();
            if (activeProvider.getName() !== provider) {
                throw new Error(`Provider mismatch: ${provider} vs ${activeProvider.getName()}`);
            }

            // Fetch fresh data
            asset = await fetchAndStoreAsset(symbol);
        }

        return asset;
    } catch (error) {
        logger.error(`Error getting asset data for ${assetId}:`, error);
        return null;
    }
}
