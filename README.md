# Real-Time Market Data Backend

A modern, scalable TypeScript/Express.js backend for distributing real-time market data across multiple asset categories with support for ultra-low latency "Turbo Mode" for time-sensitive assets.

## Features

- **Real-time Market Data**: Get live updates for cryptocurrencies, stocks, forex, indices, and commodities
- **Multiple Data Sources**: Flexible provider system that can integrate with any API or WebSocket source
- **Ultra-low Latency Mode**: Special "Turbo Mode" for direct provider-to-client streaming
- **Multiple Interfaces**:
    - RESTful API for data discovery and queries
    - WebSocket for real-time updates
- **Built for Scale**:
    - Redis-based caching and pub/sub
    - Stateless design for horizontal scaling
    - Comprehensive logging system
- **Security**:
    - API key authentication
    - Origin checking
    - Rate limiting
- **Developer-friendly**:
    - TypeScript for improved type safety
    - Modular architecture
    - Docker-ready

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Node.js (v18+)
- **Framework**: Express.js
- **Real-time Communication**: Socket.IO
- **Data Storage**: Redis
- **Container**: Docker & Docker Compose
- **Error Handling**: Circuit Breaker pattern (Opossum)
- **Logging**: Pino
- **Validation**: Joi

## Architecture

The system follows a modular architecture with these key components:

```
                                   ┌─────────────┐
                                   │   External  │
                                   │  Provider   │
                                   │   APIs      │
                                   └──────┬──────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌──────────────┐        ┌─────────────┐       ┌────────────┐  │
│  │              │        │             │       │            │  │
│  │   Provider   │───────▶│    Redis    │◀──────│    API     │  │
│  │   System     │        │   Service   │       │  Endpoints │  │
│  │              │        │             │       │            │  │
│  └──────┬───────┘        └──────┬──────┘       └────────────┘  │
│         │                       │                              │
│         │                       │                              │
│         ▼                       ▼                              │
│  ┌──────────────┐        ┌─────────────┐                       │
│  │   Turbo      │        │  Standard   │                       │
│  │  WebSocket   │        │  WebSocket  │                       │
│  │  (Direct)    │        │ (via Redis) │                       │
│  └──────┬───────┘        └──────┬──────┘                       │
│         │                       │                              │
└─────────┼───────────────────────┼──────────────────────────────┘
          │                       │
          ▼                       ▼
    ┌─────────────┐         ┌─────────────┐
    │  Real-time  │         │   Standard  │
    │   Clients   │         │   Clients   │
    └─────────────┘         └─────────────┘
```

### Data Flow

1. **Data Collection**: Provider connectors fetch data from external sources
2. **Normalization**: Data is transformed into a standard format
3. **Storage**: Normalized data is stored in Redis
4. **Distribution**:
    - Standard mode: Updates flow through Redis pub/sub
    - Turbo mode: Updates flow directly to subscribed clients
5. **Discovery**: REST API allows clients to discover available assets

## Getting Started

### Prerequisites

- Node.js 18 or later
- Redis 6 or later
- Docker and Docker Compose (optional)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/market-data-service.git
   cd market-data-service
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a configuration file:
   ```bash
   cp .env.example .env
   ```

4. Update the `.env` file with your API keys and configuration

### Running the Application

#### Development mode:
```bash
# Start Redis if not running externally
docker-compose up -d redis

# Start the application in development mode (with hot reload)
npm run dev
```

#### Production mode:
```bash
# Build the TypeScript code
npm run build

# Start the application
npm start
```

#### Using Docker:
```bash
# Build and start all services
docker-compose up --build

# Run in background
docker-compose up -d
```

## Configuration

Configuration is managed through environment variables in the `.env` file.

### Server Configuration
```
PORT=3000
NODE_ENV=development
```

### Logging Configuration
```
LOG_LEVEL=info                   # debug, info, warn, error
LOG_FORMAT=pretty                # json or pretty
LOG_FILE_ENABLED=true
LOG_FILE_PATH=./logs
LOG_MAX_SIZE=10m
LOG_MAX_FILES=7
LOG_CONSOLE_ENABLED=true
```

### Redis Configuration
```
REDIS_URL=redis://localhost:6379
REDIS_KEY_PREFIX=market:
REDIS_CACHE_EXPIRY=3600
```

### Authentication
```
API_AUTH_ENABLED=true
API_KEYS=key1,key2,key3
URL_CHECK_ENABLED=false
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
```

### Provider Configuration
```
CRYPTO_PROVIDER=financialmodelingprep
STOCKS_PROVIDER=financialmodelingprep
FOREX_PROVIDER=financialmodelingprep
INDICES_PROVIDER=financialmodelingprep
COMMODITIES_PROVIDER=financialmodelingprep

FINANCIALMODELINGPREP_CONNECTION_MODE=api
COINCAP_CONNECTION_MODE=ws
ALPHAVANTAGE_CONNECTION_MODE=api

FINANCIALMODELINGPREP_API_KEY=your-api-key

CRYPTO_UPDATE_INTERVAL=5000
STOCKS_UPDATE_INTERVAL=60000
FOREX_UPDATE_INTERVAL=5000
INDICES_UPDATE_INTERVAL=60000
COMMODITIES_UPDATE_INTERVAL=60000
```

## API Reference

### Authentication

For API endpoints, provide your API key using one of these methods:
- Header: `x-api-key: your-api-key`
- Query parameter: `?apiKey=your-api-key`

### Assets Endpoints

#### Get all assets

```
GET /api/assets
```

