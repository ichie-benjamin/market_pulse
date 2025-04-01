import * as http from 'http';
import { app } from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { initRedis, closeRedis } from './services/redis-service';
import { initWebSocketServer } from './services/websocket-server';
import { initProvider, disconnectProvider } from './providers';

// Create HTTP server
const server = http.createServer(app);
const PORT = config.app.port;

/**
 * Start the server
 */
async function start(): Promise<void> {
    try {
        logger.info('Starting market data platform...');

        // Initialize Redis
        await initRedis();
        logger.info('Redis initialized');

        // Initialize WebSocket server
        initWebSocketServer(server);
        logger.info('WebSocket server initialized');

        // Initialize data provider
        await initProvider();
        logger.info('Data provider initialized');

        // Start HTTP server
        server.listen(PORT, () => {
            logger.info(`Server running on port ${PORT}`);
            logger.info(`WebSocket endpoint: ws://localhost:${PORT}${config.websocket.path}`);
        });

        // Set up graceful shutdown
        setupGracefulShutdown();

    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

/**
 * Graceful shutdown handler
 */
function setupGracefulShutdown(): void {
    // Function to cleanly shut down the application
    const shutdown = async (): Promise<void> => {
        logger.info('Shutting down server...');

        // Close HTTP server first (stop accepting new connections)
        server.close(() => {
            logger.info('HTTP server closed');
        });

        try {
            // Disconnect from data provider
            await disconnectProvider();
            logger.info('Data provider disconnected');

            // Close Redis connections
            await closeRedis();
            logger.info('Redis connections closed');

            logger.info('Server shutdown complete');
            process.exit(0);
        } catch (error) {
            logger.error('Error during shutdown:', error);
            process.exit(1);
        }
    };

    // Listen for termination signals
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Handle uncaught exceptions and unhandled promise rejections
    process.on('uncaughtException', (error) => {
        logger.error('Uncaught exception:', error);
        shutdown();
    });

    process.on('unhandledRejection', (reason) => {
        logger.error('Unhandled rejection:', reason);
        shutdown();
    });
}

// Start the server
start();
