import express, { Request, Response } from 'express';
import { createLogger } from '../../logging';
import ProviderManager from '../../providers';
import { config } from '../../config';

const logger = createLogger('system-api');

/**
 * Setup system routes
 * @param router - Express router
 * @param providerManager - Provider manager
 */
export function setupSystemRoutes(
    router: express.Router,
    providerManager: ProviderManager
): void {
    // Get system status
    router.get('/system/status', async (req: Request, res: Response) => {
        try {
            logger.debug('Request for system status');

            const providers = providerManager.getAllProviders();
            const providerStatus: Record<string, any> = {};

            Object.entries(providers).forEach(([category, provider]) => {
                providerStatus[category] = {
                    provider: provider.name,
                    initialized: provider.initialized,
                    connected: provider.connection !== null || provider.pollingInterval !== null
                };
            });

            // Get memory usage
            const memoryUsage = process.memoryUsage();

            res.json({
                success: true,
                data: {
                    system: {
                        uptime: process.uptime(),
                        nodeVersion: process.version,
                        platform: process.platform,
                        memory: {
                            rss: `${Math.round(memoryUsage.rss / (1024 * 1024))} MB`,
                            heapTotal: `${Math.round(memoryUsage.heapTotal / (1024 * 1024))} MB`,
                            heapUsed: `${Math.round(memoryUsage.heapUsed / (1024 * 1024))} MB`,
                            external: `${Math.round(memoryUsage.external / (1024 * 1024))} MB`
                        }
                    },
                    app: {
                        environment: config.nodeEnv,
                        port: config.port,
                        auth: config.auth.enabled,
                        urlCheck: config.urlCheck.enabled
                    },
                    providers: providerStatus,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting system status', { error });

            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    });

    // Get system configuration
    router.get('/system/config', async (req: Request, res: Response) => {
        try {
            logger.debug('Request for system configuration');

            // Create a sanitized config without sensitive info
            const sanitizedConfig = {
                nodeEnv: config.nodeEnv,
                port: config.port,
                logging: {
                    level: config.logging.level,
                    format: config.logging.format,
                    fileEnabled: config.logging.fileEnabled,
                    filePath: config.logging.filePath,
                    consoleEnabled: config.logging.consoleEnabled
                },
                redis: {
                    keyPrefix: config.redis.keyPrefix,
                    cacheExpiry: config.redis.cacheExpiry
                },
                auth: {
                    enabled: config.auth.enabled
                },
                urlCheck: {
                    enabled: config.urlCheck.enabled,
                    allowedOrigins: config.urlCheck.allowedOrigins
                },
                providers: config.providers,
                connectionModes: config.connectionModes,
                updateIntervals: config.updateIntervals
            };

            res.json({
                success: true,
                data: sanitizedConfig
            });
        } catch (error) {
            logger.error('Error getting system configuration', { error });

            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    });
}
