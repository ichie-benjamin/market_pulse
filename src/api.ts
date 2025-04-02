import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createLogger, requestIdMiddleware } from './logging';
import { RedisService } from './redis';
import ProviderManager from './providers';
import {setupApiRoutes} from "./api/index";

const logger = createLogger('api');

/**
 * Set up Express app with API routes
 * @param redisService - Redis service
 * @param providerManager - Provider manager
 * @returns Express application
 */
export function setupApi(
    redisService: RedisService,
    providerManager: ProviderManager
): express.Application {
    logger.info('Setting up Express application');

    // Create Express app
    const app = express();

    // Apply middleware
    app.use(helmet());
    app.use(cors());
    app.use(express.json());
    app.use(requestIdMiddleware);

    // Set up API routes
    setupApiRoutes(app, redisService, providerManager);

    logger.info('Express application setup completed');

    return app;
}
