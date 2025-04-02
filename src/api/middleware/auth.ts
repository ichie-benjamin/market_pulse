import { Request, Response, NextFunction } from 'express';
import { Socket } from 'socket.io';
import { config } from '../../config';
import { createLogger, Logger } from '../../logging';

const logger: Logger = createLogger('auth-middleware');

// Add API key and id to request type
declare global {
    namespace Express {
        interface Request {
            apiKey?: string;
            id?: string;
        }
    }
}

/**
 * Middleware to validate API key
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
    // Skip authentication if disabled
    if (!config.auth.enabled) {
        next();
        return;
    }

    // Get API key from request
    const apiKey = req.headers['x-api-key'] as string || req.query.apiKey as string;

    // Check if API key is provided
    if (!apiKey) {
        logger.warn('Missing API key', {
            ip: req.ip,
            path: req.path,
            method: req.method
        });

        res.status(401).json({
            success: false,
            error: 'API key is required'
        });
        return;
    }

    // Check if API key is valid
    if (!config.auth.apiKeys.includes(apiKey)) {
        logger.warn('Invalid API key', {
            ip: req.ip,
            path: req.path,
            method: req.method,
            apiKey: `${apiKey.substring(0, 3)}...${apiKey.substring(apiKey.length - 3)}`
        });

        res.status(401).json({
            success: false,
            error: 'Invalid API key'
        });
        return;
    }

    // API key is valid
    req.apiKey = apiKey;

    logger.debug('API key authenticated', {
        path: req.path,
        method: req.method
    });

    next();
}

/**
 * Middleware to validate origin
 */
export function originCheck(req: Request, res: Response, next: NextFunction): void {
    // Skip origin check if disabled
    if (!config.urlCheck.enabled) {
        next();
        return;
    }

    // Get origin from request
    const origin = req.headers.origin as string || req.headers.referer as string;

    // Skip check if no origin is provided (direct API calls)
    if (!origin) {
        logger.debug('No origin provided, skipping check', {
            ip: req.ip,
            path: req.path,
            method: req.method
        });
        next();
        return;
    }

    // Check if origin is allowed
    const allowed = config.urlCheck.allowedOrigins.some(allowedOrigin => {
        return origin.startsWith(allowedOrigin);
    });

    if (!allowed) {
        logger.warn('Blocked request from unauthorized origin', {
            ip: req.ip,
            path: req.path,
            method: req.method,
            origin
        });

        res.status(403).json({
            success: false,
            error: 'Access denied from this origin'
        });
        return;
    }

    // Origin is allowed
    logger.debug('Origin authorized', {
        path: req.path,
        method: req.method,
        origin
    });

    next();
}

interface SocketWithAuth extends Socket {
    apiKey?: string;
}

/**
 * WebSocket authentication middleware
 */
export function socketAuth(socket: SocketWithAuth, next: (err?: Error) => void): void {
    // Skip authentication if disabled
    if (!config.auth.enabled) {
        next();
        return;
    }

    // Get API key from connection parameters
    const apiKey = socket.handshake.auth.apiKey as string || socket.handshake.query.apiKey as string;

    // Check if API key is provided
    if (!apiKey) {
        logger.warn('Socket connection missing API key', {
            id: socket.id,
            ip: socket.handshake.address
        });

        next(new Error('API key is required'));
        return;
    }

    // Check if API key is valid
    if (!config.auth.apiKeys.includes(apiKey)) {
        logger.warn('Socket connection invalid API key', {
            id: socket.id,
            ip: socket.handshake.address,
            apiKey: `${apiKey.substring(0, 3)}...${apiKey.substring(apiKey.length - 3)}`
        });

        next(new Error('Invalid API key'));
        return;
    }

    // API key is valid
    socket.apiKey = apiKey;

    logger.debug('Socket authenticated', {
        id: socket.id
    });

    next();
}

/**
 * Socket origin check middleware
 */
export function socketOriginCheck(socket: Socket, next: (err?: Error) => void): void {
    // Skip origin check if disabled
    if (!config.urlCheck.enabled) {
        next();
        return;
    }

    // Get origin from handshake
    const origin = socket.handshake.headers.origin as string;

    // Skip check if no origin is provided
    if (!origin) {
        logger.debug('Socket connection no origin provided, skipping check', {
            id: socket.id,
            ip: socket.handshake.address
        });
        next();
        return;
    }

    // Check if origin is allowed
    const allowed = config.urlCheck.allowedOrigins.some(allowedOrigin => {
        return origin.startsWith(allowedOrigin);
    });

    if (!allowed) {
        logger.warn('Blocked socket connection from unauthorized origin', {
            id: socket.id,
            ip: socket.handshake.address,
            origin
        });

        next(new Error('Access denied from this origin'));
        return;
    }

    // Origin is allowed
    logger.debug('Socket origin authorized', {
        id: socket.id,
        origin
    });

    next();
}
