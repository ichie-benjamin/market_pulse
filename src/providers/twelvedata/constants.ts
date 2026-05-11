import { AssetCategory } from '../../models';

/**
 * Supported asset categories for Twelvedata provider.
 *
 * Twelvedata covers the full spectrum we track. Indices quote endpoint
 * requires a paid plan (free/basic returns 403); the provider still
 * supports the category and surfaces the error gracefully when an
 * insufficient plan is detected.
 */
export const SUPPORTED_CATEGORIES: AssetCategory[] = [
    'crypto',
    'stocks',
    'forex',
    'indices',
    'commodities',
    'metals'
];

/**
 * REST API configuration.
 *
 * The /quote endpoint returns a rich payload (open/high/low/close,
 * volume, previous close, change, percent change, 52-week range,
 * is_market_open) for one or many comma-separated symbols.
 *
 * Each symbol consumes one API credit. The basic plan allows 8 credits
 * per minute and 800 per day; chunkSize and minRequestSpacingMs below
 * are tuned to stay safely below those limits.
 */
export const API_CONFIG = {
    baseUrl: 'https://api.twelvedata.com',
    endpoints: {
        quote: '/quote',
        price: '/price',
        usage: '/api_usage'
    },
    chunkSize: 60,
    minRequestSpacingMs: 250,
    requestTimeoutMs: 15000
};

/**
 * WebSocket streaming configuration.
 *
 * Subscribe payload:  { action: "subscribe",   params: { symbols: "AAPL,BTC/USD" } }
 * Heartbeat payload:  { action: "heartbeat" }
 * Price event:        { event: "price", symbol, price, timestamp, ... }
 *
 * Twelvedata closes idle sockets after ~30s without traffic; we send a
 * heartbeat well inside that window.
 */
export const WS_CONFIG = {
    baseUrl: 'wss://ws.twelvedata.com/v1/quotes/price',
    heartbeatInterval: 10_000,
    reconnectDelay: 1_000,
    maxReconnectAttempts: 10
};

/**
 * Explicit mapping from our internal indices symbols (OANDA-style) to
 * Twelvedata index tickers. Twelvedata uses short standard tickers
 * (SPX, DJI, NDX, ...) instead of the OANDA "BASE_QUOTE" form.
 *
 * Only entries that have a known Twelvedata equivalent are listed; any
 * internal symbol missing here is skipped at request time.
 */
export const INDEX_SYMBOL_MAP: Record<string, string> = {
    SPX500_USD: 'SPX',
    NAS100_USD: 'NDX',
    US30_USD: 'DJI',
    US2000_USD: 'RUT',
    DE30_EUR: 'DAX',
    UK100_GBP: 'UKX',
    FR40_EUR: 'CAC',
    EU50_EUR: 'SX5E',
    JP225_USD: 'N225',
    JP225Y_JPY: 'N225',
    HK33_HKD: 'HSI',
    AU200_AUD: 'AS51',
    CH20_CHF: 'SMI',
    ESPIX_EUR: 'IBEX',
    NL25_EUR: 'AEX',
    SG30_SGD: 'STI',
    CN50_USD: 'XIN9',
    CHINAH_HKD: 'HSCEI'
};

/**
 * Per-category symbol overrides for assets that do not have an exact
 * Twelvedata equivalent. These mappings point to the closest available
 * and quotable instrument on Twelvedata.
 */
