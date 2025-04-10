import Redis from 'ioredis';
import { config } from './config';
import { createLogger, Logger } from './logging';
import { Asset, AssetCategory } from './models';

const logger: Logger = createLogger('redis-service');

// Redis clients
let redisClient: Redis | null = null;
let redisPublisher: Redis | null = null;
let redisSubscriber: Redis | null = null;

export interface UpdateMessage {
    type: string;
    assets: string[];
    timestamp: string;
}

export interface RedisService {
    getClient: () => Redis;
    getPublisher: () => Redis;
    getSubscriber: () => Redis;
    updateAssets: (assets: Asset[]) => Promise<string[]>;
    getAsset: (id: string) => Promise<Asset | null>;
    getAssetsByIds: (ids: string[]) => Promise<Asset[]>;
    getAssetsByCategory: (category: string) => Promise<Asset[]>;
    getAssetsBySymbols: (symbols: string[]) => Promise<Asset[]>;
    getAllAssets: () => Promise<Asset[]>;
    subscribe: (callback: (message: UpdateMessage) => void) => void;
    publishAssetUpdate: (assetIds: string[]) => Promise<void>;

    // New Redis management methods
    clearAll: () => Promise<void>;
    clearCategory: (category: AssetCategory) => Promise<void>;
    clearAsset: (id: string) => Promise<void>;
    clearSymbol: (symbol: string) => Promise<void>;
    clearPattern: (pattern: string) => Promise<void>;
    getInfo: () => Promise<any>;

    shutdown: () => Promise<void>;
}

/**
 * Initialize Redis clients
 */
export async function initRedisService(): Promise<RedisService> {
    try {
        // Create main Redis client
        redisClient = new Redis(config.redis.url, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                logger.info(`Redis connection retry ${times}`, { delay });
                return delay;
            }
        });

        // Create separate clients for pub/sub
        redisPublisher = new Redis(config.redis.url);
        redisSubscriber = new Redis(config.redis.url);

        // Set up event handlers for main client
        redisClient.on('connect', () => {
            logger.info('Redis client connected');
        });

        redisClient.on('error', (err) => {
            logger.error('Redis client error', { error: err });
        });

        redisClient.on('reconnecting', () => {
            logger.warn('Redis client reconnecting');
        });

        // Test connection
        await redisClient.ping();
        logger.info('Redis service initialized successfully');

        return {
            getClient: () => redisClient!,
            getPublisher: () => redisPublisher!,
            getSubscriber: () => redisSubscriber!,
            updateAssets,
            getAsset,
            getAssetsByIds,
            getAssetsByCategory,
            getAssetsBySymbols,
            getAllAssets,
            subscribe,
            publishAssetUpdate,
            clearAll,
            clearCategory,
            clearAsset,
            clearSymbol,
            clearPattern,
            getInfo,
            shutdown
        };
    } catch (error) {
        logger.error('Failed to initialize Redis service', { error });
        throw error;
    }
}

/**
 * Update assets in Redis
 */
async function updateAssets(assets: Asset[]): Promise<string[]> {
    if (!Array.isArray(assets) || assets.length === 0) {
        logger.warn('No assets to update');
        return [];
    }

    try {
        const pipeline = redisClient!.pipeline();
        const assetIds: string[] = [];

        for (const asset of assets) {
            if (!asset.id) {
                logger.warn('Asset missing ID, skipping', { asset });
                continue;
            }

            const key = `${config.redis.keyPrefix}asset:${asset.id}`;
            assetIds.push(asset.id);

            // Store complete asset data
            pipeline.set(key, JSON.stringify(asset), 'EX', config.redis.cacheExpiry);

            // Add to category set
            if (asset.category) {
                pipeline.sadd(`${config.redis.keyPrefix}category:${asset.category}`, asset.id);
            }

            // Update symbol to ID mapping for quick lookups
            if (asset.symbol) {
                pipeline.hset(
                    `${config.redis.keyPrefix}symbols`,
                    asset.symbol,
                    asset.id
                );
            }
        }

        // Execute pipeline
        const results = await pipeline.exec();
        logger.debug('Redis pipeline executed', {
            assetCount: assets.length,
            operationCount: results?.length || 0
        });

        // Publish update notification
        await publishAssetUpdate(assetIds);

        return assetIds;
    } catch (error) {
        logger.error('Failed to update assets in Redis', { error, assetCount: assets.length });
        throw error;
    }
}

