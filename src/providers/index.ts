import { Socket } from 'socket.io';
import { createLogger, Logger } from '../logging';
import { config } from '../config';
import { RedisService } from '../redis';
import { Asset, AssetCategory } from '../models';
import { BaseProvider, ErrorResponse } from './provider';

// Import provider implementations
import FinancialModelingPrepCryptoProvider from './crypto/financialmodelingprep';
import FinancialModelingPrepStocksProvider from './stocks/financialmodelingprep';

const logger: Logger = createLogger('provider-manager');

export interface ProviderMap {
    [category: string]: BaseProvider;
}

class ProviderManager {
    private redis: RedisService;
    private providers: ProviderMap;
    private directStreamSubscribers: Map<string, Set<Socket>>;
    private categories: AssetCategory[];

    constructor(redisService: RedisService) {
        this.redis = redisService;
        this.providers = {};
        this.directStreamSubscribers = new Map(); // For Turbo Mode
        this.categories = ['crypto', 'stocks', 'forex', 'indices', 'commodities'];
    }

    /**
     * Initialize all providers
     */
    async initialize(): Promise<boolean> {
        logger.info('Initializing provider manager');

        try {
            // Initialize providers for each category
            for (const category of this.categories) {
                await this.initializeProviderForCategory(category);
            }

            logger.info('All providers initialized successfully');
            return true;
        } catch (error) {
            logger.error('Failed to initialize provider manager', { error });
            throw error;
        }
    }

    /**
     * Initialize provider for a specific category
     */
    async initializeProviderForCategory(category: AssetCategory): Promise<void> {
        try {
            const providerName = config.providers[category];

            if (!providerName) {
                logger.warn(`No provider configured for category: ${category}`);
                return;
            }

            // Create provider instance
            const provider = this.createProvider(category, providerName);

            if (!provider) {
                logger.error(`Failed to create provider for category: ${category}`);
                return;
            }

            // Initialize provider
            await provider.initialize();

            // Setup connection based on mode
            const connectionMode = config.connectionModes[providerName];

            if (connectionMode === 'ws') {
                await this.setupWebSocketConnection(provider);
            } else {
                await this.setupApiPolling(provider);
            }

            // Store provider
            this.providers[category] = provider;
            logger.info(`Provider initialized for category: ${category}`, {
                provider: providerName,
                mode: connectionMode
            });
        } catch (error) {
            logger.error(`Failed to initialize provider for category: ${category}`, { error });
            throw error;
        }
    }

    /**
     * Create a provider instance based on name and category
     */
    createProvider(category: AssetCategory, providerName: string): BaseProvider | null {
        try {
            // For Financial Modeling Prep, we have category-specific implementations
            if (providerName === 'financialmodelingprep') {
                switch (category) {
                    case 'crypto':
                        return new FinancialModelingPrepCryptoProvider(
                            category,
                            config.apiKeys.financialmodelingprep
                        );

                    case 'stocks':
                        return new FinancialModelingPrepStocksProvider(
                            config.apiKeys.financialmodelingprep
                        );

                    default:
                        // For other categories, use the crypto provider as a fallback
                        logger.warn(`No specific FMP provider for category: ${category}, using crypto provider`);
                        return new FinancialModelingPrepCryptoProvider(
                            category,
                            config.apiKeys.financialmodelingprep
                        );
                }
            }

            // Add more provider implementations as needed

            logger.error(`Unknown provider: ${providerName}`);
            return null;
        } catch (error) {
            logger.error(`Error creating provider: ${providerName}`, { error, category });
            return null;
        }
    }

    /**
     * Setup WebSocket connection for a provider
     */
    async setupWebSocketConnection(provider: BaseProvider): Promise<void> {
        try {
            logger.info('Setting up WebSocket connection', {
                provider: provider.name,
                category: provider.category
            });

            // Connect to provider's WebSocket
            const connection = await provider.connectWebSocket();

            // Setup reconnection logic
            connection.on('disconnect', async (reason: string) => {
                logger.warn(`WebSocket disconnected: ${reason}`, {
                    provider: provider.name,
                    category: provider.category
                });

                // Attempt to reconnect
                setTimeout(async () => {
                    logger.info('Attempting to reconnect WebSocket', {
                        provider: provider.name,
                        category: provider.category,
                        retryCount: provider.retryCount
                    });

                    provider.retryCount++;
                    await this.setupWebSocketConnection(provider);
                }, provider.retryDelay);
            });

            // Setup data handler
            connection.on('data', async (data: any) => {
                try {
                    // Transform data to standard format
                    const assets = provider.transform(data);

                    if (assets && assets.length > 0) {
                        // Update Redis
                        await this.redis.updateAssets(assets);

                        // Directly stream to Turbo Mode subscribers
                        this.streamToTurboSubscribers(assets);

                        // Log periodic statistics (once every 100 updates)
                        if (Math.random() < 0.01) {
                            logger.info('WebSocket data received', {
                                provider: provider.name,
                                category: provider.category,
                                assetCount: assets.length
                            });
                        }
                    }
                } catch (error) {
                    logger.error('Error processing WebSocket data', {
                        error,
                        provider: provider.name,
                        category: provider.category
                    });
                }
            });

            // Store connection
            provider.connection = connection;
            provider.retryCount = 0;

            logger.info('WebSocket connection established', {
                provider: provider.name,
                category: provider.category
            });
        } catch (error) {
            logger.error('Failed to setup WebSocket connection', {
                error,
                provider: provider.name,
                category: provider.category,
                retryCount: provider.retryCount
            });

            // Retry with exponential backoff if under max retries
            if (provider.retryCount < provider.maxRetries) {
                const delay = provider.retryDelay * Math.pow(1.5, provider.retryCount);

                logger.info(`Retrying WebSocket connection in ${delay}ms`, {
                    provider: provider.name,
                    category: provider.category,
                    retryCount: provider.retryCount
                });

                provider.retryCount++;
                setTimeout(() => this.setupWebSocketConnection(provider), delay);
            } else {
                logger.error('Max WebSocket reconnection attempts reached', {
                    provider: provider.name,
                    category: provider.category,
                    maxRetries: provider.maxRetries
                });
            }
        }
    }

