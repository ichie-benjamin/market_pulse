const { createAsset, validateAsset, generateAssetStats } = require('../src/models');

describe('Asset Models', () => {
    describe('createAsset', () => {
        test('should create a valid asset with required fields', () => {
            const asset = createAsset('crypto', 'BTC', 'Bitcoin', 40000);

            expect(asset).toHaveProperty('id', 'crypto-btc');
            expect(asset).toHaveProperty('symbol', 'BTC');
            expect(asset).toHaveProperty('name', 'Bitcoin');
            expect(asset).toHaveProperty('category', 'crypto');
            expect(asset).toHaveProperty('price', 40000);
            expect(asset).toHaveProperty('lastUpdated');
        });

        test('should create asset with additional data', () => {
            const additionalData = {
                priceLow24h: 39000,
                priceHigh24h: 41000,
                change24h: 1000,
                changePercent24h: 2.5,
                volume24h: 1000000
            };

            const asset = createAsset('crypto', 'BTC', 'Bitcoin', 40000, additionalData);

            expect(asset).toHaveProperty('priceLow24h', 39000);
            expect(asset).toHaveProperty('priceHigh24h', 41000);
            expect(asset).toHaveProperty('change24h', 1000);
            expect(asset).toHaveProperty('changePercent24h', 2.5);
            expect(asset).toHaveProperty('volume24h', 1000000);
        });

        test('should convert numeric strings to numbers', () => {
            const additionalData = {
                priceLow24h: '39000',
                priceHigh24h: '41000',
                change24h: '1000',
                changePercent24h: '2.5',
                volume24h: '1000000'
            };

            const asset = createAsset('crypto', 'BTC', 'Bitcoin', '40000', additionalData);

            expect(asset.price).toBe(40000);
            expect(asset.priceLow24h).toBe(39000);
            expect(asset.priceHigh24h).toBe(41000);
            expect(asset.change24h).toBe(1000);
            expect(asset.changePercent24h).toBe(2.5);
            expect(asset.volume24h).toBe(1000000);
        });
    });

    describe('validateAsset', () => {
        test('should validate a correct asset', () => {
            const asset = {
                id: 'crypto-btc',
                symbol: 'BTC',
                name: 'Bitcoin',
                category: 'crypto',
                price: 40000,
                lastUpdated: new Date().toISOString()
            };

            const result = validateAsset(asset);
            expect(result.error).toBeUndefined();
        });

        test('should reject an asset with missing required fields', () => {
            const asset = {
                symbol: 'BTC',
                name: 'Bitcoin',
                price: 40000
            };

            const result = validateAsset(asset);
            expect(result.error).toBeDefined();
        });

        test('should reject an asset with invalid category', () => {
            const asset = {
                id: 'invalid-btc',
                symbol: 'BTC',
                name: 'Bitcoin',
                category: 'invalid',
                price: 40000,
                lastUpdated: new Date().toISOString()
            };

            const result = validateAsset(asset);
            expect(result.error).toBeDefined();
        });
    });

    describe('generateAssetStats', () => {
        test('should generate correct stats for a list of assets', () => {
            const assets = [
                createAsset('crypto', 'BTC', 'Bitcoin', 40000, {
                    change24h: 1000,
                    changePercent24h: 2.5,
                    volume24h: 1000000
                }),
                createAsset('crypto', 'ETH', 'Ethereum', 2000, {
                    change24h: -100,
                    changePercent24h: -5,
                    volume24h: 500000
                }),
                createAsset('stocks', 'AAPL', 'Apple Inc', 150, {
                    change24h: 3,
                    changePercent24h: 2,
                    volume24h: 300000
                })
            ];

            const stats = generateAssetStats(assets);

            expect(stats.count).toBe(3);
            expect(stats.categories).toHaveProperty('crypto');
            expect(stats.categories).toHaveProperty('stocks');
            expect(stats.categories.crypto.count).toBe(2);
            expect(stats.categories.crypto.gainers).toBe(1);
            expect(stats.categories.crypto.losers).toBe(1);
            expect(stats.categories.stocks.count).toBe(1);
            expect(stats.categories.stocks.gainers).toBe(1);
        });

        test('should handle empty assets array', () => {
            const stats = generateAssetStats([]);

            expect(stats.count).toBe(0);
            expect(stats.categories).toEqual({});
        });
    });
});