Response:
```json
{
  "success": true,
  "count": 150,
  "data": [
    {
      "id": "crypto-btc",
      "symbol": "BTC",
      "name": "Bitcoin",
      "category": "crypto",
      "price": 37500.75,
      "priceLow24h": 36800.00,
      "priceHigh24h": 38100.50,
      "change24h": 725.25,
      "changePercent24h": 1.97,
      "volume24h": 28912345,
      "lastUpdated": "2023-11-14T12:34:56Z"
    },
    // More assets...
  ]
}
```

#### Get assets by category

```
GET /api/assets/:category
```

Categories: `crypto`, `stocks`, `forex`, `indices`, `commodities`

#### Get assets by symbols

```
GET /api/asset/symbols?symbols=BTC,ETH,AAPL
```

#### Get asset by ID

```
GET /api/asset/:id
```

#### Get available categories

```
GET /api/categories
```

### Statistics Endpoints

#### Get overall statistics

```
GET /api/stats
```

#### Get category statistics

```
GET /api/stats/:category
```

### System Endpoints

#### Health check

```
GET /health
```

## WebSocket API

### Connection

Connect to the WebSocket server with authentication:

```javascript
import { io } from "socket.io-client";

const socket = io("http://your-server:3000", {
  auth: {
    apiKey: "your-api-key"
  }
});
```

### Events (Client to Server)

#### Subscribe to all assets

```javascript
socket.emit('subscribe:all');
```

#### Subscribe to a category

```javascript
socket.emit('subscribe:category', 'crypto');
```

#### Subscribe to specific symbols

```javascript
// Standard mode
socket.emit('subscribe:symbols', {
  symbols: ['BTC', 'ETH', 'AAPL']
});

// Turbo mode for ultra-low latency
socket.emit('subscribe:symbols', {
  symbols: ['BTC', 'ETH', 'AAPL'],
  mode: 'turbo'
});
```

#### Request statistics

```javascript
socket.emit('get:stats');
socket.emit('get:stats:category', 'crypto');
```

### Events (Server to Client)

```javascript
// Initial data responses
socket.on('data:all', (assets) => {
  console.log('All assets:', assets.length);
});

socket.on('data:category:crypto', (assets) => {
  console.log('Crypto assets:', assets.length);
});

socket.on('data:symbols', ({ symbols, assets }) => {
  console.log(`Received data for symbols: ${symbols.join(', ')}`);
});

// Updates
socket.on('data:update', (assets) => {
  console.log('Assets updated in standard mode:', assets.length);
});

socket.on('turbo:update', (asset) => {
  console.log(`Turbo update for ${asset.symbol}: ${asset.price}`);
});

// Statistics
socket.on('stats', (stats) => {
  console.log('Overall stats:', stats);
});

// Errors
socket.on('error', (error) => {
  console.error('WebSocket error:', error);
});
```

## Example Client

An example HTML client is included to test the WebSocket functionality:

```
examples/client.html
```

Open this file in your browser to connect to the server and test the real-time data streaming.

## Adding a New Provider

To add a new provider:

1. Create a new provider class that extends `BaseProvider` in a category folder
2. Implement the required methods: `initialize()`, `fetchAssets()`, and `transform()`
3. Add the provider to the factory in `src/providers/index.ts`
4. Update the `.env` file to use your new provider

## Standard Asset Data Model

```typescript
{
  id: "crypto-btc",           // Unique ID across system
  symbol: "BTC",              // Asset symbol
  name: "Bitcoin",            // Asset name
  category: "crypto",         // Asset category
  price: 37500.75,            // Current price
  priceLow24h: 36800.00,      // 24-hour low
  priceHigh24h: 38100.50,     // 24-hour high
  change24h: 725.25,          // 24-hour change
  changePercent24h: 1.97,     // 24-hour percent change
  volume24h: 28912345,        // 24-hour volume
  lastUpdated: "2023-11-14T12:34:56Z"  // Timestamp
}
```

## Project Structure

```
market-data-service/
├── docker-compose.yml         # Docker Compose configuration
├── Dockerfile                 # Docker build configuration
├── package.json               # NPM dependencies and scripts
├── tsconfig.json              # TypeScript configuration
├── .env.example               # Example environment variables
├── src/                       # Source code
│   ├── index.ts               # Main application entry point
│   ├── config.ts              # Configuration loading
│   ├── api.ts                 # REST API endpoints
│   ├── websocket.ts           # WebSocket server with Turbo Mode
│   ├── redis.ts               # Redis service
│   ├── logging.ts             # Logging service
│   ├── models.ts              # Data models and validation
│   ├── api/                   # API-related code
│   │   └── middleware/        # API middleware
│   │       └── auth.ts        # Authentication middleware
│   └── providers/             # Data provider implementations
│       ├── index.ts           # Provider factory and manager
│       ├── provider.ts        # Base provider interface
│       ├── crypto/            # Crypto providers
│       ├── stocks/            # Stock providers
│       ├── forex/             # Forex providers
│       ├── indices/           # Indices providers
│       └── commodities/       # Commodities providers
├── tests/                     # Test files
├── examples/                  # Example clients
│   └── client.html            # Example HTML WebSocket client
└── dist/                      # Compiled JavaScript (after build)
```

## Logging System

The logging system provides detailed insights into all operations, with special focus on error tracking and debugging. Each log entry includes contextual information like timestamps, component names, and request IDs for easy tracing and debugging.

## Scaling Considerations

This architecture supports horizontal scaling:

1. **Multiple Application Instances**:
    - Can run multiple instances behind a load balancer
    - Each instance connects to the same Redis

2. **Redis Scaling**:
    - Can use Redis Cluster for larger deployments
    - Implement Redis Sentinel for high availability

3. **WebSocket Scaling**:
    - Use sticky sessions for WebSocket connections
    - Implement Socket.IO Redis adapter for cross-instance communication

## License

This project is licensed under the MIT License - see the LICENSE file for details.
