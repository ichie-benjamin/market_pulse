import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';
import { Asset, AssetCategory } from '../models/asset';

// Redis client instances
let redis: Redis | null = null;
let redisPub: Redis | null = null;
let redisSub: Redis | null = null;

/**
 * Initialize Redis connections
 */
export async function initRedis(): Promise<void> {
    try {
        const options = {
            host: config.redis.host,
            port: config.redis.port,
            password: config.redis.password,
            keyPrefix: config.redis.keyPrefix,
            retryStrategy: (times: number) => Math.min(times * 50, 2000)
        };

        // Create Redis clients
        redis = new Redis(options);
        redisPub = new Redis(options);
        redisSub = new Redis(options);

        // Subscribe to updates channel
        redisSub.subscribe(config.redis.channels.dataUpdates);

        logger.info('Redis connections initialized');
    } catch (error) {
        logger.error('Failed to initialize Redis:', error);
        throw error;
    }
}

/**
 * Close Redis connections
 */
export async function closeRedis(): Promise<void> {
    try {
        if (redis) await redis.quit();
        if (redisPub) await redisPub.quit();
        if (redisSub) await redisSub.quit();

        logger.info('Redis connections closed');
    } catch (error) {
        logger.error('Error closing Redis connections:', error);
    }
}

/**
 * Get Redis client for general operations
 */
export function getRedisClient(): Redis {
    if (!redis) throw new Error('Redis not initialized');
    return redis;
}

/**
 * Get Redis client for publishing
 */
export function getRedisPubClient(): Redis {
    if (!redisPub) throw new Error('Redis publisher not initialized');
    return redisPub;
}

/**
 * Get Redis client for subscribing
 */
export function getRedisSubClient(): Redis {
    if (!redisSub) throw new Error('Redis subscriber not initialized');
    return redisSub;
}

/**
 * Store asset data in Redis
 */
export async function storeAsset(asset: Asset): Promise<void> {
    if (!redis) throw new Error('Redis not initialized');

    try {
        const assetKey = `asset:${asset.assetId}`;

        // Store the asset with TTL
        await redis.set(
            assetKey,
            JSON.stringify(asset),
            'EX',
            config.redis.dataTtl
        );

        // Add to category set (no TTL on category sets)
        await redis.sadd(`category:${asset.category}`, asset.assetId);

        // Add to provider set
        await redis.sadd(`provider:${asset.provider}`, asset.assetId);

        // Add to all assets set
        await redis.sadd('assets:all', asset.assetId);

        logger.debug(`Stored asset in Redis: ${asset.assetId}`);
    } catch (error) {
        logger.error(`Error storing asset ${asset.assetId}:`, error);
    }
}

/**
 * Get asset data from Redis
 */
export async function getAsset(assetId: string): Promise<Asset | null> {
    if (!redis) throw new Error('Redis not initialized');

    try {
        const data = await redis.get(`asset:${assetId}`);
        if (!data) return null;

        return JSON.parse(data) as Asset;
    } catch (error) {
        logger.error(`Error getting asset ${assetId}:`, error);
        return null;
    }
}

/**
 * Get all asset IDs by category
 */
export async function getAssetIdsByCategory(category: string): Promise<string[]> {
    if (!redis) throw new Error('Redis not initialized');

    try {
        return await redis.smembers(`category:${category}`);
    } catch (error) {
        logger.error(`Error getting assets for category ${category}:`, error);
        return [];
    }
}

/**
 * Get all asset IDs
 */
export async function getAllAssetIds(): Promise<string[]> {
    if (!redis) throw new Error('Redis not initialized');

    try {
        return await redis.smembers('assets:all');
    } catch (error) {
        logger.error('Error getting all asset IDs:', error);
        return [];
    }
}

/**
 * Get multiple assets by IDs
 */
export async function getAssetsByIds(assetIds: string[]): Promise<Asset[]> {
    if (!redis) throw new Error('Redis not initialized');
    if (!assetIds.length) return [];

    try {
        const keys = assetIds.map(id => `asset:${id}`);
        const data = await redis.mget(...keys);

        return data
            .filter(Boolean)
            .map(item => JSON.parse(item!) as Asset);
    } catch (error) {
        logger.error('Error getting multiple assets:', error);
        return [];
    }
}

/**
 * Get all assets by category
 */
export async function getAssetsByCategory(category: string): Promise<Asset[]> {
    const assetIds = await getAssetIdsByCategory(category);
    return getAssetsByIds(assetIds);
}

/**
 * Get all available categories
 */
export async function getAllCategories(): Promise<string[]> {
    if (!redis) throw new Error('Redis not initialized');

    try {
        const keys = await redis.keys('category:*');
        return keys.map(key => key.replace('category:', ''));
    } catch (error) {
        logger.error('Error getting all categories:', error);
        return [];
    }
}

/**
 * Publish asset update to subscribers
 */
export async function publishAssetUpdate(asset: Asset): Promise<void> {
    if (!redisPub) throw new Error('Redis publisher not initialized');

    try {
        await redisPub.publish(
            config.redis.channels.dataUpdates,
            JSON.stringify(asset)
        );

        logger.debug(`Published update for asset: ${asset.assetId}`);
    } catch (error) {
        logger.error(`Error publishing update for ${asset.assetId}:`, error);
    }
}

/**
 * Set up a callback for Redis subscription messages
 */
export function onAssetUpdate(callback: (asset: Asset) => void): void {
    if (!redisSub) throw new Error('Redis subscriber not initialized');

    redisSub.on('message', (channel, message) => {
        if (channel === config.redis.channels.dataUpdates) {
            try {
                const asset = JSON.parse(message) as Asset;
                callback(asset);
            } catch (error) {
                logger.error('Error processing Redis message:', error);
            }
        }
    });
}
