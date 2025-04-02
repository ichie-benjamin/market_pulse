import Redis from 'ioredis';
import { config } from './config';
import { createLogger, Logger } from './logging';
import { Asset } from './models';

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
        const categories = ['crypto', 'stocks', 'forex', 'indices', 'commodities'];
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
