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
 * API endpoints for Financial Modeling Prep
 */
export const API_ENDPOINTS = {
    quote: '/quote/',
    cryptoQuote: '/quote',
    stocksQuote: '/quote',
    forexQuote: '/quote',
    indicesQuote: '/quote',
    commoditiesQuote: '/quote'
};