/**
 * Get an asset by ID
 */
async function getAsset(id: string): Promise<Asset | null> {
    try {
        const key = `${config.redis.keyPrefix}asset:${id}`;
        const data = await redisClient!.get(key);

        if (!data) {
            logger.debug('Asset not found', { id });
            return null;
        }

        return JSON.parse(data) as Asset;
    } catch (error) {
        logger.error('Failed to get asset from Redis', { error, id });
        throw error;
    }
}

/**
 * Get multiple assets by IDs
 */
async function getAssetsByIds(ids: string[]): Promise<Asset[]> {
    if (!ids || ids.length === 0) {
        logger.debug('No asset IDs provided');
        return [];
    }

    try {
        const keys = ids.map(id => `${config.redis.keyPrefix}asset:${id}`);
        const results = await redisClient!.mget(keys);

        const assets = results
            .map(data => data ? JSON.parse(data) as Asset : null)
            .filter((asset): asset is Asset => asset !== null);

        logger.debug('Retrieved assets by IDs', {
            requestedCount: ids.length,
            retrievedCount: assets.length
        });

        return assets;
    } catch (error) {
        logger.error('Failed to get assets by IDs from Redis', { error, ids });
        throw error;
    }
}

/**
 * Get assets by category
 */
async function getAssetsByCategory(category: string): Promise<Asset[]> {
    try {
        const key = `${config.redis.keyPrefix}category:${category}`;
        const ids = await redisClient!.smembers(key);

        if (ids.length === 0) {
            logger.debug('No assets found for category', { category });
            return [];
        }

        const assets = await getAssetsByIds(ids);
        logger.debug('Retrieved assets by category', {
            category,
            count: assets.length
        });

        return assets;
    } catch (error) {
        logger.error('Failed to get assets by category from Redis', { error, category });
        throw error;
    }
}

/**
 * Get assets by symbols
 */
async function getAssetsBySymbols(symbols: string[]): Promise<Asset[]> {
    if (!symbols || symbols.length === 0) {
        logger.debug('No symbols provided');
        return [];
    }

    try {
        // Get IDs for each symbol
        const pipeline = redisClient!.pipeline();
        symbols.forEach(symbol => {
            pipeline.hget(`${config.redis.keyPrefix}symbols`, symbol);
        });

        const results = await pipeline.exec();
        if (!results) {
            return [];
        }

        const ids = results
            .map(([err, id]) => err ? null : id as string | null)
            .filter((id): id is string => id !== null);

        if (ids.length === 0) {
            logger.debug('No assets found for provided symbols', { symbols });
            return [];
        }

        const assets = await getAssetsByIds(ids);
        logger.debug('Retrieved assets by symbols', {
            requestedSymbols: symbols.length,
            foundSymbols: assets.length
        });

        return assets;
    } catch (error) {
        logger.error('Failed to get assets by symbols from Redis', { error, symbols });
        throw error;
    }
}

/**
 * Get all assets
 */
async function getAllAssets(): Promise<Asset[]> {
    try {
        const categories = ['crypto', 'stocks', 'forex', 'indices', 'commodities','metals'];
        const allAssets: Asset[] = [];

        for (const category of categories) {
            const assets = await getAssetsByCategory(category);
            allAssets.push(...assets);
        }

        logger.debug('Retrieved all assets', { count: allAssets.length });
        return allAssets;
    } catch (error) {
        logger.error('Failed to get all assets from Redis', { error });
        throw error;
    }
}

/**
 * Subscribe to asset updates
 */
function subscribe(callback: (message: UpdateMessage) => void): void {
    redisSubscriber!.subscribe('asset-updates');

    redisSubscriber!.on('message', (channel, message) => {
        if (channel === 'asset-updates') {
            try {
                const data = JSON.parse(message) as UpdateMessage;
                callback(data);
            } catch (error) {
                logger.error('Failed to process Redis subscription message', { error, channel });
            }
        }
    });

    redisSubscriber!.on('error', (error) => {
        logger.error('Redis subscriber error', { error });
    });

    logger.info('Subscribed to asset updates');
}

/**
 * Publish asset update notification
 */