    /**
     * Setup API polling for a provider
     */
    async setupApiPolling(provider: BaseProvider): Promise<void> {
        try {
            const interval = config.updateIntervals[provider.category];

            logger.info('Setting up API polling', {
                provider: provider.name,
                category: provider.category,
                interval
            });

            // Immediate first fetch
            await this.fetchAndUpdateFromApi(provider);

            // Setup interval for regular polling
            const timerId = setInterval(async () => {
                await this.fetchAndUpdateFromApi(provider);
            }, interval);

            // Store interval
            provider.pollingInterval = timerId;

            logger.info('API polling setup completed', {
                provider: provider.name,
                category: provider.category,
                interval
            });
        } catch (error) {
            logger.error('Failed to setup API polling', {
                error,
                provider: provider.name,
                category: provider.category
            });
        }
    }

    /**
     * Fetch data from API and update Redis
     */
    async fetchAndUpdateFromApi(provider: BaseProvider): Promise<boolean> {
        try {
            logger.debug('Fetching data from API', {
                provider: provider.name,
                category: provider.category
            });

            // Fetch data
            const result = await provider.fetchAssets();

            // Handle error response
            if ('success' in result && result.success === false) {
                logger.error('Error fetching data from API', {
                    provider: provider.name,
                    category: provider.category,
                    error: result.error
                });
                return false;
            }

            const assets = result as Asset[];

            if (assets.length === 0) {
                logger.warn('No assets returned from API', {
                    provider: provider.name,
                    category: provider.category
                });
                return false;
            }

            // Update Redis
            await this.redis.updateAssets(assets);

            logger.info('API data fetched and stored', {
                provider: provider.name,
                category: provider.category,
                assetCount: assets.length
            });

            return true;
        } catch (error) {
            logger.error('Error in API fetch and update cycle', {
                error,
                provider: provider.name,
                category: provider.category
            });
            return false;
        }
    }

    /**
     * Register a client for Turbo Mode (direct streaming)
     */
    registerTurboClient(socket: Socket, symbols: string[]): void {
        logger.info('Registering client for Turbo Mode', {
            socketId: socket.id,
            symbols
        });

        symbols.forEach(symbol => {
            if (!this.directStreamSubscribers.has(symbol)) {
                this.directStreamSubscribers.set(symbol, new Set<Socket>());
            }
            const subscribers = this.directStreamSubscribers.get(symbol);
            if (subscribers) {
                subscribers.add(socket);
            }
        });

        // Cleanup on disconnect
        socket.on('disconnect', () => {
            logger.info('Removing Turbo Mode client', { socketId: socket.id });

            symbols.forEach(symbol => {
                const subscribers = this.directStreamSubscribers.get(symbol);
                if (subscribers) {
                    subscribers.delete(socket);
                    if (subscribers.size === 0) {
                        this.directStreamSubscribers.delete(symbol);
                    }
                }
            });
        });
    }

    /**
     * Stream data directly to Turbo Mode subscribers
     */
    streamToTurboSubscribers(assets: Asset[]): void {
        let subscribersUpdated = 0;

        for (const asset of assets) {
            const subscribers = this.directStreamSubscribers.get(asset.symbol);
            if (subscribers && subscribers.size > 0) {
                subscribers.forEach(socket => {
                    socket.emit('turbo:update', asset);
                    subscribersUpdated++;
                });
            }
        }

        // Periodically log stats about turbo mode delivery
        if (subscribersUpdated > 0 && Math.random() < 0.01) {
            logger.debug('Turbo Mode updates delivered', {
                subscribersUpdated,
                assetCount: assets.length
            });
        }
    }

    /**
     * Get provider for a category
     */
    getProvider(category: string): BaseProvider | undefined {
        return this.providers[category];
    }

    /**
     * Get all providers
     */
    getAllProviders(): ProviderMap {
        return this.providers;
    }

    /**
     * Force refresh data for a category
     */
    async refreshCategory(category: AssetCategory): Promise<boolean> {
        const provider = this.providers[category];

        if (!provider) {
            logger.warn(`No provider found for category: ${category}`);
            return false;
        }

        logger.info(`Manually refreshing data for category: ${category}`);

        return await this.fetchAndUpdateFromApi(provider);
    }

    /**
     * Shutdown all providers
     */
    async shutdown(): Promise<void> {
        logger.info('Shutting down all providers');

        for (const [category, provider] of Object.entries(this.providers)) {
            try {
                await provider.shutdown();
                logger.info(`Provider shut down: ${category}`);
            } catch (error) {
                logger.error(`Error shutting down provider: ${category}`, { error });
            }
        }

        this.directStreamSubscribers.clear();
        logger.info('All providers shut down');
    }
}

export default ProviderManager;
