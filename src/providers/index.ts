import { BaseProvider } from './base-provider';
import { CoinCapProvider } from './coincap-provider';
import { config } from '../config';
import { logger } from '../utils/logger';
import { storeAsset, publishAssetUpdate } from '../services/redis-service';

// Active provider instance
let activeProvider: BaseProvider | null = null;

/**
 * Initialize the active provider based on configuration
 */
export async function initProvider(): Promise<BaseProvider> {
    if (activeProvider) {
        return activeProvider;
    }

    const providerName = config.providers.activeProvider;

    try {
        // Create provider instance based on configuration
        switch (providerName.toLowerCase()) {
            case 'coincap':
                activeProvider = new CoinCapProvider(
                    config.providers.coincap.apiBaseUrl,
                    config.providers.coincap.wsUrl,
                    config.providers.coincap.apiKey
                );
                break;

            // Add more provider implementations here

            default:
                throw new Error(`Unsupported provider: ${providerName}`);
        }

        // Set up asset update handler
        activeProvider.on('asset', async (asset) => {
            try {
                // Store in Redis
                await storeAsset(asset);

                // Publish update
                await publishAssetUpdate(asset);

                logger.debug(`Asset update processed: ${asset.assetId}`);
            } catch (error) {
                logger.error(`Error processing asset update:`, error);
            }
        });

        // Connect to the provider
        await activeProvider.connect();

        logger.info(`Provider initialized: ${activeProvider.getName()}`);

        return activeProvider;
    } catch (error) {
        logger.error(`Failed to initialize provider ${providerName}:`, error);
        throw error;
    }
}

/**
 * Get the active provider instance
 */
export function getProvider(): BaseProvider {
    if (!activeProvider) {
        throw new Error('Provider not initialized');
    }
    return activeProvider;
}

/**
 * Disconnect the active provider
 */
export async function disconnectProvider(): Promise<void> {
    if (activeProvider) {
        await activeProvider.disconnect();
        activeProvider = null;
        logger.info('Provider disconnected');
    }
}