async function publishAssetUpdate(assetIds: string[]): Promise<void> {
    try {
        const message: UpdateMessage = {
            type: 'update',
            assets: assetIds,
            timestamp: new Date().toISOString()
        };

        await redisPublisher!.publish('asset-updates', JSON.stringify(message));
        logger.debug('Published asset update notification', { assetCount: assetIds.length });
    } catch (error) {
        logger.error('Failed to publish asset update', { error, assetIds });
        throw error;
    }
}

/**
 * Clear all data from Redis
 */
async function clearAll(): Promise<void> {
    try {
        logger.info('Clearing all market data from Redis');

        // Get all keys with the configured prefix
        const keys = await redisClient!.keys(`${config.redis.keyPrefix}*`);

        if (keys.length === 0) {
            logger.info('No keys found to clear');
            return;
        }

        // Delete all keys in batches to avoid blocking Redis
        const batchSize = 1000;
        for (let i = 0; i < keys.length; i += batchSize) {
            const batch = keys.slice(i, i + batchSize);
            await redisClient!.del(...batch);
        }

        logger.info('Cleared all market data from Redis', { keyCount: keys.length });

        // Publish a clear event
        await redisPublisher!.publish('asset-updates', JSON.stringify({
            type: 'clear',
            assets: [],
            timestamp: new Date().toISOString()
        }));
    } catch (error) {
        logger.error('Failed to clear all data from Redis', { error });
        throw error;
    }
}

/**
 * Clear data for a specific category
 */
async function clearCategory(category: AssetCategory): Promise<void> {
    try {
        logger.info('Clearing category data from Redis', { category });

        // Get all asset IDs in the category
        const categoryKey = `${config.redis.keyPrefix}category:${category}`;
        const assetIds = await redisClient!.smembers(categoryKey);

        if (assetIds.length === 0) {
            logger.info('No assets found for category', { category });
            return;
        }

        // Delete all asset keys
        const pipeline = redisClient!.pipeline();
        assetIds.forEach(id => {
            pipeline.del(`${config.redis.keyPrefix}asset:${id}`);
        });

        // Delete the category set
        pipeline.del(categoryKey);

        await pipeline.exec();

        logger.info('Cleared category data from Redis', { category, assetCount: assetIds.length });

        // Publish a clear event for the category
        await redisPublisher!.publish('asset-updates', JSON.stringify({
            type: 'clear-category',
            category,
            assets: assetIds,
            timestamp: new Date().toISOString()
        }));
    } catch (error) {
        logger.error('Failed to clear category data from Redis', { error, category });
        throw error;
    }
}

/**
 * Clear a specific asset by ID
 */
async function clearAsset(id: string): Promise<void> {
    try {
        logger.info('Clearing asset from Redis', { id });

        // Get the asset first to find its symbol
        const asset = await getAsset(id);

        if (!asset) {
            logger.info('Asset not found, nothing to clear', { id });
            return;
        }

        const pipeline = redisClient!.pipeline();

        // Delete the asset
        pipeline.del(`${config.redis.keyPrefix}asset:${id}`);

        // Remove from category set
        if (asset.category) {
            pipeline.srem(`${config.redis.keyPrefix}category:${asset.category}`, id);
        }

        // Remove from symbol mapping
        if (asset.symbol) {
            pipeline.hdel(`${config.redis.keyPrefix}symbols`, asset.symbol);
        }

        await pipeline.exec();

        logger.info('Cleared asset from Redis', { id, symbol: asset.symbol });

        // Publish a clear event for the asset
        await redisPublisher!.publish('asset-updates', JSON.stringify({
            type: 'clear-asset',
            assets: [id],
            timestamp: new Date().toISOString()
        }));
    } catch (error) {
        logger.error('Failed to clear asset from Redis', { error, id });
        throw error;
    }
}

/**
 * Clear asset by symbol
 */
async function clearSymbol(symbol: string): Promise<void> {
    try {
        logger.info('Clearing asset by symbol from Redis', { symbol });

        // Get the asset ID from symbol
        const id = await redisClient!.hget(`${config.redis.keyPrefix}symbols`, symbol);

        if (!id) {
            logger.info('Symbol not found, nothing to clear', { symbol });
            return;
        }

        // Clear the asset using the ID
        await clearAsset(id);
    } catch (error) {
        logger.error('Failed to clear asset by symbol from Redis', { error, symbol });
        throw error;
    }
}

