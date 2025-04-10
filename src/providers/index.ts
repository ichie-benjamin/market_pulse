import {Socket} from 'socket.io';
import {createLogger, Logger} from '../logging';
import {config} from '../config';
import {RedisService} from '../redis';
import {Asset, AssetCategory} from '../models';
import {BaseProvider} from './base';

// Import provider implementations
import FinancialModelingPrepProvider from './financialmodelingprep';
import CexioProvider from './cexio';
import OandaProvider from "./oanda";

const logger: Logger = createLogger('provider-manager');

export interface ProviderMap {
    [category: string]: BaseProvider;
}

class ProviderManager {
    private redis: RedisService;
    private providers: Record<string, BaseProvider>; // By provider name
    private categoryProviders: ProviderMap; // By category
    private directStreamSubscribers: Map<string, Set<Socket>>;
    private categories: AssetCategory[];

    constructor(redisService: RedisService) {
        this.redis = redisService;
        this.providers = {};
        this.categoryProviders = {};
        this.directStreamSubscribers = new Map(); // For Turbo Mode
        this.categories = ['crypto', 'stocks', 'forex', 'indices', 'commodities','metals'];
    }

    /**
     * Initialize all providers
     */
    async initialize(): Promise<boolean> {
        logger.info('Initializing provider manager');

        try {
            // Clear any existing providers
            this.providers = {};
            this.categoryProviders = {};

            // Initialize the providers based on configuration
            await this.initializeProvider('financialmodelingprep');
            await this.initializeProvider('cexio');
            await this.initializeProvider('oanda');
            // Add other providers as needed

            // Map providers to categories
            this.mapProvidersToCategories();

            // Initialize each category
            for (const category of this.categories) {
                await this.initializeCategory(category);
            }

            logger.info('All categories initialized successfully');

            return true;
        } catch (error) {
            logger.error('Failed to initialize provider manager', { error });
            throw error;
        }
    }

    async initializeTest(): Promise<boolean> {
        logger.info('Initializing provider manager');

        logger.info('Provider configuration from config.ts:', {
            cryptoProvider: config.providers.crypto,
            stocksProvider: config.providers.stocks,
            forexProvider: config.providers.forex,
            indicesProvider: config.providers.indices,
            commoditiesProvider: config.providers.commodities
        });

        logger.info('Initializing provider manager');

        try {
            // Clear any existing providers
            this.providers = {};
            this.categoryProviders = {};

            // Initialize each provider and log the result
            const providers = ['financialmodelingprep', 'cexio', 'oanda'];

            for (const providerName of providers) {
                logger.info(`Attempting to initialize provider: ${providerName}`);
                const provider = await this.initializeProvider(providerName);
                logger.info(`Provider ${providerName} initialization result:`, {
                    success: !!provider,
                    loaded: !!this.providers[providerName]
                });
            }

            // After all initializations, log what we actually have
            logger.info('Loaded providers:', {
                availableProviders: Object.keys(this.providers)
            });

            // Map providers to categories
            this.mapProvidersToCategories();

            logger.info('Final category to provider mapping:');

            return true;
        } catch (error) {
            logger.error('Failed to initialize provider manager', { error });
            throw error;
        }
    }

    /**
     * Initialize a specific provider
     */
    async initializeProvider(providerName: string): Promise<BaseProvider | null> {
        try {
            let provider: BaseProvider | null = null;

            // Create provider instance based on name
            switch (providerName) {
                case 'financialmodelingprep':
                    provider = new FinancialModelingPrepProvider(config.apiKeys.financialmodelingprep);
                    break;
                case 'cexio':
                    provider = new CexioProvider(config.apiKeys.cexio);

                    const cexioProvider = provider;

                    cexioProvider.addEventListener('data', (assets: Asset[]) => {
                        this.handleWebSocketData(cexioProvider, assets);
                    });
                    break;
                case 'oanda':
                    provider = new OandaProvider(config.apiKeys.oanda);
                    break;

                // Add other providers here as they're implemented
                default:
                    logger.error(`Unknown provider: ${providerName}`);
                    return null;
            }

            if (!provider) {
                return null;
            }

            // Initialize the provider
            await provider.initialize();

            // Store the provider
            this.providers[providerName] = provider;

            logger.info(`Provider ${providerName} initialized successfully`, {
                supportedCategories: provider.supportedCategories
            });

            return provider;
        } catch (error) {
            logger.error(`Failed to initialize provider: ${providerName}`, { error });
            return null;
        }
    }

