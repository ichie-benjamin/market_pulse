import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { Asset, AssetCategory } from '../models/asset';
import { logger } from '../utils/logger';
import { config, ProviderConnectionMethod } from '../config';

/**
 * Base provider interface for market data providers
 */
export abstract class BaseProvider extends EventEmitter {
    protected name: string;
    protected category: AssetCategory;
    protected connectionMethod: ProviderConnectionMethod;
    protected apiBaseUrl: string;
    protected wsUrl: string;
    protected apiKey?: string;
    protected apiSecret?: string;

    // HTTP client for API requests
    protected apiClient: AxiosInstance;

    // WebSocket client
    protected wsClient: WebSocket | null = null;
    protected wsConnected: boolean = false;
    protected reconnectAttempts: number = 0;
    protected maxReconnectAttempts: number = 10;
    protected reconnectInterval: number = 1000;

    constructor(
        name: string,
        category: AssetCategory,
        apiBaseUrl: string,
        wsUrl: string,
        apiKey?: string,
        apiSecret?: string
    ) {
        super();
        this.name = name;
        this.category = category;
        this.apiBaseUrl = apiBaseUrl;
        this.wsUrl = wsUrl;
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.connectionMethod = config.providers.connectionMethod;

        // Create HTTP client
        this.apiClient = axios.create({
            baseURL: apiBaseUrl,
            timeout: 10000,
            headers: this.getApiHeaders()
        });
    }

    /**
     * Initialize the provider connection based on configured method
     */
    public async connect(): Promise<void> {
        if (this.connectionMethod === 'websocket') {
            await this.connectWebSocket();
        } else {
            // For API method, we'll just verify connection works
            try {
                await this.testApiConnection();
                logger.info(`${this.name} API connection verified`);
            } catch (error) {
                logger.error(`${this.name} API connection failed:`, error);
                throw error;
            }
        }
    }

    /**
     * Disconnect the provider
     */
    public async disconnect(): Promise<void> {
        if (this.wsClient) {
            this.wsClient.terminate();
            this.wsClient = null;
            this.wsConnected = false;
            logger.info(`${this.name} WebSocket disconnected`);
        }
    }

    /**
     * Connect to WebSocket API
     */
    protected async connectWebSocket(): Promise<void> {
        if (this.wsClient) {
            this.wsClient.terminate();
        }

        try {
            logger.info(`Connecting to ${this.name} WebSocket...`);

            this.wsClient = new WebSocket(this.wsUrl, {
                headers: this.getWsHeaders()
            });

            this.wsClient.on('open', () => {
                this.wsConnected = true;
                this.reconnectAttempts = 0;
                logger.info(`${this.name} WebSocket connected`);
                this.onWsOpen();
            });

            this.wsClient.on('message', (data: WebSocket.Data) => {
                try {
                    const message = data.toString();
                    this.handleWsMessage(message);
                } catch (error) {
                    logger.error(`${this.name} WebSocket message error:`, error);
                }
            });

            this.wsClient.on('error', (error) => {
                logger.error(`${this.name} WebSocket error:`, error);
            });

            this.wsClient.on('close', (code, reason) => {
                this.wsConnected = false;
                logger.warn(`${this.name} WebSocket closed: ${code} ${reason}`);
                this.attemptReconnect();
            });
        } catch (error) {
            logger.error(`${this.name} WebSocket connection failed:`, error);
            throw error;
        }
    }

    /**
     * Attempt to reconnect WebSocket
     */
    protected attemptReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error(`${this.name} WebSocket max reconnect attempts reached`);
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectInterval * Math.min(this.reconnectAttempts, 10);

        logger.info(`${this.name} WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
            this.connectWebSocket().catch(error => {
                logger.error(`${this.name} WebSocket reconnect failed:`, error);
            });
        }, delay);
    }

    /**
     * Test API connection
     */
    protected abstract testApiConnection(): Promise<void>;

    /**
     * Handle WebSocket message
     */
    protected abstract handleWsMessage(message: string): void;

    /**
     * Called when WebSocket connection is opened
     */
    protected abstract onWsOpen(): void;

    /**
     * Get HTTP headers for API requests
     */
    protected abstract getApiHeaders(): Record<string, string>;

    /**
     * Get WebSocket headers
     */
    protected abstract getWsHeaders(): Record<string, string>;

    /**
     * Fetch asset data via API
     */
    public abstract fetchAsset(symbol: string): Promise<Asset | null>;

    /**
     * Fetch multiple assets via API
     */
    public abstract fetchAssets(symbols?: string[]): Promise<Asset[]>;

    /**
     * Get provider name
     */
    public getName(): string {
        return this.name;
    }

    /**
     * Get provider category
     */
    public getCategory(): AssetCategory {
        return this.category;
    }

    /**
     * Get connection status
     */
    public isConnected(): boolean {
        if (this.connectionMethod === 'websocket') {
            return this.wsConnected;
        }
        return true; // API method is always "connected"
    }
}
