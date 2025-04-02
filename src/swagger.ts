// src/swagger.ts - Clean TypeScript-friendly implementation

import { Express, RequestHandler } from 'express';
import * as swaggerUi from 'swagger-ui-express';
// Import version safely with type assertion
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../package.json');

/**
 * Configure and initialize Swagger documentation
 * @param app - Express application
 */
// export function setupSwagger(app: Express): void {
//     // Create a pre-defined spec
//     const swaggerDefinition = {
//         openapi: '3.0.0',
//         info: {
//             title: 'Real-Time Market Data API',
//             version,
//             description: 'API for real-time market data across multiple asset categories',
//         },
//         servers: [
//             {
//                 url: '/',
//                 description: 'Current server',
//             },
//         ],
//         components: {
//             schemas: {
//                 Asset: {
//                     type: 'object',
//                     required: ['id', 'symbol', 'name', 'category', 'price', 'lastUpdated'],
//                     properties: {
//                         id: { type: 'string', example: 'crypto-btcusd' },
//                         symbol: { type: 'string', example: 'BTCUSD' },
//                         name: { type: 'string', example: 'Bitcoin / USD' },
//                         category: {
//                             type: 'string',
//                             enum: ['crypto', 'stocks', 'forex', 'indices', 'commodities'],
//                             example: 'crypto'
//                         },
//                         price: { type: 'number', example: 42500.5 },
//                         priceLow24h: { type: 'number', example: 41800.25 },
//                         priceHigh24h: { type: 'number', example: 43100.75 },
//                         change24h: { type: 'number', example: 1250.5 },
//                         changePercent24h: { type: 'number', example: 3.15 },
//                         volume24h: { type: 'number', example: 15243.75 },
//                         lastUpdated: {
//                             type: 'string',
//                             format: 'date-time',
//                             example: '2023-11-14T12:34:56Z'
//                         }
//                     }
//                 }
//             },
//             securitySchemes: {
//                 ApiKeyAuth: {
//                     type: 'apiKey',
//                     in: 'header',
//                     name: 'x-api-key',
//                 },
//                 ApiKeyQueryParam: {
//                     type: 'apiKey',
//                     in: 'query',
//                     name: 'apiKey',
//                 },
//             },
//         },
//         security: [
//             { ApiKeyAuth: [] },
//             { ApiKeyQueryParam: [] },
//         ],
//         paths: {
//             // Define paths for key endpoints
//             '/api/assets': {
//                 get: {
//                     tags: ['Assets'],
//                     summary: 'Get all assets',
//                     description: 'Retrieve all assets across all categories',
//                     responses: {
//                         '200': {
//                             description: 'A list of all assets',
//                             content: {
//                                 'application/json': {
//                                     schema: {
//                                         type: 'object',
//                                         properties: {
//                                             success: { type: 'boolean', example: true },
//                                             count: { type: 'integer', example: 150 },
//                                             data: {
//                                                 type: 'array',
//                                                 items: {
//                                                     $ref: '#/components/schemas/Asset'
//                                                 }
//                                             }
//                                         }
//                                     }
//                                 }
//                             }
//                         }
//                     }
//                 }
//             },
//             // Add other important endpoints
//             '/api/assets/{category}': {
//                 get: {
//                     tags: ['Assets'],
//                     summary: 'Get assets by category',
//                     parameters: [
//                         {
//                             name: 'category',
//                             in: 'path',
//                             required: true,
//                             schema: {
//                                 type: 'string',
//                                 enum: ['crypto', 'stocks', 'forex', 'indices', 'commodities']
//                             }
//                         }
//                     ],
//                     responses: {
//                         '200': {
//                             description: 'Assets in the category'
//                         }
//                     }
//                 }
//             }
//         }
//     };
//
//     // Set up swagger-ui-express with proper TypeScript typing
//     const swaggerHandler = swaggerUi.setup(swaggerDefinition, {
//         explorer: true,
//         customCss: '.swagger-ui .topbar { display: none }',
//         swaggerOptions: {
//             docExpansion: 'list',
//             filter: true,
//             showRequestDuration: true,
//         }
//     });
//
//     // Split into separate middleware declarations
//     app.use('/api-docs', swaggerUi.serve);
//     app.get('/api-docs', (req: Request, res: Response, next: NextFunction) => {
//         swaggerHandler(req, res, next);
//     });
//
//     // Keep the JSON endpoint
//     app.get('/api-docs.json', (req, res) => {
//         res.setHeader('Content-Type', 'application/json');
//         res.send(swaggerDefinition);
//     });
// }
