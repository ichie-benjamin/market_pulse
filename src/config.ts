import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Parse comma-separated values into arrays
const parseArrayValue = (value: string | undefined, defaultValue: string[] = []): string[] => {
    if (!value) return defaultValue;
    return value.split(',').map(item => item.trim()).filter(Boolean);
};

// Provider connection method type
export type ProviderConnectionMethod = 'websocket' | 'api';

// Application config
export const config = {
    app: {
        env: process.env.NODE_ENV || 'development',
        port: parseInt(process.env.PORT || '3000', 10),
        logLevel: process.env.LOG_LEVEL || 'info'
    },

    // Redis config
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        keyPrefix: 'market_data:',
        dataTtl: parseInt(process.env.REDIS_DATA_TTL || '3600', 10),
        // Redis channel names for pub/sub
        channels: {
            dataUpdates: 'market_data:updates'
        }
    },

    // WebSocket config
    websocket: {
        port: parseInt(process.env.WS_PORT || '3000', 10),
        path: process.env.WS_PATH || '/market-data'
    },

    // Security config
    security: {
        apiKeys: parseArrayValue(process.env.API_KEYS, ['dev_test_key'])
    },

    // Provider config
    providers: {
        // Active provider selection
        activeProvider: process.env.ACTIVE_PROVIDER || 'financialmodelingprep',

        // Connection method preference
        connectionMethod: (process.env.PROVIDER_CONNECTION_METHOD || 'websocket') as ProviderConnectionMethod,

        // CoinCap config
        coincap: {
            apiKey: process.env.COINCAP_API_KEY,
            apiBaseUrl: 'https://api.coincap.io/v2',
            wsUrl: process.env.COINCAP_WS_URL || 'wss://ws.coincap.io/prices?assets=ALL'
        },

        // CoinGecko config
        coingecko: {
            apiKey: process.env.COINGECKO_API_KEY,
            apiBaseUrl: 'https://api.coingecko.com/api/v3',
            wsUrl: process.env.COINGECKO_WS_URL || 'wss://ws.coingecko.com/cryptocurrency'
        },
        
        // Financial Modeling Prep config
        financialmodelingprep: {
            apiKey: process.env.FMP_API_KEY,
            apiBaseUrl: 'https://financialmodelingprep.com',
            cryptoWsUrl: process.env.FMP_CRYPTO_WS_URL || 'wss://crypto.financialmodelingprep.com',
            forexWsUrl: process.env.FMP_FOREX_WS_URL || 'wss://forex.financialmodelingprep.com'
        },

        // Alpaca config
        // alpaca: {
        //     apiKey: process.env.ALPACA_API_KEY,
        //     apiSecret: process.env.ALPACA_API_SECRET,
        //     apiBaseUrl: 'https://api.alpaca.markets/v2',
        //     wsUrl: process.env.ALPACA_WS_URL || 'wss://stream.data.alpaca.markets/v2/iex'
        // }
    },

    // Asset categories to track
    assetCategories: parseArrayValue(process.env.ASSET_CATEGORIES, ['cryptocurrency', 'stock'])
};
