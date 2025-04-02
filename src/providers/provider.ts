import { Logger, createLogger } from '../logging';
import { Asset, AssetCategory } from '../models';

// Define provider connection interface
export interface ProviderConnection {
    on: (event: string, callback: (data: any) => void) => void;
    close: () => void;
}

// Define error response interface
export interface ErrorResponse {
    success: false;
    error: {
        message: string;
        code: string;
        operation: string;
    };
}

/**
 * Base provider class that all provider implementations should extend
 */
export abstract class BaseProvider {
    public name: string;
    public category: AssetCategory;
    public apiKey?: string;
    public connection: ProviderConnection | null;
    public pollingInterval: NodeJS.Timeout | null;
    public retryCount: number;
    public maxRetries: number;
    public retryDelay: number;
    public initialized: boolean;
    protected logger: Logger;

    /**
     * Create a new provider instance
     * @param name - Provider name
     * @param category - Asset category
     * @param apiKey - API key for the provider
     */
    constructor(name: string, category: AssetCategory, apiKey?: string) {
        this.name = name;
        this.category = category;
        this.apiKey = apiKey;
        this.connection = null;
        this.pollingInterval = null;
        this.retryCount = 0;
        this.maxRetries = 5;
        this.retryDelay = 5000; // 5 seconds
        this.initialized = false;
        this.logger = createLogger(`provider-${name}-${category}`);
    }

    /**
     * Initialize the provider
     * Must be implemented by each provider
     */
    abstract initialize(): Promise<void>;

    /**
     * Fetch all assets from the provider
     * Must be implemented by API-based providers
     */
    abstract fetchAssets(): Promise<Asset[] | ErrorResponse>;

    /**
     * Fetch specific assets by symbols
     * Can be overridden by providers for optimized fetching
     * @param symbols - Array of asset symbols
     */
    async fetchBySymbols(symbols: string[]): Promise<Asset[] | ErrorResponse> {
        // Default implementation fetches all and filters
        // Providers should override this with more efficient implementations when possible
        const result = await this.fetchAssets();

        if ('error' in result) {
            return result;
        }

        return result.filter(asset => symbols.includes(asset.symbol));
    }

    /**
     * Connect to WebSocket
     * Must be implemented by WebSocket-based providers
     */
    async connectWebSocket(): Promise<ProviderConnection> {
        throw new Error('WebSocket connection not supported for this provider');
    }

    /**
     * Disconnect WebSocket
     * Must be implemented by WebSocket-based providers
     */
    async disconnectWebSocket(): Promise<void> {
        throw new Error('WebSocket connection not supported for this provider');
    }

    /**
     * Transform provider-specific data to standard format
     * Must be implemented by each provider
     * @param data - Provider-specific data
     */
    abstract transform(data: any): Asset[];

    /**
     * Handle and process errors
     * @param error - The error object
     * @param operation - The operation that caused the error
     * @param context - Additional context about the error
     */
    protected handleError(error: Error, operation: string, context: Record<string, any> = {}): ErrorResponse {
        this.logger.error(`Error during ${operation}`, {
            error,
            provider: this.name,
            category: this.category,
            ...context
        });

        return {
            success: false,
            error: {
                message: error.message,
                code: (error as any).code || 'UNKNOWN_ERROR',
                operation
            }
        };
    }

    /**
     * Shutdown the provider
     */
    async shutdown(): Promise<void> {
        this.logger.info('Shutting down provider', {
            provider: this.name,
            category: this.category
        });

        // Stop polling interval if exists
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }

        // Disconnect WebSocket if exists
        if (this.connection) {
            try {
                await this.disconnectWebSocket();
            } catch (error) {
                this.logger.error('Error disconnecting WebSocket', {
                    error,
                    provider: this.name,
                    category: this.category
                });
            }
        }

        this.logger.info('Provider shut down successfully', {
            provider: this.name,
            category: this.category
        });
    }
}

export default BaseProvider;
