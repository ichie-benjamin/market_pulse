import Joi from 'joi';

// Define asset categories
export type AssetCategory = 'crypto' | 'stocks' | 'forex' | 'indices' | 'commodities';

// Define asset interface
export interface Asset {
    id: string;
    symbol: string;
    name: string;
    category: AssetCategory;
    price: number;
    priceLow24h?: number;
    priceHigh24h?: number;
    change24h?: number;
    changePercent24h?: number;
    volume24h?: number;
    lastUpdated: string;
}

// Define additional data interface
export interface AssetAdditionalData {
    priceLow24h?: number | string;
    priceHigh24h?: number | string;
    change24h?: number | string;
    changePercent24h?: number | string;
    volume24h?: number | string;
    [key: string]: any;
}

// Define asset stats interface
export interface AssetStats {
    count: number;
    categories: {
        [category: string]: {
            count: number;
            totalVolume: number;
            gainers: number;
            losers: number;
        };
    };
    oldestUpdate?: string;
    newestUpdate?: string;
    lastGenerated: string;
}

// Asset schema for validation - UPDATED to accept any numeric values
const assetSchema = Joi.object({
    id: Joi.string().required(),
    symbol: Joi.string().required(),
    name: Joi.string().required(),
    category: Joi.string().valid('crypto', 'stocks', 'forex', 'indices', 'commodities').required(),
    price: Joi.number().required(), // Allow any numeric value
    priceLow24h: Joi.number().optional(), // Allow any numeric value
    priceHigh24h: Joi.number().optional(), // Allow any numeric value
    change24h: Joi.number().optional(), // Allow any numeric value
    changePercent24h: Joi.number().optional(), // Allow any numeric value
    volume24h: Joi.number().optional(), // Allow any numeric value
    lastUpdated: Joi.string().isoDate().required()
});

/**
 * Create a standard asset object from provider data
 * @param category - Asset category
 * @param symbol - Asset symbol
 * @param name - Asset name
 * @param price - Current price
 * @param additionalData - Additional asset data
 * @returns Standardized asset object
 */
export function createAsset(
    category: AssetCategory,
    symbol: string,
    name: string,
    price: number | string,
    additionalData: AssetAdditionalData = {}
): Asset {
    // Generate a unique ID for the asset
    const id = `${category}-${symbol.toLowerCase()}`;

    // Create the base asset object
    const asset: Asset = {
        id,
        symbol: symbol.toUpperCase(),
        name,
        category,
        price: Number(price),
        lastUpdated: new Date().toISOString()
    };

    // Add additional data if provided
    if (additionalData.priceLow24h !== undefined) {
        asset.priceLow24h = Number(additionalData.priceLow24h);
    }

    if (additionalData.priceHigh24h !== undefined) {
        asset.priceHigh24h = Number(additionalData.priceHigh24h);
    }

    if (additionalData.change24h !== undefined) {
        asset.change24h = Number(additionalData.change24h);
    }

    if (additionalData.changePercent24h !== undefined) {
        asset.changePercent24h = Number(additionalData.changePercent24h);
    }

    if (additionalData.volume24h !== undefined) {
        asset.volume24h = Number(additionalData.volume24h);
    }

    return asset;
}

/**
 * Validate an asset object against the schema
 * @param asset - Asset object to validate
 * @returns Validation result
 */
export function validateAsset(asset: Asset): Joi.ValidationResult {
    return assetSchema.validate(asset);
}

/**
 * Generate statistics for a group of assets
 * @param assets - Array of asset objects
 * @returns Statistics object
 */
export function generateAssetStats(assets: Asset[]): AssetStats {
    if (!assets || assets.length === 0) {
        return {
            count: 0,
            categories: {},
            lastGenerated: new Date().toISOString()
        };
    }

    // Group assets by category
    const categories: {
        [category: string]: {
            count: number;
            totalVolume: number;
            gainers: number;
            losers: number;
        };
    } = {};

    let oldestUpdate = new Date();
    let newestUpdate = new Date(0);

    assets.forEach(asset => {
        // Track update times
        const updateTime = new Date(asset.lastUpdated);
        if (updateTime < oldestUpdate) {
            oldestUpdate = updateTime;
        }
        if (updateTime > newestUpdate) {
            newestUpdate = updateTime;
        }

        // Count by category
        if (!categories[asset.category]) {
            categories[asset.category] = {
                count: 0,
                totalVolume: 0,
                gainers: 0,
                losers: 0
            };
        }

        const cat = categories[asset.category];
        cat.count++;

        if (asset.volume24h) {
            cat.totalVolume += asset.volume24h;
        }

        if (asset.changePercent24h && asset.changePercent24h > 0) {
            cat.gainers++;
        } else if (asset.changePercent24h && asset.changePercent24h < 0) {
            cat.losers++;
        }
    });

    return {
        count: assets.length,
        categories,
        oldestUpdate: oldestUpdate.toISOString(),
        newestUpdate: newestUpdate.toISOString(),
        lastGenerated: new Date().toISOString()
    };
}
