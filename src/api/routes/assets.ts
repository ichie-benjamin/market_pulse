import express, { Request, Response } from 'express';
import { query, param, validationResult } from 'express-validator';
import { createLogger } from '../../logging';
import { RedisService } from '../../redis';
import ProviderManager from '../../providers';
import { AssetCategory } from '../../models';

const logger = createLogger('assets-api');

/**
 * Setup asset-related routes
 * @param router - Express router
 * @param redisService - Redis service
 * @param providerManager - Provider manager
 */
export function setupAssetRoutes(
    router: express.Router,
    redisService: RedisService,
    providerManager: ProviderManager
): void {
    // Validation error handler
    const handleValidationErrors = (req: Request, res: Response, next: express.NextFunction) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }
        next();
    };

    // Get all assets
    router.get('/assets', async (req: Request, res: Response) => {
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
    router.get(
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
    router.get(
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
    router.get(
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

    // Force refresh a category
    router.post(
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

                const result = await providerManager.refreshCategory(category as AssetCategory);

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

    // Force refresh all data
    router.post('/refresh', async (req: Request, res: Response) => {
        try {
            logger.info('Request to force refresh all data');

            const results = await providerManager.refreshAll();

            res.json({
                success: true,
                message: 'Refresh initiated for all categories',
                results
            });
        } catch (error) {
            logger.error('Error refreshing all data', { error });

            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    });

    // Get available categories
    router.get('/categories', (req: Request, res: Response) => {
        logger.debug('Request for available categories');

        res.json({
            success: true,
            data: ['crypto', 'stocks', 'forex', 'indices', 'commodities']
        });
    });
}
