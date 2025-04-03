import { AssetCategory } from '../../models';

/**
 * Supported asset categories for CEX.IO provider
 * CEX.IO only provides cryptocurrency data
 */
export const SUPPORTED_CATEGORIES: AssetCategory[] = [
    'crypto'
];

/**
 * WebSocket configuration for CEX.IO
 */
export const WS_CONFIG = {
    url: 'wss://trade.cex.io/api/spot/ws-public',
    pingInterval: 5000, // 5 seconds (less than their 10-second limit)
    reconnectDelay: 1000, // 1 second
    maxReconnectAttempts: 10
};

/**
 * API configuration for CEX.IO
 */
export const API_CONFIG = {
    baseUrl: 'https://trade.cex.io/api/spot/rest-public',
    endpoints: {
        getTicker: '/get_ticker'
    }
};

/**
 * Map our internal symbol format to CEX.IO's format
 * CEX.IO uses "BTC-USD" while we standardize on "BTCUSD"
 * @param symbol - Symbol in our internal format (e.g., "BTCUSD")
 * @returns Symbol in CEX.IO format (e.g., "BTC-USD")
 */
export function mapToCexioSymbol(symbol: string): string {
    // For crypto pairs, they generally follow a pattern of {CRYPTO}{FIAT}
    // We need to determine the split point, which is usually between crypto and fiat currencies
    // Common fiat currencies are USD, EUR, GBP, etc., usually 3 characters

    // Standard fiat currency lengths (most are 3 characters)
    const standardFiatLength = 3;

    // Simple case: if symbol length is longer than the standard fiat length
    // Assume the last standardFiatLength characters are the fiat currency
    if (symbol.length > standardFiatLength) {
        const base = symbol.slice(0, symbol.length - standardFiatLength);
        const quote = symbol.slice(symbol.length - standardFiatLength);
        return `${base}-${quote}`;
    }

    // If we can't determine, return as is
    return symbol;
}

/**
 * Map CEX.IO symbol format to our internal format
 * @param symbol - Symbol in CEX.IO format (e.g., "BTC-USD")
 * @returns Symbol in our internal format (e.g., "BTCUSD")
 */
export function mapFromCexioSymbol(symbol: string): string {
    return symbol.replace('-', '');
}
