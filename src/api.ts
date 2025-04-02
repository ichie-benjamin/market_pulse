import express, { Request, Response, NextFunction } from 'express';
import { query, param, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { createLogger, requestIdMiddleware } from './logging';
import { apiKeyAuth, originCheck } from './api/middleware/auth';
import { generateAssetStats } from './models';
import { RedisService } from './redis';
import ProviderManager from './providers';

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
        max: 120, // 120 requests per minute
        standardHeaders: true,
        legacyHeaders: false,
        message: 'Too many requests, please try again later.',
        keyGenerator: (req) => req.apiKey || req.ip
    });

    // Create API router
    const apiRouter = express.Router();

    // Apply middleware to API routes
    apiRouter.use(apiKeyAuth);
    apiRouter.use(apiLimiter);

    // Validation error handler
    const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            logger.warn('Validation error in API request', {
                path: req.path,
                errors: errors.array()
            });

            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }
        next();
    };

    // Get all assets
    apiRouter.get('/assets', async (req: Request, res: Response) => {
        try {
            logger.debug('Request for all assets');

            const assets = await redisService.getAllAssets();

            logger.info('All assets request successful', {
                count: assets.length
            });

            res.json({
                success: true,
                count: assets.length,
                data: assets
            });
        } catch (error) {
            logger.error('Error getting all assets', { error });

            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    });

    // Get assets by category
    apiRouter.get(
        '/assets/:category',
        [
            param('category').isIn(['crypto', 'stocks', 'forex', 'indices', 'commodities'])
                .withMessage('Invalid category. Must be one of: crypto, stocks, forex, indices, commodities'),
            handleValidationErrors
        ],
        async (req: Request, res: Response) => {
            try {
                const { category } = req.params;

                logger.debug('Request for assets by category', { category });

                const assets = await redisService.getAssetsByCategory(category);

                if (assets.length === 0) {
                    logger.info('No assets found for category', { category });

                    return res.status(404).json({
                        success: false,
                        error: `No assets found for category: ${category}`
                    });
                }

                logger.info('Category assets request successful', {
                    category,
                    count: assets.length
                });

                res.json({
                    success: true,
                    category,
                    count: assets.length,
                    data: assets
                });
            } catch (error) {
                logger.error('Error getting assets by category', {
                    error,
                    category: req.params.category
                });

                res.status(500).json({
                    success: false,
                    error: 'Internal server error'
                });
            }
        }
    );

    // Get assets by symbols
    apiRouter.get(
        '/asset/symbols',
        [
            query('symbols').isString().notEmpty()
                .withMessage('Symbols parameter is required (comma-separated list)'),
            handleValidationErrors
        ],
        async (req: Request, res: Response) => {
            try {
                const symbols = (req.query.symbols as string).split(',').map(s => s.trim().toUpperCase());

                if (!symbols || symbols.length === 0) {
                    logger.warn('No symbols provided in request');

                    return res.status(400).json({
                        success: false,
                        error: 'No symbols provided. Use ?symbols=BTC,ETH,AAPL'
                    });
                }

                logger.debug('Request for assets by symbols', { symbols });

                const assets = await redisService.getAssetsBySymbols(symbols);

                if (assets.length === 0) {
                    logger.info('No assets found for provided symbols', { symbols });

                    return res.status(404).json({
                        success: false,
                        error: 'No assets found for provided symbols'
                    });
                }

                // Create a map of found symbols
                const foundSymbols = new Set(assets.map(asset => asset.symbol));

                // Find missing symbols
                const missingSymbols = symbols.filter(symbol => !foundSymbols.has(symbol));

                logger.info('Symbols request successful', {
                    requestedCount: symbols.length,
                    foundCount: assets.length,
                    missingCount: missingSymbols.length
                });

                res.json({
                    success: true,
                    count: assets.length,
                    data: assets,
                    missing: missingSymbols.length > 0 ? missingSymbols : undefined
                });
            } catch (error) {
                logger.error('Error getting assets by symbols', {
                    error,
                    symbols: req.query.symbols
                });

                res.status(500).json({
                    success: false,
                    error: 'Internal server error'
                });
            }
        }
    );

    // Get specific asset by ID
    apiRouter.get(
        '/asset/:id',
        [
            param('id').isString().notEmpty()
                .withMessage('Asset ID is required'),
            handleValidationErrors
        ],
        async (req: Request, res: Response) => {
            try {
                const { id } = req.params;

                logger.debug('Request for asset by ID', { id });

                const asset = await redisService.getAsset(id);

                if (!asset) {
                    logger.info('Asset not found', { id });

                    return res.status(404).json({
                        success: false,
                        error: `Asset not found with id: ${id}`
                    });
                }

                logger.info('Asset request successful', { id });

                res.json({
                    success: true,
                    data: asset
                });
            } catch (error) {
                logger.error('Error getting asset by ID', {
                    error,
                    id: req.params.id
                });

                res.status(500).json({
                    success: false,
                    error: 'Internal server error'
                });
            }
        }
    );

    // Get statistics for all assets
    apiRouter.get('/stats', async (req: Request, res: Response) => {
        try {
            logger.debug('Request for overall statistics');

            const assets = await redisService.getAllAssets();
            const stats = generateAssetStats(assets);

            logger.info('Stats request successful');

            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            logger.error('Error getting statistics', { error });

            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    });

    // Get statistics for a category
    apiRouter.get(
        '/stats/:category',
        [
            param('category').isIn(['crypto', 'stocks', 'forex', 'indices', 'commodities'])
                .withMessage('Invalid category. Must be one of: crypto, stocks, forex, indices, commodities'),
            handleValidationErrors
        ],
        async (req: Request, res: Response) => {
            try {
                const { category } = req.params;

                logger.debug('Request for category statistics', { category });

                const assets = await redisService.getAssetsByCategory(category);
                const stats = generateAssetStats(assets);

                logger.info('Category stats request successful', { category });

                res.json({
                    success: true,
                    category,
                    data: stats
                });
            } catch (error) {
                logger.error('Error getting category statistics', {
                    error,
                    category: req.params.category
                });

                res.status(500).json({
                    success: false,
                    error: 'Internal server error'
                });
            }
        }
    );

    // Get available categories
    apiRouter.get('/categories', (req: Request, res: Response) => {
        logger.debug('Request for available categories');

        res.json({
            success: true,
            data: ['crypto', 'stocks', 'forex', 'indices', 'commodities']
        });
    });

    // Force refresh a category
    apiRouter.post(
        '/refresh/:category',
        [
            param('category').isIn(['crypto', 'stocks', 'forex', 'indices', 'commodities'])
                .withMessage('Invalid category. Must be one of: crypto, stocks, forex, indices, commodities'),
            handleValidationErrors
        ],
        async (req: Request, res: Response) => {
            try {
                const { category } = req.params;

                logger.info('Request to force refresh category', { category });

                const result = await providerManager.refreshCategory(category);

                if (!result) {
                    return res.status(404).json({
                        success: false,
                        error: `Provider not found for category: ${category}`
                    });
                }

                res.json({
                    success: true,
                    message: `Refresh initiated for category: ${category}`
                });
            } catch (error) {
                logger.error('Error refreshing category', {
                    error,
                    category: req.params.category
                });

                res.status(500).json({
                    success: false,
                    error: 'Internal server error'
                });
            }
        }
    );

    // Health check endpoint (no auth required)
    app.get('/health', (req: Request, res: Response) => {
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

    // Mount API router
    app.use('/api', apiRouter);

    // Error handler
    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
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
