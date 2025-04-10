import express, { Request, Response } from 'express';
import { param, validationResult } from 'express-validator';
import { createLogger } from '../../logging';
import { RedisService } from '../../redis';
import { generateAssetStats } from '../../models';

const logger = createLogger('stats-api');

/**
 * Setup statistics routes
 * @param router - Express router
 * @param redisService - Redis service
 */
export function setupStatsRoutes(
    router: express.Router,
    redisService: RedisService
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

    // Get statistics for all assets
    router.get('/stats', async (req: Request, res: Response) => {
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
    router.get(
        '/stats/:category',
        [
            param('category').isIn(['crypto', 'stocks', 'forex', 'indices', 'commodities','metals'])
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
}
