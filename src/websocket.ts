import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { createLogger, Logger } from './logging';

import { socketAuth, socketOriginCheck } from './api/middleware/auth';
import { generateAssetStats, Asset } from './models';
import { RedisService, UpdateMessage } from './redis';
import ProviderManager from './providers';

const logger: Logger = createLogger('websocket-server');

// Socket with subscription tracking
interface SubscriptionSocket extends Socket {
    subscriptions?: {
        all: boolean;
        categories: Set<string>;
        symbols: Set<string>;
        turboMode: boolean;
    };
}

// Subscription tracking
interface SubscriptionStats {
    all: number;
    categories: Record<string, number>;
    symbols: Record<string, number>;
}

/**
 * Set up WebSocket server
 * @param httpServer - HTTP server
 * @param redisService - Redis service
 * @param providerManager - Provider manager
 */
export function setupWebSocketServer(
    httpServer: HTTPServer,
    redisService: RedisService,
    providerManager: ProviderManager
): SocketIOServer {
    logger.info('Setting up WebSocket server');

    // Create Socket.IO server
    const io = new SocketIOServer(httpServer, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        },
        pingInterval: 25000, // 25 seconds
        pingTimeout: 5000 // 5 seconds
    });

    // Apply middleware
    io.use(socketOriginCheck);
    io.use(socketAuth);

    // Connection tracking
    let connectedClients = 0;
    const subscriptions: SubscriptionStats = {
        all: 0,
        categories: {},
        symbols: {}
    };

    // Set up connection handler
    io.on('connection', (socket: Socket) => {
        const subscriptionSocket = socket as SubscriptionSocket;
        connectedClients++;

        logger.info('Client connected', {
            id: subscriptionSocket.id,
            ip: subscriptionSocket.handshake.address,
            clients: connectedClients
        });

        // Track client subscriptions
        subscriptionSocket.subscriptions = {
            all: false,
            categories: new Set<string>(),
            symbols: new Set<string>(),
            turboMode: false
        };

        // Handle subscription to all assets
        subscriptionSocket.on('subscribe:all', async () => {
            logger.debug('Client subscribing to all assets', { id: subscriptionSocket.id });

            subscriptionSocket.join('all-assets');
            if (subscriptionSocket.subscriptions) {
                subscriptionSocket.subscriptions.all = true;
            }
            subscriptions.all++;

            // Send initial data from Redis
            const allAssets = await redisService.getAllAssets();

            logger.info('Sending all assets to client', {
                id: subscriptionSocket.id,
                count: allAssets.length
            });

            subscriptionSocket.emit('data:all', allAssets);
        });

        // Handle subscription to category
        subscriptionSocket.on('subscribe:category', async (category: string) => {
            if (!category || !['crypto', 'stocks', 'forex', 'indices', 'commodities'].includes(category)) {
                logger.warn('Invalid category subscription', {
                    id: subscriptionSocket.id,
                    category
                });

                subscriptionSocket.emit('error', {
                    message: 'Invalid category. Must be one of: crypto, stocks, forex, indices, commodities'
                });
                return;
            }

            logger.debug('Client subscribing to category', {
                id: subscriptionSocket.id,
                category
            });

            subscriptionSocket.join(`category:${category}`);
            if (subscriptionSocket.subscriptions) {
                subscriptionSocket.subscriptions.categories.add(category);
            }

            // Track subscriptions
            subscriptions.categories[category] = (subscriptions.categories[category] || 0) + 1;

            // Send initial data from Redis
            const assets = await redisService.getAssetsByCategory(category);

            logger.info('Sending category data to client', {
                id: subscriptionSocket.id,
                category,
                count: assets.length
            });

            subscriptionSocket.emit(`data:category:${category}`, assets);
        });

        // Handle subscription to symbols with Turbo Mode option
        interface SymbolSubscription {
            symbols: string[];
            mode?: string;
        }

        subscriptionSocket.on('subscribe:symbols', async (data: SymbolSubscription) => {
            const { symbols, mode } = data;

            if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
                logger.warn('Invalid symbols subscription', {
                    id: subscriptionSocket.id,
                    symbols
                });

                subscriptionSocket.emit('error', {
                    message: 'Invalid symbols. Must provide an array of symbol strings.'
                });
                return;
            }

            // Clean up symbols (trim, uppercase)
            const cleanSymbols = symbols.map(s => s.trim().toUpperCase());

            // Create a unique room name for these symbols
            const roomName = `symbols:${cleanSymbols.sort().join(',')}`;

            logger.debug('Client subscribing to symbols', {
                id: subscriptionSocket.id,
                symbols: cleanSymbols,
                turboMode: mode === 'turbo'
            });

            subscriptionSocket.join(roomName);

            // Track symbol subscriptions
            if (subscriptionSocket.subscriptions) {
                cleanSymbols.forEach(symbol => {
                    subscriptionSocket.subscriptions?.symbols.add(symbol);
                    subscriptions.symbols[symbol] = (subscriptions.symbols[symbol] || 0) + 1;
                });
            }

            // Send initial data from Redis
            const assets = await redisService.getAssetsBySymbols(cleanSymbols);

            logger.info('Sending symbols data to client', {
                id: subscriptionSocket.id,
                symbols: cleanSymbols,
                count: assets.length,
                turboMode: mode === 'turbo'
            });

            subscriptionSocket.emit('data:symbols', {
                symbols: cleanSymbols,
                assets
            });

            // If Turbo Mode is requested, register with provider manager
            if (mode === 'turbo' && subscriptionSocket.subscriptions) {
                subscriptionSocket.subscriptions.turboMode = true;
                providerManager.registerTurboClient(subscriptionSocket, cleanSymbols);

                logger.info('Turbo Mode enabled for client', {
                    id: subscriptionSocket.id,
                    symbols: cleanSymbols
                });
            }
        });

        // Handle request for statistics
        subscriptionSocket.on('get:stats', async () => {
            logger.debug('Client requesting overall statistics', { id: subscriptionSocket.id });

            const assets = await redisService.getAllAssets();
            const stats = generateAssetStats(assets);

            subscriptionSocket.emit('stats', stats);
        });

        // Handle request for category statistics
        subscriptionSocket.on('get:stats:category', async (category: string) => {
            if (!category || !['crypto', 'stocks', 'forex', 'indices', 'commodities'].includes(category)) {
                logger.warn('Invalid category stats request', {
                    id: subscriptionSocket.id,
                    category
                });

                subscriptionSocket.emit('error', {
                    message: 'Invalid category. Must be one of: crypto, stocks, forex, indices, commodities'
                });
                return;
            }

            logger.debug('Client requesting category statistics', {
                id: subscriptionSocket.id,
                category
            });

            const assets = await redisService.getAssetsByCategory(category);
            const stats = generateAssetStats(assets);

            subscriptionSocket.emit('stats:category', {
                category,
                stats
            });
        });

        // Handle disconnection
        subscriptionSocket.on('disconnect', (reason: string) => {
            connectedClients--;

            // Update subscription counters
            if (subscriptionSocket.subscriptions) {
                if (subscriptionSocket.subscriptions.all) {
                    subscriptions.all--;
                }

                subscriptionSocket.subscriptions.categories.forEach(category => {
                    if (subscriptions.categories[category]) {
                        subscriptions.categories[category]--;
                    }
                });

                subscriptionSocket.subscriptions.symbols.forEach(symbol => {
                    if (subscriptions.symbols[symbol]) {
                        subscriptions.symbols[symbol]--;
                    }
                });
            }

            logger.info('Client disconnected', {
                id: subscriptionSocket.id,
                reason,
                clients: connectedClients
            });
        });
    });

    // Listen for Redis updates to broadcast to non-Turbo clients
    redisService.subscribe(async (update: UpdateMessage) => {
        if (update.type === 'update') {
            try {
                const assetIds = update.assets;
                const updatedAssets = await redisService.getAssetsByIds(assetIds);

                if (updatedAssets.length === 0) {
                    return;
                }

                // Group assets by category
                const byCategory: Record<string, Asset[]> = {};
                updatedAssets.forEach(asset => {
                    if (!asset.category) return;

                    byCategory[asset.category] = byCategory[asset.category] || [];
                    byCategory[asset.category].push(asset);
                });

                // Emit to 'all-assets' room if there are subscribers
                if (subscriptions.all > 0) {
                    io.to('all-assets').emit('data:update', updatedAssets);
                }

                // Emit to category rooms
                Object.entries(byCategory).forEach(([category, assets]) => {
                    if (subscriptions.categories[category] && subscriptions.categories[category] > 0) {
                        io.to(`category:${category}`).emit(`data:category:${category}:update`, assets);
                    }
                });

                // Log periodic statistics about message delivery
                if (Math.random() < 0.001) { // Log roughly 1 in 1000 updates
                    logger.info('WebSocket update metrics', {
                        updatedAssets: updatedAssets.length,
                        clients: connectedClients,
                        allSubscribers: subscriptions.all,
                        categorySubscribers: Object.entries(subscriptions.categories)
                            .filter(([_, count]) => count > 0)
                            .reduce((acc, [cat, count]) => ({ ...acc, [cat]: count }), {})
                    });
                }
            } catch (error) {
                logger.error('Error processing asset updates for WebSocket', { error });
            }
        }
    });

    // Log connection statistics periodically
    setInterval(() => {
        logger.info('WebSocket connection statistics', {
            clients: connectedClients,
            subscriptions: {
                all: subscriptions.all,
                categories: Object.entries(subscriptions.categories)
                    .filter(([_, count]) => count > 0)
                    .reduce((acc, [cat, count]) => ({ ...acc, [cat]: count }), {}),
                symbols: Object.entries(subscriptions.symbols)
                    .filter(([_, count]) => count > 0)
                    .length
            }
        });
    }, 60000); // Every minute

    logger.info('WebSocket server setup completed');

    return io;
}