const SYMBOL_OVERRIDES: Partial<Record<AssetCategory, Record<string, string>>> = {
    crypto: {
        EOSUSD: 'EOS/EUR',
        MKRUSD: 'MKR/INR'
    },
    stocks: {
        TWTR: 'META'
    },
    indices: {
        US30_USD: 'DIA',
        JP225Y_JPY: 'EWJ',
        JP225_USD: 'DXJ',
        CN50_USD: 'ASHR',
        EU50_EUR: 'FEZ',
        HK33_HKD: 'EWH',
        US2000_USD: 'IWM',
        CHINAH_HKD: 'FXI',
        AU200_AUD: 'EWA'
    },
    commodities: {
        XAG_HKD: 'XAG/TRY',
        WTICO_USD: 'WTI/USD',
        XAG_NZD: 'XAGG/USD',
        XAG_JPY: 'XAGG/EUR',
        BCO_USD: 'XBR/USD',
        XCU_USD: 'CPER',
        NATGAS_USD: 'UNG',
        CORN_USD: 'CORN',
        SOYBN_USD: 'SOYB',
        XAG_SGD: 'XAGG/TRY',
        WHEAT_USD: 'WEAT',
        SUGAR_USD: 'CANE'
    },
    metals: {
        XAG_HKD: 'XAG/TRY',
        XAG_NZD: 'XAGG/USD',
        XAG_JPY: 'XAGG/EUR',
        XCU_USD: 'CPER',
        XAG_SGD: 'XAGG/TRY'
    }
};

const REVERSE_SYMBOL_OVERRIDES: Partial<Record<AssetCategory, Record<string, string>>> =
    Object.entries(SYMBOL_OVERRIDES).reduce((acc, [category, map]) => {
        const reverse: Record<string, string> = {};
        Object.entries(map || {}).forEach(([internal, td]) => {
            // Keep first reverse mapping when multiple internals point to
            // the same Twelvedata symbol.
            if (!(td in reverse)) {
                reverse[td] = internal;
            }
        });
        acc[category as AssetCategory] = reverse;
        return acc;
    }, {} as Partial<Record<AssetCategory, Record<string, string>>>);

const INVERSE_INDEX_MAP: Record<string, string> = Object.entries(INDEX_SYMBOL_MAP)
    .reduce((acc, [internal, td]) => {
        // First mapping wins; we only need a deterministic reverse
        // lookup for streaming payloads.
        if (!(td in acc)) acc[td] = internal;
        return acc;
    }, {} as Record<string, string>);

/**
 * Categories whose internal symbols are dense (e.g. "BTCUSD",
 * "EURUSD") and whose Twelvedata symbols use a "BASE/QUOTE" form.
 */
const SLASHED_CATEGORIES: ReadonlySet<AssetCategory> = new Set([
    'crypto',
    'forex'
]);

/**
 * Categories whose internal symbols use an underscore
 * (e.g. "XAU_USD") that maps to "XAU/USD" on Twelvedata.
 */
const UNDERSCORED_CATEGORIES: ReadonlySet<AssetCategory> = new Set([
    'commodities',
    'metals'
]);

/**
 * Convert an internal symbol to the Twelvedata wire format.
 *
 * Returns null when the symbol cannot be expressed on Twelvedata
 * (e.g. an index without a mapping entry).
 */
export function mapToTwelvedataSymbol(
    symbol: string,
    category: AssetCategory
): string | null {
    const override = SYMBOL_OVERRIDES[category]?.[symbol];
    if (override) {
        return override;
    }

    if (category === 'indices') {
        return INDEX_SYMBOL_MAP[symbol] ?? null;
    }

    if (UNDERSCORED_CATEGORIES.has(category)) {
        return symbol.includes('_') ? symbol.replace('_', '/') : symbol;
    }

    if (SLASHED_CATEGORIES.has(category)) {
        if (symbol.includes('/')) return symbol;
        if (symbol.length > 3) {
            const base = symbol.slice(0, symbol.length - 3);
            const quote = symbol.slice(-3);
            return `${base}/${quote}`;
        }
        return symbol;
    }

    // stocks
    return symbol;
}

/**
 * Convert a Twelvedata wire-format symbol back to our internal format.
 */
export function mapFromTwelvedataSymbol(
    symbol: string,
    category: AssetCategory
): string {
    const reverseOverride = REVERSE_SYMBOL_OVERRIDES[category]?.[symbol];
    if (reverseOverride) {
        return reverseOverride;
    }

    if (category === 'indices') {
        return INVERSE_INDEX_MAP[symbol] ?? symbol;
    }

    if (UNDERSCORED_CATEGORIES.has(category)) {
        return symbol.replace('/', '_');
    }

    if (SLASHED_CATEGORIES.has(category)) {
        return symbol.replace('/', '');
    }

    return symbol;
}
