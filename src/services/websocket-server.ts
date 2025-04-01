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
    // Create Socket.IO server with more permissive CORS
    io = new Server(server, {
        path: config.websocket.path,
        cors: {
            origin: "*", // Allow all origins for testing
            methods: ["GET", "POST"],
            allowedHeaders: ["x-api-key"],
            credentials: true
        },
        transports: ['websocket', 'polling'] // Allow polling as fallback
    });

    // Log that the server is starting
    logger.info(`WebSocket server initializing on path: ${config.websocket.path}`);

    // Set up authentication middleware with more logging
    io.use((socket: Socket, next) => {
        try {
            const apiKey = socket.handshake.auth.apiKey ||
                socket.handshake.headers['x-api-key'] as string;

            logger.info(`WebSocket auth attempt: ${socket.id}`);

            if (!apiKey) {
                logger.warn(`WebSocket auth failed: No API key provided (${socket.id})`);
                return next(new Error('Authentication error: No API key provided'));
            }

            if (!validateApiKey(apiKey)) {
                logger.warn(`WebSocket auth failed: Invalid API key (${socket.id})`);
                return next(new Error('Authentication error: Invalid API key'));
            }

            logger.info(`WebSocket auth success: ${socket.id}`);
            next();
        } catch (error) {
            logger.error(`WebSocket auth error: ${error}`);
            next(new Error('Authentication error'));
        }
    });

    // Handle client connections
    io.on('connection', (socket: Socket) => {
        const clientId = socket.id;
        logger.info(`Client connected: ${clientId}`);

        // Immediately send a welcome message
        socket.emit('welcome', {
            message: 'Connected to MarketPulse WebSocket server',
            timestamp: new Date().toISOString()
        });

        // Initial data subscription
        socket.on('subscribe', async (params = {}) => {
            logger.info(`Subscription request from ${clientId}:`, params);
            await handleSubscribe(socket, params);
        });

        // Unsubscribe from data
        socket.on('unsubscribe', (params = {}) => {
            logger.info(`Unsubscription request from ${clientId}:`, params);
            handleUnsubscribe(socket, params);
        });

        // Fetch specific asset
        socket.on('getAsset', async (assetId: string, callback) => {
            try {
                logger.info(`Asset request from ${clientId}: ${assetId}`);
                const assets = await getAssetsByIds([assetId]);
                callback({ success: true, data: assets[0] || null });
            } catch (error) {
                logger.error(`Error fetching asset ${assetId}:`, error);
                callback({ success: false, error: 'Failed to fetch asset' });
            }
        });

        // Debug event to verify connection
        socket.on('ping', (callback) => {
            logger.info(`Ping from ${clientId}`);
            if (typeof callback === 'function') {
                callback({ time: new Date().toISOString() });
            } else {
                socket.emit('pong', { time: new Date().toISOString() });
            }
        });

        // Disconnect handler
        socket.on('disconnect', (reason) => {
            logger.info(`Client disconnected: ${clientId}, reason: ${reason}`);
        });

        // Error handler
        socket.on('error', (error) => {
            logger.error(`Socket error for ${clientId}:`, error);
        });
    });

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

    logger.info('WebSocket server initialized successfully');

    return io;
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
            logger.info(`Sending ${initialData.length} assets as initial data to ${clientId}`);
            socket.emit('initialData', initialData);
        } else {
            logger.info(`No initial data available for ${clientId}'s subscription`);
            socket.emit('initialData', []);
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
    } = {}
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
