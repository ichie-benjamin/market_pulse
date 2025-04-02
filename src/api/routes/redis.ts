import express, { Request, Response } from 'express';
import { param, validationResult } from 'express-validator';
import { createLogger } from '../../logging';
import { RedisService } from '../../redis';
import { AssetCategory } from '../../models';

const logger = createLogger('redis-api');

/**
 * Setup Redis management routes
 * @param router - Express router
 * @param redisService - Redis service
 */
export function setupRedisRoutes(router: express.Router, redisService: RedisService): void {
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

    // Get Redis info
    router.get('/redis/info', async (req: Request, res: Response) => {
        try {
            logger.info('Request for Redis info');

            const info = await redisService.getInfo();

            res.json({
                success: true,
                data: info
            });
        } catch (error) {
            logger.error('Error getting Redis info', { error });

            res.status(500).json({
                success: false,
                error: 'Failed to get Redis info'
            });
        }
    });

    // Clear all Redis data
    router.post('/redis/clear', async (req: Request, res: Response) => {
        try {
            logger.info('Request to clear all Redis data');

            await redisService.clearAll();

            res.json({
                success: true,
                message: 'All Redis data cleared successfully'
            });
        } catch (error) {
            logger.error('Error clearing Redis data', { error });

            res.status(500).json({
                success: false,
                error: 'Failed to clear Redis data'
            });
        }
    });

    // Clear category data
    router.post(
        '/redis/clear/category/:category',
        [
            param('category').isIn(['crypto', 'stocks', 'forex', 'indices', 'commodities'])
                .withMessage('Invalid category. Must be one of: crypto, stocks, forex, indices, commodities'),
            handleValidationErrors
        ],
        async (req: Request, res: Response) => {
            try {
                const category = req.params.category as AssetCategory;

                logger.info('Request to clear category data', { category });

                await redisService.clearCategory(category);

                res.json({
                    success: true,
                    message: `${category} data cleared successfully`
                });
            } catch (error) {
                logger.error('Error clearing category data', { error, category: req.params.category });

                res.status(500).json({
                    success: false,
                    error: 'Failed to clear category data'
                });
            }
        }
    );

    // Clear asset by ID
    router.post(
        '/redis/clear/asset/:id',
        [
            param('id').isString().notEmpty()
                .withMessage('Asset ID is required'),
            handleValidationErrors
        ],
        async (req: Request, res: Response) => {
            try {
                const id = req.params.id;

                logger.info('Request to clear asset by ID', { id });

                await redisService.clearAsset(id);

                res.json({
                    success: true,
                    message: `Asset with ID ${id} cleared successfully`
                });
            } catch (error) {
                logger.error('Error clearing asset by ID', { error, id: req.params.id });

                res.status(500).json({
                    success: false,
                    error: 'Failed to clear asset by ID'
                });
            }
        }
    );

    // Clear asset by symbol
    router.post(
        '/redis/clear/symbol/:symbol',
        [
            param('symbol').isString().notEmpty()
                .withMessage('Symbol is required'),
            handleValidationErrors
        ],
        async (req: Request, res: Response) => {
            try {
                const symbol = req.params.symbol.toUpperCase();

                logger.info('Request to clear asset by symbol', { symbol });

                await redisService.clearSymbol(symbol);

                res.json({
                    success: true,
                    message: `Asset with symbol ${symbol} cleared successfully`
                });
            } catch (error) {
                logger.error('Error clearing asset by symbol', { error, symbol: req.params.symbol });

                res.status(500).json({
                    success: false,
                    error: 'Failed to clear asset by symbol'
                });
            }
        }
    );
}
