import express from 'express';
import { RedisService } from '../redis';
import ProviderManager from '../providers';
import { setupAssetRoutes } from './routes/assets';
import { setupRedisRoutes } from './routes/redis';
import { setupStatsRoutes } from './routes/stats';
import { setupSystemRoutes } from './routes/system';
import { createLogger } from '../logging';
import { apiKeyAuth, originCheck } from './middleware/auth';
import { requestIdMiddleware } from '../logging';
import rateLimit from 'express-rate-limit';

const logger = createLogger('api');

/**
 * Set up API routes
 * @param app - Express app
 * @param redisService - Redis service
 * @param providerManager - Provider manager
 */
export function setupApiRoutes(
    app: express.Application,
    redisService: RedisService,
    providerManager: ProviderManager
): void {
    logger.info('Setting up API routes');

    // Apply global middleware
    app.use(requestIdMiddleware);
    app.use(originCheck);

    // Add rate limiter
    const apiLimiter = rateLimit({
        windowMs: 60 * 1000, // 1 minute
        limit: 120,
        standardHeaders: true,
        legacyHeaders: false,
        message: 'Too many requests, please try again later.',
        keyGenerator: (req: express.Request): string => {
            return req.apiKey || req.ip || 'unknown';
        }
    });

    // Create API router
    const apiRouter = express.Router();

    // Apply middleware to API routes
    apiRouter.use(apiKeyAuth);
    apiRouter.use(apiLimiter);

    // Setup route groups
    setupAssetRoutes(apiRouter, redisService, providerManager);
    setupRedisRoutes(apiRouter, redisService);
    setupStatsRoutes(apiRouter, redisService);
    setupSystemRoutes(apiRouter, providerManager);

    // Mount API router
    app.use('/api', apiRouter);

    // Health check endpoint (no auth required)
    app.get('/health', (req: express.Request, res: express.Response) => {
        const providers = providerManager.getAllProviders();
        const providerStatus: Record<string, any> = {};

        Object.entries(providers).forEach(([category, provider]) => {
            providerStatus[category] = {
                provider: provider.name,
                initialized: provider.initialized,
                connected: provider.connection !== null || provider.pollingInterval !== null
            };
        });

        res.json({
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            providers: providerStatus
        });
    });

    // Error handler
    app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
        logger.error('Unhandled error in API request', {
            error: err,
            path: req.path,
            method: req.method
        });

        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    });

    logger.info('API routes setup completed');
}
