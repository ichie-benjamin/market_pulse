import { AssetCategory } from './models';

/**
 * Global allowed assets list
 * This controls which assets will be tracked across all providers
 */
export const ALLOWED_ASSETS: Record<AssetCategory, string[]> = {
    crypto: [
        'BTCUSD', 'ETHUSD', 'ADAUSD', 'XRPUSD', 'DOGEUSD',
        'LTCUSD', 'BCHUSD', 'DOTUSD', 'LINKUSD', 'BNBUSD',
        'SHIBUSD', 'SOLUSD', 'MATICUSD', 'AVAXUSD', 'XLMUSD'
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
