import express, { Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { createLogger } from '../../logging';
import { RedisService } from '../../redis';
import ProviderManager from '../../providers';
import { AssetCategory } from '../../models';
import {
    addAssetToRegistry,
    getAssetRegistryView,
    getAssetRegistryViewWithTwelveDataValidation,
    isValidCategory,
    removeAssetFromRegistry,
    updateAssetInRegistry,
    validateAssetWithTwelveData
} from '../../asset-registry';

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

    const categoryList = ['crypto', 'stocks', 'forex', 'indices', 'commodities', 'metals'];

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
            param('category').isIn(categoryList)
                .withMessage('Invalid category. Must be one of: crypto, stocks, forex, indices, commodities, metals'),
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
            param('category').isIn(categoryList)
                .withMessage('Invalid category. Must be one of: crypto, stocks, forex, indices, commodities, metals'),
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
            data: categoryList
        });
    });

    // Admin: list registry-managed assets (effective/custom/removed/overrides)
    router.get(
        '/admin/assets',
        [
            query('category').optional().isIn(categoryList)
                .withMessage('Invalid category'),
            query('validateWithProvider').optional().isBoolean()
                .withMessage('validateWithProvider must be boolean'),
            query('onlyAvailable').optional().isBoolean()
                .withMessage('onlyAvailable must be boolean'),
            handleValidationErrors
        ],
        async (req: Request, res: Response) => {
            try {
                const category = req.query.category as AssetCategory | undefined;
                const validateWithProvider = req.query.validateWithProvider === 'true'
                const onlyAvailable = req.query.onlyAvailable === 'true'
                const data = validateWithProvider
                    ? await getAssetRegistryViewWithTwelveDataValidation({ category, onlyAvailable })
                    : category
                        ? getAssetRegistryView(category)
                        : getAssetRegistryView()

                res.json({
                    success: true,
                    data
                })
            } catch (error) {
                logger.error('Error listing admin asset registry', { error })
                res.status(500).json({
                    success: false,
                    error: 'Failed to list asset registry'
                })
            }
        }
    )

    // Admin: validate a symbol against Twelvedata
    router.post(
        '/admin/assets/validate',
        [
            body('category').isIn(categoryList)
                .withMessage('Invalid category'),
            body('symbol').isString().notEmpty()
                .withMessage('symbol is required'),
            handleValidationErrors
        ],
        async (req: Request, res: Response) => {
            try {
                const category = req.body.category as AssetCategory
                const symbol = String(req.body.symbol)
                const result = await validateAssetWithTwelveData({ category, symbol })

                res.json({
                    success: true,
                    data: result
                })
            } catch (error) {
                logger.error('Error validating admin asset symbol', {
                    error,
                    body: req.body
                })
                res.status(500).json({
                    success: false,
                    error: 'Failed to validate asset symbol'
                })
            }
        }
    )

    // Admin: add a custom asset to allowed list
    router.post(
        '/admin/assets',
        [
            body('category').isIn(categoryList)
                .withMessage('Invalid category'),
            body('symbol').isString().notEmpty()
                .withMessage('symbol is required'),
            body('displayName').optional({ nullable: true }).isString()
                .withMessage('displayName must be a string'),
            body('tv_sym').optional({ nullable: true }).isString()
                .withMessage('tv_sym must be a string'),
            body('validateWithProvider').optional().isBoolean()
                .withMessage('validateWithProvider must be boolean'),
            body('refresh').optional().isBoolean()
                .withMessage('refresh must be boolean'),
            handleValidationErrors
        ],
        async (req: Request, res: Response) => {
            try {
                const category = req.body.category as AssetCategory
                const symbol = String(req.body.symbol)
                const validateWithProvider = req.body.validateWithProvider !== false
                const refresh = req.body.refresh !== false

                let validation: any = null
                if (validateWithProvider) {
                    validation = await validateAssetWithTwelveData({ category, symbol })
                    if (!validation.available) {
                        return res.status(400).json({
                            success: false,
                            error: 'Symbol validation failed on Twelvedata',
                            validation
                        })
                    }
                }

                const asset = await addAssetToRegistry({
                    category,
                    symbol,
                    displayName: req.body.displayName,
                    tv_sym: req.body.tv_sym
                })

                let refreshed = false
                if (refresh) {
                    refreshed = await providerManager.refreshCategory(category)
                }

                res.status(201).json({
                    success: true,
                    message: 'Asset added successfully',
                    refreshed,
                    data: asset,
                    validation
                })
            } catch (error: any) {
                logger.error('Error adding admin asset', {
                    error,
                    body: req.body
                })

                res.status(400).json({
                    success: false,
                    error: error?.message || 'Failed to add asset'
                })
            }
        }
    )

    // Admin: edit an existing custom asset or override default metadata
    router.put(
        '/admin/assets/:category/:symbol',
        [
            param('category').isIn(categoryList)
                .withMessage('Invalid category'),
            param('symbol').isString().notEmpty()
                .withMessage('symbol is required'),
            body('newSymbol').optional().isString()
                .withMessage('newSymbol must be a string'),
            body('displayName').optional({ nullable: true }).isString()
                .withMessage('displayName must be a string'),
            body('tv_sym').optional({ nullable: true }).isString()
                .withMessage('tv_sym must be a string'),
            body('validateWithProvider').optional().isBoolean()
                .withMessage('validateWithProvider must be boolean'),
            body('refresh').optional().isBoolean()
                .withMessage('refresh must be boolean'),
            handleValidationErrors
        ],
        async (req: Request, res: Response) => {
            try {
                const category = req.params.category as AssetCategory
                const symbol = req.params.symbol
                const validateWithProvider = req.body.validateWithProvider === true
                const refresh = req.body.refresh !== false
                const targetSymbol = req.body.newSymbol || symbol

                let validation: any = null
                if (validateWithProvider) {
                    validation = await validateAssetWithTwelveData({ category, symbol: targetSymbol })
                    if (!validation.available) {
                        return res.status(400).json({
                            success: false,
                            error: 'Symbol validation failed on Twelvedata',
                            validation
                        })
                    }
                }

                const result = await updateAssetInRegistry({
                    category,
                    symbol,
                    newSymbol: req.body.newSymbol,
                    displayName: req.body.displayName,
                    tv_sym: req.body.tv_sym
                })

                let refreshed = false
                if (refresh) {
                    refreshed = await providerManager.refreshCategory(category)
                }

                res.json({
                    success: true,
                    message: 'Asset updated successfully',
                    refreshed,
                    source: result.source,
                    data: result.updated,
                    validation
                })
            } catch (error: any) {
                logger.error('Error updating admin asset', {
                    error,
                    params: req.params,
                    body: req.body
                })

                res.status(400).json({
                    success: false,
                    error: error?.message || 'Failed to update asset'
                })
            }
        }
    )

    // Admin: remove an asset (custom removal or default hide)
    router.delete(
        '/admin/assets/:category/:symbol',
        [
            param('category').isIn(categoryList)
                .withMessage('Invalid category'),
            param('symbol').isString().notEmpty()
                .withMessage('symbol is required'),
            query('refresh').optional().isBoolean()
                .withMessage('refresh must be boolean'),
            handleValidationErrors
        ],
        async (req: Request, res: Response) => {
            try {
                const category = req.params.category
                const symbol = req.params.symbol

                if (!isValidCategory(category)) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid category'
                    })
                }

                const removed = await removeAssetFromRegistry({
                    category,
                    symbol
                })

                let refreshed = false
                const refresh = req.query.refresh !== 'false'
                if (refresh) {
                    refreshed = await providerManager.refreshCategory(category)
                }

                res.json({
                    success: true,
                    message: removed.source === 'none'
                        ? 'Asset was not found in registry'
                        : 'Asset removed successfully',
                    refreshed,
                    data: removed
                })
            } catch (error: any) {
                logger.error('Error removing admin asset', {
                    error,
                    params: req.params
                })
                res.status(400).json({
                    success: false,
                    error: error?.message || 'Failed to remove asset'
                })
            }
        }
    )

    // Admin: validate then add in one request (strict onboarding helper)
    router.post(
        '/admin/assets/onboard',
        [
            body('category').isIn(categoryList)
                .withMessage('Invalid category'),
            body('symbol').isString().notEmpty()
                .withMessage('symbol is required'),
            body('displayName').optional({ nullable: true }).isString(),
            body('tv_sym').optional({ nullable: true }).isString(),
            body('refresh').optional().isBoolean(),
            handleValidationErrors
        ],
        async (req: Request, res: Response) => {
            try {
                const category = req.body.category as AssetCategory
                const symbol = String(req.body.symbol)

                const validation = await validateAssetWithTwelveData({ category, symbol })
                if (!validation.available) {
                    return res.status(400).json({
                        success: false,
                        error: 'Symbol validation failed on Twelvedata',
                        validation
                    })
                }

                const added = await addAssetToRegistry({
                    category,
                    symbol,
                    displayName: req.body.displayName,
                    tv_sym: req.body.tv_sym
                })

                const refresh = req.body.refresh !== false
                let refreshed = false
                if (refresh) {
                    refreshed = await providerManager.refreshCategory(category)
                }

                res.status(201).json({
                    success: true,
                    message: 'Asset validated and added successfully',
                    refreshed,
                    data: added,
                    validation
                })
            } catch (error: any) {
                logger.error('Error onboarding admin asset', {
                    error,
                    body: req.body
                })
                res.status(400).json({
                    success: false,
                    error: error?.message || 'Failed to onboard asset'
                })
            }
        }
    )
    
    router.get('/admin/assets/categories', (req: Request, res: Response) => {
        res.json({
            success: true,
            data: categoryList
        });
    });
}
