import { AssetCategory } from '../../models';

/**
 * Supported asset categories for Financial Modeling Prep provider
 */
export const SUPPORTED_CATEGORIES: AssetCategory[] = [
    'crypto',
    'stocks',
    'forex',
    'indices',
    'commodities'
];

/**
 * Allowed assets per category for Financial Modeling Prep provider
 * This limits the assets we track to reduce API calls and storage requirements
 */
export const ALLOWED_ASSETS: Record<AssetCategory, string[]> = {
    crypto: [
        'BTCUSD', 'ETHUSD', 'XRPUSD', 'LTCUSD', 'BCHUSD', 'ADAUSD', 'DOTUSD', 'LINKUSD',
        'BNBUSD', 'DOGEUSD', 'UNIUSD', 'SOLUSD', 'MATICUSD', 'AVAXUSD', 'XLMUSD'
    ],
    stocks: [
        'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA', 'JPM', 'V', 'JNJ',
        'WMT', 'PG', 'MA', 'UNH', 'HD', 'BAC', 'XOM', 'PFE', 'CSCO', 'DIS'
    ],
    forex: [
        'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD',
        'EURJPY', 'GBPJPY', 'EURGBP'
    ],
    indices: [
        'SPY', 'QQQ', 'DIA', 'IWM', 'VTI', 'EFA', 'EEM', 'VGK', 'VPL', 'SPX',
        'NDX', 'DJI', 'RUT'
    ],
    commodities: [
        'GOLD', 'SILVER', 'COPPER', 'PLATINUM', 'PALLADIUM', 'CRUDE_OIL', 'NATURAL_GAS',
        'BRENT_OIL', 'CORN', 'WHEAT', 'COTTON', 'SUGAR', 'COFFEE'
    ]
};

/**
 * Get all allowed assets across all categories
 */
export function getAllAllowedAssets(): string[] {
    return Object.values(ALLOWED_ASSETS).flat();
}

/**
 * API endpoints for Financial Modeling Prep
 */
export const API_ENDPOINTS = {
    quote: '/quote/',
    cryptoQuote: '/quotes/crypto',
    stocksQuote: '/quotes/stock',
    forexQuote: '/quotes/forex',
    indicesQuote: '/quotes/index',
    commoditiesQuote: '/quotes/commodity'
};
