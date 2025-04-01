import pino from 'pino';
import { config } from '../config';

// Create logger instance
const logger = pino({
    level: config.app.logLevel,
    transport: config.app.env === 'development'
        ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname'
            }
        }
        : undefined,
    timestamp: pino.stdTimeFunctions.isoTime
});

export { logger };