/**
 * Clear keys matching a pattern
 */
async function clearPattern(pattern: string): Promise<void> {
    try {
        logger.info('Clearing keys matching pattern from Redis', { pattern });

        // Get all keys matching the pattern
        const fullPattern = `${config.redis.keyPrefix}${pattern}`;
        const keys = await redisClient!.keys(fullPattern);

        if (keys.length === 0) {
            logger.info('No keys found matching pattern', { pattern });
            return;
        }

        // Delete all keys in batches to avoid blocking Redis
        const batchSize = 1000;
        for (let i = 0; i < keys.length; i += batchSize) {
            const batch = keys.slice(i, i + batchSize);
            await redisClient!.del(...batch);
        }

        logger.info('Cleared keys matching pattern from Redis', { pattern, keyCount: keys.length });
    } catch (error) {
        logger.error('Failed to clear keys matching pattern from Redis', { error, pattern });
        throw error;
    }
}

/**
 * Get Redis info and statistics
 */
async function getInfo(): Promise<any> {
    try {
        // Get Redis info command results
        const info = await redisClient!.info();

        // Get key counts and memory usage
        const keyCountPromises = ['crypto', 'stocks', 'forex', 'indices', 'commodities','metals'].map(
            async category => {
                const count = await redisClient!.scard(`${config.redis.keyPrefix}category:${category}`);
                return { category, count: parseInt(count.toString(), 10) };
            }
        );

        const categories = await Promise.all(keyCountPromises);
        const totalKeys = await redisClient!.dbsize();

        // Get memory usage of key patterns
        const memoryUsagePromises = [
            { name: 'assets', pattern: `${config.redis.keyPrefix}asset:*` },
            { name: 'categories', pattern: `${config.redis.keyPrefix}category:*` },
            { name: 'symbols', pattern: `${config.redis.keyPrefix}symbols` }
        ].map(async ({ name, pattern }) => {
            const keys = await redisClient!.keys(pattern);
            let totalBytes = 0;

            if (keys.length > 0) {
                // Sample up to 100 keys to estimate memory usage
                const sampleKeys = keys.length <= 100 ? keys : keys.slice(0, 100);

                // Use MEMORY USAGE command directly since memoryUsage() isn't in type definitions
                const samples = await Promise.all(
                    sampleKeys.map(key => redisClient!.call('MEMORY', 'USAGE', key) as Promise<number>)
                );

                const averageSize = samples.reduce((sum: number, size) => sum + (size || 0), 0) / samples.length;
                totalBytes = averageSize * keys.length;
            }

            return {
                name,
                keyCount: keys.length,
                estimatedMemoryBytes: totalBytes,
                estimatedMemoryMB: (totalBytes / (1024 * 1024)).toFixed(2)
            };
        });

        const memoryUsage = await Promise.all(memoryUsagePromises);

        // Parse Redis info string to object
        const infoObject: Record<string, any> = {};
        info.split('\r\n').forEach(line => {
            if (line.includes(':')) {
                const [key, value] = line.split(':');
                infoObject[key] = value;
            }
        });

        return {
            redis: {
                version: infoObject.redis_version,
                uptime: infoObject.uptime_in_seconds,
                connectedClients: infoObject.connected_clients,
                usedMemory: infoObject.used_memory_human,
                totalKeys
            },
            marketData: {
                categories,
                memoryUsage,
                totalAssets: categories.reduce((sum, cat) => sum + cat.count, 0),
                prefix: config.redis.keyPrefix,
                expiry: config.redis.cacheExpiry
            }
        };
    } catch (error) {
        logger.error('Failed to get Redis info', { error });
        throw error;
    }
}

/**
 * Shutdown Redis connections
 */
async function shutdown(): Promise<void> {
    logger.info('Shutting down Redis connections');

    try {
        if (redisClient) {
            await redisClient.quit();
        }

        if (redisPublisher) {
            await redisPublisher.quit();
        }

        if (redisSubscriber) {
            await redisSubscriber.quit();
        }

        logger.info('Redis connections closed successfully');
    } catch (error) {
        logger.error('Error shutting down Redis connections', { error });
    }
}
