import { BaseProvider } from './base-provider';
import { Asset, AssetCategory, generateAssetId, createBasicAsset } from '../models/asset';
import { logger } from '../utils/logger';
import WebSocket from 'ws';

// Financial Modeling Prep WebSocket message interfaces
interface FMPCryptoMessage {
    s: string;        // Symbol
    t: number;        // Timestamp
    e: string;        // Exchange
    type: string;     // Message type
    bs: number;       // Bid size
    bp: number;       // Bid price
    as: number;       // Ask size
    ap: number;       // Ask price
}

interface FMPForexMessage {
    s: string;        // Symbol
    t: number;        // Timestamp
    type: string;     // Message type
    ap: number;       // Ask price
    as: number;       // Ask size
    bp: number;       // Bid price
    bs: number;       // Bid size
}

// WebSocket message types
interface FMPLoginMessage {
    event: string;
    data: {
        apiKey: string; // Must match exactly what's in the documentation "your_api_key"
    };
}

interface FMPSubscribeMessage {
    event: string;
    data: {
        ticker: string[];
    };
}

/**
 * Financial Modeling Prep provider implementation
 * Supports both crypto and forex data
 */
export class FinancialModelingPrepProvider extends BaseProvider {
    private assetMap: Map<string, Asset> = new Map();
    private cryptoWsClient: WebSocket | null = null;
    private forexWsClient: WebSocket | null = null;
    private cryptoConnected: boolean = false;
    private forexConnected: boolean = false;
    private cryptoSymbols: string[] = ['btcusd', 'ethusd', 'xrpusd', 'ltcusd', 'bchusd'];
    private forexSymbols: string[] = ['eurusd', 'gbpusd', 'usdjpy', 'audusd', 'usdcad'];
    private apiKeyHeader: string = 'apikey';

    constructor(
        apiBaseUrl: string, 
        cryptoWsUrl: string, 
        forexWsUrl: string,
        apiKey?: string
    ) {
        super(
            'financialmodelingprep',
            AssetCategory.CRYPTOCURRENCY, // Default category, will be set per asset
            apiBaseUrl,
            cryptoWsUrl,
            apiKey
        );
        
        // Store the forex WS URL
        this.forexWsUrl = forexWsUrl;
    }

    /**
     * Test API connection
     */
    protected async testApiConnection(): Promise<void> {
        try {
            // Try to get profile endpoint as a test
            const response = await this.apiClient.get('/api/v3/financial-statement-symbol-lists', {
                params: {
                    apikey: this.apiKey
                }
            });
            
            if (!response.data) {
                throw new Error('Invalid API response');
            }
        } catch (error) {
            logger.error('FMP API connection test failed:', error);
            throw new Error('Financial Modeling Prep API connection failed');
        }
    }
    
    /**
     * Connect to both crypto and forex WebSockets
     */
    public async connect(): Promise<void> {
        // Connect to both WebSocket endpoints if using WebSocket method
        if (this.connectionMethod === 'websocket') {
            try {
                // Connect to crypto WebSocket
                await this.connectCryptoWebSocket();
                
                // Connect to forex WebSocket
                await this.connectForexWebSocket();
                
                // Wait for both connections to be established
                await this.waitForConnections();
            } catch (error) {
                logger.error('FMP WebSocket connection failed:', error);
                throw error;
            }
        } else {
            // For API method, just verify connection works
            await this.testApiConnection();
            logger.info(`${this.name} API connection verified`);
        }
    }