    /**
     * New method to handle WebSocket data
     * Processes data from WebSocket providers and updates Redis
     */
    async handleWebSocketData(provider: BaseProvider, assets: Asset[]): Promise<void> {
        try {
            // Update Redis with the new assets
            await this.redis.updateAssets(assets);

            // Directly stream to Turbo Mode subscribers
            this.streamToTurboSubscribers(assets);

            // Log periodic statistics (once every 100 updates)
            if (Math.random() < 0.01) {
                logger.info('WebSocket data processed', {
                    provider: provider.name,
                    assetCount: assets.length
                });
            }
        } catch (error) {
            logger.error('Error handling WebSocket data', {
                error,
                provider: provider.name
            });
        }
    }

    /**
     * Map providers to categories based on what they support
     */
    mapProvidersToCategoriesOld(): void {
        // Reset category mapping
        this.categoryProviders = {};

        // For each provider, check which categories it supports
        Object.values(this.providers).forEach(provider => {
            // Get provider's supported categories
            provider.supportedCategories.forEach(category => {
                // Map category to provider based on configuration
                const configuredProvider = config.providers[category];
                if (configuredProvider === provider.name) {
                    this.categoryProviders[category] = provider;
                    logger.info(`Mapped category ${category} to provider ${provider.name}`);
                }
            });
        });

        // Log categories without assigned providers
        this.categories.forEach(category => {
            if (!this.categoryProviders[category]) {
                logger.warn(`No provider assigned for category: ${category}`);
            }
        });
    }


    mapProvidersToCategories(): void {
        // Reset category mapping
        this.categoryProviders = {};

        // For each provider, check which categories it supports
        Object.values(this.providers).forEach(provider => {
            // Get provider's supported categories
            provider.supportedCategories.forEach(category => {
                // Map category to provider based on configuration
                const configuredProvider = config.providers[category];
                if (configuredProvider === provider.name) {
                    this.categoryProviders[category] = provider;
                    logger.info(`Mapped category ${category} to provider ${provider.name}`);
                }
            });
        });

        // Log categories without assigned providers
        this.categories.forEach(category => {
            if (!this.categoryProviders[category]) {
                // Enhanced logging to help debug provider mapping issues
                logger.warn(`No provider assigned for category: ${category}`, {
                    configuredProvider: config.providers[category],
                    availableProviders: Object.keys(this.providers).join(', '),
                    categoryConfigValue: JSON.stringify(config.providers[category])
                });
            }
        });

        // Additional check for Oanda provider
        if (this.providers['oanda']) {
            logger.info('Oanda provider was successfully initialized', {
                supportedCategories: this.providers['oanda'].supportedCategories,
                initialized: this.providers['oanda'].initialized
            });
        } else {
            logger.error('Oanda provider was not initialized correctly', {
                providersInitialized: Object.keys(this.providers)
            });
        }
    }

    /**
     * Initialize data for a specific category
     */
    async initializeCategory(category: AssetCategory): Promise<void> {
        try {
            const provider = this.categoryProviders[category];

            if (!provider) {
                logger.warn(`No provider configured for category: ${category}`);
                return;
            }

            // Setup connection based on mode
            const connectionMode = config.connectionModes[provider.name];

            if (connectionMode === 'ws') {
                await this.setupWebSocketConnection(provider);
            } else {
                await this.setupApiPolling(provider, category);
            }

            logger.info(`Category initialized: ${category}`, {
                provider: provider.name,
                mode: connectionMode
            });
        } catch (error) {
            logger.error(`Failed to initialize category: ${category}`, { error });
            throw error;
        }
    }

    /**
     * Setup WebSocket connection for a provider
     */
    async setupWebSocketConnection(provider: BaseProvider): Promise<void> {
        try {
            logger.info('Setting up WebSocket connection', {
                provider: provider.name
            });

            // Connect to provider's WebSocket
            // Store connection
            provider.connection = await provider.connectWebSocket();

            logger.info('WebSocket connection established', {
                provider: provider.name
            });
        } catch (error) {
            logger.error('Failed to setup WebSocket connection', {
                error,
                provider: provider.name
            });
        }
    }

