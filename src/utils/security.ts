import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { logger } from './logger';

/**
 * Validate API key against allowed keys in config
 */
export function validateApiKey(apiKey: string): boolean {
    return config.security.apiKeys.includes(apiKey);
}

/**
 * Express middleware to validate API key
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
    try {
        // Get API key from header
        const apiKey = req.headers['x-api-key'] as string;

        // Check if API key is provided and valid
        if (!apiKey || !validateApiKey(apiKey)) {
            res.status(401).json({
                success: false,
                message: 'Unauthorized: Invalid API key'
            });
            // Don't return the response object, just end the function
            return;
        }

        // API key is valid, proceed
        next();
    } catch (error) {
        logger.error('API key validation error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
        // Don't return the response object
    }
}
