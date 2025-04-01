import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { config } from '../config';
import { logger } from '../utils/logger';
import { Asset } from '../models/asset';
import { validateApiKey } from '../utils/security';
import {
    onAssetUpdate,
    getAssetsByIds,
    getAssetsByCategory,
    getAllAssetIds
} from './redis-service';

// Socket.IO server instance
let io: Server;

/**
 * Initialize WebSocket server
 */
export function initWebSocketServer(server: HttpServer): Server {
    // Create Socket.IO server
    io = new Server(server, {
        path: config.websocket.path,
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    // Set up authentication middleware
    io.use((socket: Socket, next) => {
        try {
            const apiKey = socket.handshake.auth.apiKey ||
                socket.handshake.headers['x-api-key'] as string;

            if (!apiKey || !validateApiKey(apiKey)) {
                return next(new Error('Invalid API key'));
            }

            next();
        } catch (error) {
            next(new Error('Authentication error'));
        }
    });

    // Handle client connections
    io.on('connection', handleConnection);

    // Listen for asset updates from Redis
    onAssetUpdate((asset: Asset) => {
        // Broadcast to asset room
        io.to(`asset:${asset.assetId}`).emit('asset', asset);

        // Broadcast to category room
        io.to(`category:${asset.category}`).emit('asset', asset);

        // Broadcast to provider room
        io.to(`provider:${asset.provider}`).emit('asset', asset);

        // Broadcast to all subscribers
        io.to('all').emit('asset', asset);
    });

    logger.info('WebSocket server initialized');

    return io;
}

/**
 * Handle new client connection
 */
async function handleConnection(socket: Socket): Promise<void> {
    const clientId = socket.id;
    logger.info(`Client connected: ${clientId}`);

    // Initial data subscription
    socket.on('subscribe', async (params) => {
        await handleSubscribe(socket, params);
    });

    // Unsubscribe from data
    socket.on('unsubscribe', (params) => {
        handleUnsubscribe(socket, params);
    });

    // Fetch specific asset
    socket.on('getAsset', async (assetId: string, callback) => {
        try {
            const assets = await getAssetsByIds([assetId]);
            callback({ success: true, data: assets[0] || null });
        } catch (error) {
            logger.error(`Error fetching asset ${assetId}:`, error);
            callback({ success: false, error: 'Failed to fetch asset' });
        }
    });

    // Disconnect handler
    socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${clientId}`);
    });
}

/**
 * Handle client subscription request
 */
async function handleSubscribe(
    socket: Socket,
    params: {
        assets?: string[],
        categories?: string[],
        provider?: string,
        all?: boolean
    } = {}
): Promise<void> {
    const { assets, categories, provider, all } = params;
    const clientId = socket.id;
    let initialData: Asset[] = [];

    try {
        // Subscribe to specific assets
        if (assets && Array.isArray(assets) && assets.length > 0) {
            assets.forEach(assetId => {
                socket.join(`asset:${assetId}`);
            });

            // Fetch initial data for these assets
            initialData = await getAssetsByIds(assets);

            logger.debug(`Client ${clientId} subscribed to ${assets.length} assets`);
        }

        // Subscribe to categories
        if (categories && Array.isArray(categories) && categories.length > 0) {
            // Join each category room
            categories.forEach(category => {
                socket.join(`category:${category}`);
            });

            // If we don't have initial data yet, get assets for these categories
            if (initialData.length === 0) {
                for (const category of categories) {
                    const categoryAssets = await getAssetsByCategory(category);
                    initialData = [...initialData, ...categoryAssets];
                }
            }

            logger.debug(`Client ${clientId} subscribed to categories: ${categories.join(', ')}`);
        }

        // Subscribe to provider
        if (provider) {
            socket.join(`provider:${provider}`);
            logger.debug(`Client ${clientId} subscribed to provider: ${provider}`);
        }

        // Subscribe to all assets
        if (all) {
            socket.join('all');

            // If we don't have initial data yet, get all assets
            if (initialData.length === 0) {
                const allAssetIds = await getAllAssetIds();
                initialData = await getAssetsByIds(allAssetIds);
            }

            logger.debug(`Client ${clientId} subscribed to all assets`);
        }

        // Send initial data to client
        if (initialData.length > 0) {
            socket.emit('initialData', initialData);
        }

        // Confirm subscription
        socket.emit('subscribed', {
            success: true,
            params,
            assetCount: initialData.length
        });
    } catch (error) {
        logger.error(`Error during subscription for client ${clientId}:`, error);
        socket.emit('subscribed', {
            success: false,
            error: 'Subscription failed'
        });
    }
}

/**
 * Handle client unsubscription request
 */
function handleUnsubscribe(
    socket: Socket,
    params: {
        assets?: string[],
        categories?: string[],
        provider?: string,
        all?: boolean
    }
): void {
    const { assets, categories, provider, all } = params;
    const clientId = socket.id;

    try {
        // Unsubscribe from specific assets
        if (assets && Array.isArray(assets)) {
            assets.forEach(assetId => {
                socket.leave(`asset:${assetId}`);
            });
            logger.debug(`Client ${clientId} unsubscribed from ${assets.length} assets`);
        }

        // Unsubscribe from categories
        if (categories && Array.isArray(categories)) {
            categories.forEach(category => {
                socket.leave(`category:${category}`);
            });
            logger.debug(`Client ${clientId} unsubscribed from categories: ${categories.join(', ')}`);
        }

        // Unsubscribe from provider
        if (provider) {
            socket.leave(`provider:${provider}`);
            logger.debug(`Client ${clientId} unsubscribed from provider: ${provider}`);
        }

        // Unsubscribe from all assets
        if (all) {
            socket.leave('all');
            logger.debug(`Client ${clientId} unsubscribed from all assets`);
        }

        // Confirm unsubscription
        socket.emit('unsubscribed', { success: true, params });
    } catch (error) {
        logger.error(`Error during unsubscription for client ${clientId}:`, error);
        socket.emit('unsubscribed', {
            success: false,
            error: 'Unsubscription failed'
        });
    }
}

/**
 * Get the WebSocket server instance
 */
export function getWebSocketServer(): Server {
    if (!io) {
        throw new Error('WebSocket server not initialized');
    }
    return io;
}
