import { AssetCategory } from '../../models';

/**
 * Supported asset categories for Oanda provider
 */
export const SUPPORTED_CATEGORIES: AssetCategory[] = [
    'commodities',
    'indices',
    'metals'
    // Metals are included in the commodities category
];

/**
 * API configuration for Oanda
 */
export const API_CONFIG = {
    baseUrl: 'https://api-fxpractice.oanda.com/v3',
    endpoints: {
        pricing: '/accounts/{accountId}/pricing'
    },
    accountId: '101-004-15523510-001'
};

/**
 * Format a symbol name to Oanda format
 * @param symbol Original symbol from ALLOWED_ASSETS
 * @returns Symbol in Oanda format
 */
export function formatOandaSymbol(symbol: string): string {
    // If the symbol already contains an underscore, assume it's already in Oanda format
    if (symbol.includes('_')) {
        return symbol;
    }

    // Find the typical 3-letter currency code at the end
    if (symbol.length > 3) {
        const base = symbol.slice(0, -3);
        const quote = symbol.slice(-3);
        return `${base}_${quote}`;
    }

    return symbol;
}


export function getOriginalSymbol(instrument: string): string {
    // If the instrument doesn't contain an underscore, it's already in our format
    if (!instrument.includes('_')) {
        return instrument;
    }

    // Remove the underscore to convert back to our format
    return instrument.replace('_', '');
}
