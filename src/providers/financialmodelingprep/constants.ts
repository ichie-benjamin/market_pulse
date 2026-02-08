import { AssetCategory } from '../../models';

/**
 * Supported asset categories for Financial Modeling Prep provider
 */
export const SUPPORTED_CATEGORIES: AssetCategory[] = [
    // 'crypto',
    'stocks',
    'forex',
    // 'indices',
    // 'commodities'
];

/**
 * API endpoints for Financial Modeling Prep
 */
export const API_ENDPOINTS = {
    quote: '/stable/batch-quote',
    cryptoQuote: '/stable/batch-quote',
    stocksQuote: '/stable/batch-quote',
    forexQuote: '/stable/batch-quote',
    indicesQuote: '/stable/batch-quote',
    commoditiesQuote: '/stable/batch-quote'
};