    /**
     * Setup API polling for a provider and category
     */
    async setupApiPolling(provider: BaseProvider, category: AssetCategory): Promise<void> {
        try {
            const interval = config.updateIntervals[category];

            logger.info('Setting up API polling', {
                provider: provider.name,
                category,
                interval
            });

            // Immediate first fetch
            await this.fetchAndUpdateFromApi(provider, category);

            // Setup interval for regular polling
            // Store interval in provider
            provider.pollingInterval = setInterval(async () => {
                await this.fetchAndUpdateFromApi(provider, category);
            }, interval);

            logger.info('API polling setup completed', {
                provider: provider.name,
                category,
                interval
            });
        } catch (error) {
            logger.error('Failed to setup API polling', {
                error,
                provider: provider.name,
                category
            });
        }
    }

    /**
     * Fetch data from API and update Redis
     */
    async fetchAndUpdateFromApiOld(provider: BaseProvider, category: AssetCategory): Promise<boolean> {
        try {
            logger.debug('Fetching data from API', {
                provider: provider.name,
                category
            });

            // Fetch data for category
            const result = await provider.getAssetsByCategory(category);

            // Handle error response
            if ('success' in result && !result.success) {
                logger.error('Error fetching data from API', {
                    provider: provider.name,
                    category,
                    error: result.error
                });
                return false;
            }

            const assets = result as Asset[];

            if (assets.length === 0) {
                logger.warn('No assets returned from API', {
                    provider: provider.name,
                    category
                });
                return false;
            }

            // Update Redis
            await this.redis.updateAssets(assets);

            logger.info('API data fetched and stored', {
                provider: provider.name,
                category,
                assetCount: assets.length
            });

            return true;
        } catch (error) {
            logger.error('Error in API fetch and update cycle', {
                error,
                provider: provider.name,
                category
            });
            return false;
        }
    }
    async fetchAndUpdateFromApi(provider: BaseProvider, category: AssetCategory): Promise<boolean> {
        try {
            logger.info('Fetching data from API', {
                provider: provider.name,
                category
            });

            // Add this line to check if the Oanda provider is being called
            if (provider.name === 'oanda') {
                logger.info(`OANDA PROVIDER BEING CALLED for category: ${category}`);
            }

            // Fetch data for category
            const result = await provider.getAssetsByCategory(category);

            // Check for Oanda-specific errors
            if (provider.name === 'oanda') {
                if ('success' in result && !result.success) {
                    logger.error(`OANDA API ERROR for ${category}:`, {
                        error: result.error
                    });
                } else {
                    logger.info(`OANDA SUCCESS for ${category}`, {
                        assetCount: Array.isArray(result) ? result.length : 'unknown'
                    });
                }
            }

            const assets = result as Asset[];

            if (assets.length === 0) {
                logger.warn('No assets returned from API', {
                    provider: provider.name,
                    category
                });
                return false;
            }

            // Update Redis
            await this.redis.updateAssets(assets);

            logger.info('API data fetched and stored', {
                provider: provider.name,
                category,
                assetCount: assets.length
            });

            return true;
        } catch (error) {
            logger.error('Error in API fetch and update cycle', {
                error,
                provider: provider.name,
                category
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
        return this.categoryProviders[category];
    }

    /**
     * Get all category providers
     */
    getAllProviders(): ProviderMap {
        return this.categoryProviders;
    }

    /**
     * Force refresh data for a category
     */
    async refreshCategory(category: AssetCategory): Promise<boolean> {
        const provider = this.categoryProviders[category];

        if (!provider) {
            logger.warn(`No provider found for category: ${category}`);
            return false;
        }

        logger.info(`Manually refreshing data for category: ${category}`);
        return await this.fetchAndUpdateFromApi(provider, category);
    }

    /**
     * Force refresh all data
     */
    async refreshAll(): Promise<Record<string, boolean>> {
        logger.info('Manually refreshing all data');

        const results: Record<string, boolean> = {};

        for (const category of this.categories) {
            if (this.categoryProviders[category]) {
                results[category] = await this.fetchAndUpdateFromApi(
                    this.categoryProviders[category],
                    category
                );
            } else {
                results[category] = false;
            }
        }

        return results;
    }

    /**
     * Shutdown all providers
     */
    async shutdown(): Promise<void> {
        logger.info('Shutting down all providers');

        for (const provider of Object.values(this.providers)) {
            try {
                await provider.shutdown();
                logger.info(`Provider shut down: ${provider.name}`);
            } catch (error) {
                logger.error(`Error shutting down provider: ${provider.name}`, { error });
            }
        }

        this.directStreamSubscribers.clear();
        logger.info('All providers shut down');
    }
}

export default ProviderManager;
