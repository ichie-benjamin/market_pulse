import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';
import config from './config';

// Define logger interface
export interface Logger {
    debug: (message: string, context?: Record<string, any>) => void;
    info: (message: string, context?: Record<string, any>) => void;
    warn: (message: string, context?: Record<string, any>) => void;
    error: (message: string, context?: Record<string, any>) => void;
}

// Ensure log directory exists if file logging is enabled
if (config.logging.fileEnabled) {
    const logDir = path.resolve(process.cwd(), config.logging.filePath);
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
}

// Configure pino transports based on configuration
const targets: pino.TransportTargetOptions[] = [];

// Add console transport if enabled
if (config.logging.consoleEnabled) {
    targets.push({
        target: 'pino-pretty',
        level: config.logging.level,
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    });
}

// Add file transport if enabled
if (config.logging.fileEnabled) {
    targets.push({
        target: 'pino/file',
        level: config.logging.level,
        options: {
            destination: path.join(config.logging.filePath, 'market-data.log'),
            mkdir: true
        }
    });
}

// Create the base logger
const pinoLogger = pino({
    level: config.logging.level,
    transport: {
        targets
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
        error: pino.stdSerializers.err,
        // Redact sensitive information
        req: (req: any) => {
            return {
                id: req.id,
                method: req.method,
                url: req.url,
                // Redact API keys and auth headers
                headers: {
                    ...req.headers,
                    authorization: req.headers?.authorization ? '[REDACTED]' : undefined,
                    apikey: req.headers?.apikey ? '[REDACTED]' : undefined
                },
                remoteAddress: req.remoteAddress,
                remotePort: req.remotePort
            };
        }
    }
});

// Request ID middleware for express
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    req.id = req.headers['x-request-id'] as string || uuidv4();
    res.setHeader('x-request-id', req.id);
    next();
};

// Create component-specific logger
export function createLogger(component: string): Logger {
    return {
        debug: (message: string, context: Record<string, any> = {}): void => {
            pinoLogger.debug({ component, ...context }, message);
        },
        info: (message: string, context: Record<string, any> = {}): void => {
            pinoLogger.info({ component, ...context }, message);
        },
        warn: (message: string, context: Record<string, any> = {}): void => {
            pinoLogger.warn({ component, ...context }, message);
        },
        error: (message: string, context: Record<string, any> = {}): void => {
            // If context contains an error object, extract relevant information
            if (context.error) {
                const { error, ...restContext } = context;
                pinoLogger.error({
                    component,
                    ...restContext,
                    error: {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,
                        code: error.code,
                        cause: error.cause
                    }
                }, message);
            } else {
                pinoLogger.error({ component, ...context }, message);
            }
        }
    };
}

// Create the default application logger
export const logger = createLogger('app');

export default {
    logger,
    createLogger,
    requestIdMiddleware
};
