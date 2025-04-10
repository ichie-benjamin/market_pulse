import dotenv from 'dotenv';
import { AssetCategory } from './models';

// Load environment variables from .env file
dotenv.config();

export interface Config {
    // Server configuration
    port: number;
    nodeEnv: string;

    // Logging configuration
    logging: {
        level: string;
        format: string;
        fileEnabled: boolean;
        filePath: string;
        maxSize: string;
        maxFiles: number;
        consoleEnabled: boolean;
    };

    // Redis configuration
    redis: {
        url: string;
        keyPrefix: string;
        cacheExpiry: number;
    };

    // Authentication configuration
    auth: {
        enabled: boolean;
        apiKeys: string[];
    };

    // URL checking configuration
    urlCheck: {
        enabled: boolean;
        allowedOrigins: string[];
    };

    // Provider configuration
    providers: {
        [key in AssetCategory]: string;
    };

    // Provider connection modes
    connectionModes: {
        [key: string]: string;
    };

    // Provider API keys
    apiKeys: {
        [key: string]: string | undefined;
    };

    // Update intervals for API polling (in milliseconds)
    updateIntervals: {
        [key in AssetCategory]: number;
    };
}

export const config: Config = {
    // Server configuration
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

    // Logging configuration
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: process.env.LOG_FORMAT || 'json',
        fileEnabled: process.env.LOG_FILE_ENABLED === 'true',
        filePath: process.env.LOG_FILE_PATH || './logs',
        maxSize: process.env.LOG_MAX_SIZE || '10m',
        maxFiles: parseInt(process.env.LOG_MAX_FILES || '7', 10),
        consoleEnabled: process.env.LOG_CONSOLE_ENABLED === 'true'
    },

    // Redis configuration
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        keyPrefix: process.env.REDIS_KEY_PREFIX || 'market:',
        cacheExpiry: parseInt(process.env.REDIS_CACHE_EXPIRY || '3600', 10), // 1 hour
    },

    // Authentication configuration
    auth: {
        enabled: process.env.API_AUTH_ENABLED === 'true',
        apiKeys: (process.env.API_KEYS || '').split(',').filter(key => key.trim() !== '')
    },

    // URL checking configuration
    urlCheck: {
        enabled: process.env.URL_CHECK_ENABLED === 'true',
        allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(origin => origin.trim() !== '')
    },

    // Provider configuration
    providers: {
        crypto: process.env.CRYPTO_PROVIDER || 'cexio', // Default to CEX.IO for crypto
        stocks: process.env.STOCKS_PROVIDER || 'financialmodelingprep',
        forex: process.env.FOREX_PROVIDER || 'financialmodelingprep',
        indices: process.env.INDICES_PROVIDER || 'oanda',
        commodities: process.env.COMMODITIES_PROVIDER || 'oanda',
        metals: process.env.METALS_PROVIDER || 'oanda',
    },

    // Provider connection modes
    connectionModes: {
        financialmodelingprep: process.env.FINANCIALMODELINGPREP_CONNECTION_MODE || 'api',
        cexio: process.env.CEXIO_CONNECTION_MODE || 'ws',
        coincap: process.env.COINCAP_CONNECTION_MODE || 'ws',
        oanda: process.env.COINCAP_CONNECTION_MODE || 'api',
        alphavantage: process.env.ALPHAVANTAGE_CONNECTION_MODE || 'api',
        fixer: process.env.FIXER_CONNECTION_MODE || 'api'
    },

    // Provider API keys
    apiKeys: {
        financialmodelingprep: process.env.FINANCIALMODELINGPREP_API_KEY,
        cexio: process.env.CEXIO_API_KEY,
        coincap: process.env.COINCAP_API_KEY,
        alphavantage: process.env.ALPHAVANTAGE_API_KEY,
        fixer: process.env.FIXER_API_KEY,
        oanda: process.env.OANDA_API_KEY,
    },

    // Update intervals for API polling (in milliseconds)
    updateIntervals: {
        crypto: parseInt(process.env.CRYPTO_UPDATE_INTERVAL || '5000', 10),
        stocks: parseInt(process.env.STOCKS_UPDATE_INTERVAL || '60000', 10),
        forex: parseInt(process.env.FOREX_UPDATE_INTERVAL || '5000', 10),
        indices: parseInt(process.env.INDICES_UPDATE_INTERVAL || '60000', 10),
        commodities: parseInt(process.env.COMMODITIES_UPDATE_INTERVAL || '60000', 10),
        metals: parseInt(process.env.METAL_UPDATE_INTERVAL || '5000', 10)
    }
};

export default config;
