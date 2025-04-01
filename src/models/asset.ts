/**
 * Asset categories
 */
export enum AssetCategory {
    CRYPTOCURRENCY = 'cryptocurrency',
    STOCK = 'stock',
    FOREX = 'forex',
    COMMODITY = 'commodity',
    INDEX = 'index'
}

/**
 * Unified asset data structure
 * This is the common format used throughout the application
 */
export interface Asset {
    // Core identification
    assetId: string;       // Unique identifier: {provider}_{category}_{symbol}
    symbol: string;        // Trading symbol (e.g., BTC, AAPL)
    name: string;          // Full name (e.g., Bitcoin, Apple Inc)
    category: AssetCategory; // Asset category
    provider: string;      // Data provider name

    // Market data
    price: number;         // Current price
    change24h: number;     // 24h price change (%)
    volume24h: number;     // 24h trading volume
    marketCap?: number;    // Market capitalization (if applicable)

    // Additional data
    high24h?: number;      // 24h high
    low24h?: number;       // 24h low
    supply?: number;       // Asset supply (for crypto)
    maxSupply?: number;    // Maximum supply (for crypto)
    exchange?: string;     // Exchange (for stocks)

    // Metadata
    timestamp: string;     // Data timestamp (ISO string)
    originalId?: string;   // Original ID from provider
    metadata?: Record<string, any>; // Additional provider-specific data
}

/**
 * Generate a unique asset ID
 */
export function generateAssetId(
    symbol: string,
    provider: string,
    category: AssetCategory | string
): string {
    return `${provider.toLowerCase()}_${category.toLowerCase()}_${symbol.toLowerCase()}`;
}

/**
 * Create a basic asset object with required fields
 */
export function createBasicAsset(
    symbol: string,
    provider: string,
    category: AssetCategory | string,
    name: string = symbol
): Asset {
    const assetId = generateAssetId(symbol, provider, category);

    return {
        assetId,
        symbol,
        name,
        category: category as AssetCategory,
        provider,
        price: 0,
        change24h: 0,
        volume24h: 0,
        timestamp: new Date().toISOString()
    };
}