    /**
     * Connect to Crypto WebSocket
     */
    private async connectCryptoWebSocket(): Promise<void> {
        if (this.cryptoWsClient) {
            this.cryptoWsClient.close();
        }
        
        try {
            logger.info('Connecting to FMP Crypto WebSocket...');
            
            this.cryptoWsClient = new WebSocket(this.wsUrl);
            
            this.cryptoWsClient.addEventListener('open', () => {
                this.cryptoConnected = true;
                logger.info('FMP Crypto WebSocket connected');
                
                // Add a small delay before sending login to ensure connection is ready
                setTimeout(() => {
                    // Send login message
                    if (this.apiKey) {
                        const loginMessage: FMPLoginMessage = {
                            event: 'login',
                            data: {
                                apiKey: this.apiKey
                            }
                        };
                        this.cryptoWsClient?.send(JSON.stringify(loginMessage));
                        logger.info('FMP Crypto WebSocket login sent');
                        
                        // Wait for login to process before subscribing
                        setTimeout(() => {
                            // Subscribe to crypto symbols
                            const subscribeMessage: FMPSubscribeMessage = {
                                event: 'subscribe',
                                data: {
                                    ticker: this.cryptoSymbols
                                }
                            };
                            this.cryptoWsClient?.send(JSON.stringify(subscribeMessage));
                            logger.info(`FMP Crypto WebSocket subscribed to ${this.cryptoSymbols.join(', ')}`);
                        }, 500);
                    } else {
                        // If no API key, just subscribe directly
                        const subscribeMessage: FMPSubscribeMessage = {
                            event: 'subscribe',
                            data: {
                                ticker: this.cryptoSymbols
                            }
                        };
                        this.cryptoWsClient?.send(JSON.stringify(subscribeMessage));
                        logger.info(`FMP Crypto WebSocket subscribed to ${this.cryptoSymbols.join(', ')}`);
                    }
                }, 1000);
            });
            
            this.cryptoWsClient.addEventListener('message', (event: WebSocket.MessageEvent) => {
                try {
                    const message = event.data.toString();
                    this.handleCryptoWsMessage(message);
                } catch (error: any) {
                    logger.error('FMP Crypto WebSocket message error:', error);
                }
            });
            
            this.cryptoWsClient.addEventListener('error', (error: WebSocket.ErrorEvent) => {
                logger.error('FMP Crypto WebSocket error:', error);
                // Log more detailed error information if available
                if (error.message) {
                    logger.error(`Error message: ${error.message}`);
                }
                if (error.error) {
                    logger.error(`Underlying error: ${JSON.stringify(error.error)}`);
                }
            });
            
            this.cryptoWsClient.addEventListener('close', (event: WebSocket.CloseEvent) => {
                this.cryptoConnected = false;
                logger.warn(`FMP Crypto WebSocket closed: ${event.code} ${event.reason}`);
                this.attemptReconnectCrypto();
            });
        } catch (error) {
            logger.error('FMP Crypto WebSocket connection failed:', error);
            throw error;
        }
    }
    
    /**
     * Connect to Forex WebSocket
     */
    private async connectForexWebSocket(): Promise<void> {
        if (this.forexWsClient) {
            this.forexWsClient.close();
        }
        
        try {
            logger.info('Connecting to FMP Forex WebSocket...');
            
            if (!this.forexWsUrl) {
                throw new Error('Forex WebSocket URL not defined');
            }
            this.forexWsClient = new WebSocket(this.forexWsUrl);
            
            this.forexWsClient.addEventListener('open', () => {
                this.forexConnected = true;
                logger.info('FMP Forex WebSocket connected');
                
                // Add a small delay before sending login to ensure connection is ready
                setTimeout(() => {
                    // Send login message
                    if (this.apiKey) {
                        const loginMessage: FMPLoginMessage = {
                            event: 'login',
                            data: {
                                apiKey: this.apiKey
                            }
                        };
                        this.forexWsClient?.send(JSON.stringify(loginMessage));
                        logger.info('FMP Forex WebSocket login sent');
                        
                        // Wait for login to process before subscribing
                        setTimeout(() => {
                            // Subscribe to forex symbols
                            const subscribeMessage: FMPSubscribeMessage = {
                                event: 'subscribe',
                                data: {
                                    ticker: this.forexSymbols
                                }
                            };
                            this.forexWsClient?.send(JSON.stringify(subscribeMessage));
                            logger.info(`FMP Forex WebSocket subscribed to ${this.forexSymbols.join(', ')}`);
                        }, 500);
                    } else {
                        // If no API key, just subscribe directly
                        const subscribeMessage: FMPSubscribeMessage = {
                            event: 'subscribe',
                            data: {
                                ticker: this.forexSymbols
                            }
                        };
                        this.forexWsClient?.send(JSON.stringify(subscribeMessage));
                        logger.info(`FMP Forex WebSocket subscribed to ${this.forexSymbols.join(', ')}`);
                    }
                }, 1000);
            });
            
            this.forexWsClient.addEventListener('message', (event: WebSocket.MessageEvent) => {
                try {
                    const message = event.data.toString();
                    this.handleForexWsMessage(message);
                } catch (error: any) {
                    logger.error('FMP Forex WebSocket message error:', error);
                }
            });
            
            this.forexWsClient.addEventListener('error', (error: WebSocket.ErrorEvent) => {
                logger.error('FMP Forex WebSocket error:', error);
                // Log more detailed error information if available
                if (error.message) {
                    logger.error(`Error message: ${error.message}`);
                }
                if (error.error) {
                    logger.error(`Underlying error: ${JSON.stringify(error.error)}`);
                }
            });
            
            this.forexWsClient.addEventListener('close', (event: WebSocket.CloseEvent) => {
                this.forexConnected = false;
                logger.warn(`FMP Forex WebSocket closed: ${event.code} ${event.reason}`);
                this.attemptReconnectForex();
            });
        } catch (error) {
            logger.error('FMP Forex WebSocket connection failed:', error);
            throw error;
        }
    }
    
