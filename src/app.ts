import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { logger } from './utils/logger';
import { apiKeyAuth } from './utils/security';
import { getAllAssetIds, getAssetsByIds, getAssetsByCategory } from './services/redis-service';
import { getAssetData } from './services/data-service';

// Create Express app
const app = express();

// Apply middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(compression());

// Simple request logging
app.use((req: Request, res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.url}`);
    next();
});

// Health check endpoint (no auth required)
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

// API routes - all protected with API key
app.use('/api', createApiRoutes());

// 404 handler
app.use((req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.url}`
    });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('API error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

/**
 * Create API routes
 */
function createApiRoutes() {
    const router = express.Router();

    // Get all assets
    router.get('/assets', async (req: Request, res: Response) => {
        try {
            const assetIds = await getAllAssetIds();
            const assets = await getAssetsByIds(assetIds);

            res.json({
                success: true,
                count: assets.length,
                data: assets
            });
        } catch (error) {
            logger.error('Error fetching assets:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch assets'
            });
        }
    });

    // Get assets by category
    router.get('/assets/category/:category', async (req: Request, res: Response) => {
        try {
            const { category } = req.params;
            const assets = await getAssetsByCategory(category);

            res.json({
                success: true,
                category,
                count: assets.length,
                data: assets
            });
        } catch (error) {
            logger.error(`Error fetching assets for category ${req.params.category}:`, error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch assets'
            });
        }
    });

    // Get specific asset
    router.get('/assets/:assetId', async (req: Request, res: Response) => {
        try {
            const { assetId } = req.params;
            const refresh = req.query.refresh === 'true';

            const asset = await getAssetData(assetId, refresh);

            if (!asset) {
                return res.status(404).json({
                    success: false,
                    message: `Asset not found: ${assetId}`
                });
            }

            res.json({
                success: true,
                data: asset
            });
        } catch (error) {
            logger.error(`Error fetching asset ${req.params.assetId}:`, error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch asset'
            });
        }
    });

    return router;
}

export { app };
