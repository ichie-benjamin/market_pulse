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
    public supportedCategories: AssetCategory[];
    public apiKey?: string;
    public connection: ProviderConnection | null;
    public pollingInterval: NodeJS.Timeout | null;
    public retryCount: number;
    public maxRetries: number;
    public retryDelay: number;
    public initialized: boolean;
    protected logger: Logger;



    /**
     * Event handlers for WebSocket providers
     * This is used to register callbacks for WebSocket events
     */
    protected eventHandlers: Array<{ event: string, callback: (data: any) => void }> = [];

    /**
     * Register an event handler
     * This is particularly useful for WebSocket providers to handle events
     * @param event - Event name
     * @param callback - Event handler callback
     */
    public addEventListener(event: string, callback: (data: any) => void): void {
        this.eventHandlers.push({ event, callback });
    }

    /**
     * Get registered event handlers for a specific event
     * @param event - Event name
     * @returns Array of event handler callbacks
     */
    public getEventHandlers(event: string): ((data: any) => void)[] {
        return this.eventHandlers
            .filter(handler => handler.event === event)
            .map(handler => handler.callback);
    }

    /**
     * Create a new provider instance
     * @param name - Provider name
     * @param supportedCategories - Categories supported by this provider
     * @param apiKey - API key for the provider
     */
    constructor(name: string, supportedCategories: AssetCategory[], apiKey?: string) {
        this.name = name;
        this.supportedCategories = supportedCategories;
        this.apiKey = apiKey;
        this.connection = null;
        this.pollingInterval = null;
        this.retryCount = 0;
        this.maxRetries = 5;
        this.retryDelay = 5000; // 5 seconds
        this.initialized = false;
        this.logger = createLogger(`provider-${name}`);
    }

    /**
     * Initialize the provider
     * Must be implemented by each provider
     */
    abstract initialize(): Promise<void>;

    /**
     * Fetch all allowed assets from the provider across all categories
     * Must be implemented by each provider - this is the main method used by the system
     */
    abstract getAllAssets(): Promise<Asset[] | ErrorResponse>;

    /**
     * Fetch assets for a specific category
     * Can be overridden by providers for optimized fetching
     * @param category - Asset category
     */
    abstract getAssetsByCategory(category: AssetCategory): Promise<Asset[] | ErrorResponse>;

    /**
     * Fetch specific assets by symbols
     * Can be overridden by providers for optimized fetching
     * @param symbols - Array of asset symbols
     */
    abstract getAssetsBySymbols(symbols: string[]): Promise<Asset[] | ErrorResponse>;

    /**
     * Check if provider supports a specific category
     * @param category - Category to check
     */
    supportsCategory(category: AssetCategory): boolean {
        return this.supportedCategories.includes(category);
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
     * @param category - Optional category to filter results
     */
    abstract transform(data: any, category?: AssetCategory): Asset[];

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
            provider: this.name
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
                    provider: this.name
                });
            }
        }

        this.logger.info('Provider shut down successfully', {
            provider: this.name
        });
    }
}

export default BaseProvider;