    /**
     * Wait for both WebSocket connections to be established
     */
    private async waitForConnections(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // More generous timeout (20 seconds)
            const timeout = setTimeout(() => {
                // Log detailed connection status before rejecting
                logger.error(`Connection timeout - Crypto connected: ${this.cryptoConnected}, Forex connected: ${this.forexConnected}`);
                reject(new Error('WebSocket connection timeout after 20 seconds'));
            }, 20000);
            
            let checkCount = 0;
            const checkConnections = () => {
                checkCount++;
                // Log progress every second
                if (checkCount % 10 === 0) {
                    logger.debug(`Waiting for connections - Crypto: ${this.cryptoConnected}, Forex: ${this.forexConnected}`);
                }
                
                if (this.cryptoConnected && this.forexConnected) {
                    clearTimeout(timeout);
                    logger.info('Both WebSocket connections established successfully');
                    resolve();
                } else if (checkCount > 200) { // 20 seconds max
                    clearTimeout(timeout);
                    // If at least one connection is established, we can proceed
                    if (this.cryptoConnected || this.forexConnected) {
                        logger.warn(`Proceeding with partial connection - Crypto: ${this.cryptoConnected}, Forex: ${this.forexConnected}`);
                        resolve();
                    } else {
                        reject(new Error('Failed to establish any WebSocket connections'));
                    }
                } else {
                    setTimeout(checkConnections, 100);
                }
            };
            
            checkConnections();
        });
    }
    
    /**
     * Attempt to reconnect to Crypto WebSocket
     */
    private attemptReconnectCrypto(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error('FMP Crypto WebSocket max reconnect attempts reached');
            return;
        }
        
        this.reconnectAttempts++;
        const delay = this.reconnectInterval * Math.min(this.reconnectAttempts, 10);
        
        logger.info(`FMP Crypto WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        
        setTimeout(() => {
            this.connectCryptoWebSocket().catch(error => {
                logger.error('FMP Crypto WebSocket reconnect failed:', error);
            });
        }, delay);
    }
    
    /**
     * Attempt to reconnect to Forex WebSocket
     */
    private attemptReconnectForex(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error('FMP Forex WebSocket max reconnect attempts reached');
            return;
        }
        
        this.reconnectAttempts++;
        const delay = this.reconnectInterval * Math.min(this.reconnectAttempts, 10);
        
        logger.info(`FMP Forex WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        
        setTimeout(() => {
            this.connectForexWebSocket().catch(error => {
                logger.error('FMP Forex WebSocket reconnect failed:', error);
            });
        }, delay);
    }

    /**
     * Handle WebSocket message (required by BaseProvider)
     * This delegates to the specialized handlers
     */
    protected handleWsMessage(message: string): void {
        // This is just a placeholder to satisfy the abstract method
        // Actual handling happens in specialized methods
    }
    
    /**
     * Handle Crypto WebSocket message
     */
    private handleCryptoWsMessage(message: string): void {
        try {
            const data = JSON.parse(message) as FMPCryptoMessage;
            
            // Only process message if it has the required fields
            if (!data.s || data.type !== 'Q') {
                return;
            }
            
            // Extract the symbol and convert to our format
            const symbol = data.s.toUpperCase();
            
            // Determine asset category and provider name
            const category = AssetCategory.CRYPTOCURRENCY;
            const provider = this.name;
            
            // Generate the asset ID
            const assetId = generateAssetId(symbol, provider, category);
            
            // Get the existing asset or create a basic one
            let asset = this.assetMap.get(assetId);
            
            if (!asset) {
                // Create a new asset
                asset = createBasicAsset(symbol, provider, category);
                this.assetMap.set(assetId, asset);
            }
            
            // Calculate the mid price (average of bid and ask)
            const price = (data.bp + data.ap) / 2;
            
            // Update the asset with new data
            const updatedAsset: Asset = {
                ...asset,
                price,
                // We don't get change24h from the WebSocket, keep existing or set to 0
                change24h: asset.change24h || 0,
                // Use bid/ask volume as proxy for trading volume
                volume24h: (data.bs + data.as) || asset.volume24h || 0,
                exchange: data.e,
                timestamp: new Date(data.t / 1000000).toISOString(),
                metadata: {
                    ...asset.metadata,
                    bidPrice: data.bp,
                    askPrice: data.ap,
                    bidSize: data.bs,
                    askSize: data.as
                }
            };
            
            // Store in memory and emit update
            this.assetMap.set(assetId, updatedAsset);
            this.emit('asset', updatedAsset);
            
        } catch (error) {
            logger.error('Error handling FMP Crypto WebSocket message:', error);
        }
    }
    
    /**
     * Handle Forex WebSocket message
     */
    private handleForexWsMessage(message: string): void {
        try {
            const data = JSON.parse(message) as FMPForexMessage;
            
            // Only process message if it has the required fields
            if (!data.s || data.type !== 'Q') {
                return;
            }
            
            // Extract the symbol and convert to our format
            const symbol = data.s.toUpperCase();
            
            // Determine asset category and provider name
            const category = AssetCategory.FOREX;
            const provider = this.name;
            
            // Generate the asset ID
            const assetId = generateAssetId(symbol, provider, category);
            
            // Get the existing asset or create a basic one
            let asset = this.assetMap.get(assetId);
            
            if (!asset) {
                // Create a new asset
                asset = createBasicAsset(symbol, provider, category);
                this.assetMap.set(assetId, asset);
            }
            
            // Calculate the mid price (average of bid and ask)
            const price = (data.bp + data.ap) / 2;
            
            // Update the asset with new data
            const updatedAsset: Asset = {
                ...asset,
                price,
                // We don't get change24h from the WebSocket, keep existing or set to 0
                change24h: asset.change24h || 0,
                // Use bid/ask volume as proxy for trading volume
                volume24h: (data.bs + data.as) || asset.volume24h || 0,
                timestamp: new Date(data.t).toISOString(),
                metadata: {
                    ...asset.metadata,
                    bidPrice: data.bp,
                    askPrice: data.ap,
                    bidSize: data.bs,
                    askSize: data.as
                }
            };
            
            // Store in memory and emit update
            this.assetMap.set(assetId, updatedAsset);
            this.emit('asset', updatedAsset);
            
        } catch (error) {
            logger.error('Error handling FMP Forex WebSocket message:', error);
        }
    }

    /**
     * Called when WebSocket connection is opened
     * Required by BaseProvider but actual implementation is in connectCryptoWebSocket and connectForexWebSocket
     */
    protected onWsOpen(): void {
        // Implementation handled in specialized connect methods
    }

    /**
     * Get HTTP headers for API requests
     */
    protected getApiHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        
        return headers;
    }

    /**
     * Get WebSocket headers
     */
    protected getWsHeaders(): Record<string, string> {
        // FMP WebSocket doesn't use headers for authentication
        return {};
    }

    /**
     * Disconnect from both WebSockets
     */
    public async disconnect(): Promise<void> {
        if (this.cryptoWsClient) {
            this.cryptoWsClient.close();
            this.cryptoWsClient = null;
            this.cryptoConnected = false;
        }
        
        if (this.forexWsClient) {
            this.forexWsClient.close();
            this.forexWsClient = null;
            this.forexConnected = false;
        }
        
        logger.info('FMP WebSocket disconnected');
    }

    /**
     * Fetch asset data via API
     */
    public async fetchAsset(symbol: string): Promise<Asset | null> {
        try {
            // Determine if this is a crypto or forex symbol
            const category = this.determineCategory(symbol);
            
            // Fetch quote data for the symbol
            const response = await this.apiClient.get(`/api/v3/quote/${symbol}`, {
                params: {
                    apikey: this.apiKey
                }
            });
            
            if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
                throw new Error('Invalid API response');
            }
            
            // Transform to our unified asset format
            const asset = this.transformAsset(response.data[0], category);
            return asset;
        } catch (error) {
            logger.error(`Error fetching asset ${symbol}:`, error);
            return null;
        }
    }

    /**
     * Fetch multiple assets via API
     */
    public async fetchAssets(symbols?: string[]): Promise<Asset[]> {
        try {
            if (!symbols || symbols.length === 0) {
                // Fetch both crypto and forex default symbols
                const cryptoAssets = await this.fetchAssetsByCategory(AssetCategory.CRYPTOCURRENCY, this.cryptoSymbols);
                const forexAssets = await this.fetchAssetsByCategory(AssetCategory.FOREX, this.forexSymbols);
                return [...cryptoAssets, ...forexAssets];
            }
            
            // Group symbols by category
            const cryptoSymbols: string[] = [];
            const forexSymbols: string[] = [];
            
            symbols.forEach(symbol => {
                const category = this.determineCategory(symbol);
                if (category === AssetCategory.CRYPTOCURRENCY) {
                    cryptoSymbols.push(symbol);
                } else if (category === AssetCategory.FOREX) {
                    forexSymbols.push(symbol);
                }
            });
            
            // Fetch assets for each category
            const cryptoAssets = await this.fetchAssetsByCategory(AssetCategory.CRYPTOCURRENCY, cryptoSymbols);
            const forexAssets = await this.fetchAssetsByCategory(AssetCategory.FOREX, forexSymbols);
            
            return [...cryptoAssets, ...forexAssets];
        } catch (error) {
            logger.error('Error fetching assets:', error);
            return [];
        }
    }
    
    /**
     * Fetch assets by category
     */
    private async fetchAssetsByCategory(category: AssetCategory, symbols: string[]): Promise<Asset[]> {
        if (symbols.length === 0) {
            return [];
        }
        
        try {
            // Fetch quotes for the symbols
            const symbolsStr = symbols.join(',');
            const response = await this.apiClient.get(`/api/v3/quote/${symbolsStr}`, {
                params: {
                    apikey: this.apiKey
                }
            });
            
            if (!response.data || !Array.isArray(response.data)) {
                throw new Error('Invalid API response');
            }
            
            // Transform to our unified asset format
            return response.data.map((quote: any) => this.transformAsset(quote, category));
        } catch (error) {
            logger.error(`Error fetching ${category} assets:`, error);
            return [];
        }
    }
    
    /**
     * Transform API response to unified asset format
     */
    private transformAsset(quote: any, category: AssetCategory): Asset {
        const symbol = quote.symbol.toUpperCase();
        const assetId = generateAssetId(symbol, this.name, category);
        
        // Calculate price and change values
        const price = quote.price || 0;
        const change = quote.change || 0;
        const changePct = quote.changesPercentage || 0;
        
        const asset: Asset = {
            assetId,
            symbol,
            name: quote.name || symbol,
            category,
            provider: this.name,
            price,
            change24h: changePct,
            volume24h: quote.volume || 0,
            timestamp: new Date().toISOString(),
            exchange: quote.exchange,
            metadata: {
                dayHigh: quote.dayHigh,
                dayLow: quote.dayLow,
                yearHigh: quote.yearHigh,
                yearLow: quote.yearLow,
                marketCap: quote.marketCap,
                priceAvg50: quote.priceAvg50,
                priceAvg200: quote.priceAvg200,
                open: quote.open,
                previousClose: quote.previousClose
            }
        };
        
        // Update the in-memory map
        this.assetMap.set(assetId, asset);
        
        return asset;
    }
    
    /**
     * Determine the category of a symbol
     */
    private determineCategory(symbol: string): AssetCategory {
        // Simple heuristic - could be improved
        if (symbol.includes('USD') && symbol.length <= 6) {
            if (symbol.startsWith('USD') || symbol.endsWith('USD')) {
                // Common pattern for forex pairs
                return AssetCategory.FOREX;
            }
        }
        
        // Default to crypto for now
        return AssetCategory.CRYPTOCURRENCY;
    }
    
    /**
     * Utility method to check if WebSockets are connected
     */
    public isConnected(): boolean {
        if (this.connectionMethod === 'websocket') {
            return this.cryptoConnected && this.forexConnected;
        }
        return true; // API method is always "connected"
    }
}