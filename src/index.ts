import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import { Server as SocketIOServer } from 'socket.io';
import { logger } from './logging';
import { setupApiRoutes } from './api';
import { setupWebSocketServer } from './websocket';
import { initRedisService, RedisService } from './redis';
import ProviderManager from './providers';
import { config } from './config';

interface AppComponents {
    app: express.Application;
    server: http.Server;
    io: SocketIOServer;
    redisService: RedisService;
    providerManager: ProviderManager;
}

/**
 * Start the server
 */
async function startServer(): Promise<AppComponents> {
    try {
        logger.info('Starting market data service...');

        // Initialize Redis
        logger.info('Initializing Redis service...');
        const redisService = await initRedisService();
        logger.info('Redis service initialized successfully');

        // Create Express app
        const app = express();

        // Apply middleware
        app.use(helmet());
        app.use(cors());
        app.use(express.json());

        // Create HTTP server
        const server = http.createServer(app);

        // Initialize provider manager
        logger.info('Initializing provider manager...');
        const providerManager = new ProviderManager(redisService);
        await providerManager.initialize();
        logger.info('Provider manager initialized successfully');

        // Set up API routes
        logger.info('Setting up API routes...');
        setupApiRoutes(app, redisService, providerManager);

        // Set up WebSocket server
        logger.info('Setting up WebSocket server...');
        const io = setupWebSocketServer(server, redisService, providerManager);

        // Start server
        server.listen(config.port, () => {
            logger.info(`Server running on port ${config.port}`);
            logger.info(`Environment: ${config.nodeEnv}`);
            logger.info(`API authentication: ${config.auth.enabled ? 'Enabled' : 'Disabled'}`);
            logger.info(`Origin checking: ${config.urlCheck.enabled ? 'Enabled' : 'Disabled'}`);
        });

        // Handle graceful shutdown
        process.on('SIGTERM', () => gracefulShutdown(server, redisService, providerManager));
        process.on('SIGINT', () => gracefulShutdown(server, redisService, providerManager));

        return { app, server, io, redisService, providerManager };
    } catch (error) {
        logger.error('Failed to start server', { error });
        process.exit(1);
    }
}

/**
 * Gracefully shut down the server
 */
async function gracefulShutdown(
    server: http.Server,
    redisService: RedisService,
    providerManager: ProviderManager
): Promise<void> {
    logger.info('Shutting down server...');

    // Close data provider connections
    logger.info('Shutting down providers...');
    await providerManager.shutdown();

    // Close Redis connections
    logger.info('Shutting down Redis...');
    await redisService.shutdown();

    // Close HTTP server
    logger.info('Closing HTTP server...');
    server.close(() => {
        logger.info('HTTP server closed');
        logger.info('Shutdown complete');
        process.exit(0);
    });

    // Force exit after timeout
    setTimeout(() => {
        logger.error('Forcing server shutdown after timeout');
        process.exit(1);
    }, 10000); // 10 seconds
}

// Start the server
if (require.main === module) {
    startServer();
}

export { startServer };
