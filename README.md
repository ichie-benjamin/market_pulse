# Real-Time Market Data Backend

A modern, scalable backend for distributing real-time market data across multiple asset categories built with TypeScript, Express, Redis, and WebSockets.

## Quick Start

### Prerequisites

- Node.js 18 or later
- Redis 6 or later
- Docker and Docker Compose (optional)

### Install and Run

**1. Clone the repository:**

```bash
git clone https://github.com/yourusername/market-data-service.git
cd market-data-service
```

**2. Install dependencies:**

```bash
npm install
```

**3. Set up configuration:**

```bash
cp .env.example .env
```

Edit `.env` file with your API keys and configuration preferences.

**4. Run the application:**

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm run build
npm start
```

Using Docker:
```bash
docker-compose up -d
```

## API Reference

### Authentication

For API endpoints, provide your API key using one of these methods:
- Header: `x-api-key: your-api-key`
- Query parameter: `?apiKey=your-api-key`

### Asset Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/assets` | GET | Get all assets across all categories |
| `/api/assets/:category` | GET | Get assets by category (crypto, stocks, forex, indices, commodities) |
| `/api/asset/symbols?symbols=BTC,ETH,AAPL` | GET | Get assets by symbols |
| `/api/asset/:id` | GET | Get asset by ID |
| `/api/categories` | GET | Get available categories |
| `/api/refresh/:category` | POST | Force refresh data for a category |
| `/api/refresh` | POST | Force refresh all data |

### Stats Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats` | GET | Get overall statistics |
| `/api/stats/:category` | GET | Get statistics for a category |

### Redis Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/redis/info` | GET | Get Redis information and statistics |
| `/api/redis/clear` | POST | Clear all market data from Redis |
| `/api/redis/clear/category/:category` | POST | Clear data for a specific category |
| `/api/redis/clear/asset/:id` | POST | Clear a specific asset by ID |
| `/api/redis/clear/symbol/:symbol` | POST | Clear a specific asset by symbol |

### System Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/system/status` | GET | Get system status |
| `/api/system/config` | GET | Get system configuration |
| `/health` | GET | Health check endpoint (no auth required) |

## WebSocket API

Connect to the WebSocket server with authentication:

```javascript
import { io } from "socket.io-client";

const socket = io("http://your-server:3000", {
  auth: {
    apiKey: "your-api-key"
  }
});
```

### Client to Server Events

| Event | Parameters | Description |
|-------|------------|-------------|
| `subscribe:all` | none | Subscribe to all assets |
| `subscribe:category` | `category` (string) | Subscribe to a category |
| `subscribe:symbols` | `{ symbols: string[], mode?: 'turbo' }` | Subscribe to specific symbols |
| `get:stats` | none | Request overall statistics |
| `get:stats:category` | `category` (string) | Request statistics for a category |

### Server to Client Events

| Event | Description |
|-------|-------------|
| `data:all` | Initial data for all assets |
| `data:category:CATEGORY` | Initial data for a category |
| `data:symbols` | Initial data for requested symbols |
| `data:update` | Updates for standard mode |
| `turbo:update` | Updates for Turbo Mode (ultra-low latency) |
| `stats` | Overall statistics |
| `stats:category` | Statistics for a category |
| `error` | Error information |

## Configuration

Key configuration options in the `.env` file:

| Setting | Description | Default |
|---------|-------------|---------|
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment (development/production) | development |
| `API_AUTH_ENABLED` | Enable API key authentication | true |
| `API_KEYS` | Comma-separated list of valid API keys | - |
| `REDIS_URL` | Redis connection URL | redis://localhost:6379 |
| `REDIS_CACHE_EXPIRY` | Cache TTL in seconds | 3600 |
| `FINANCIALMODELINGPREP_API_KEY` | API key for Financial Modeling Prep | - |
| `CRYPTO_UPDATE_INTERVAL` | Update interval for crypto assets (ms) | 5000 |

See `.env.example` for a complete list of configuration options.

## Adding New Providers

To add a new data provider:

1. Create a new directory under `src/providers/` for your provider
2. Create `constants.ts` file defining supported categories and allowed assets
3. Implement the provider class extending `BaseProvider`
4. Add the provider to the factory in `src/providers/index.ts`
5. Update `.env` configuration

Example provider directory structure:
```
src/providers/yourprovider/
├── constants.ts   # Contains allowed assets and supported categories
└── index.ts       # Provider implementation
```

## Managing Redis Data

Redis data is automatically cleaned up based on the expiry time set in `REDIS_CACHE_EXPIRY`. You can also manually manage Redis data:

- Clear all data: `POST /api/redis/clear`
- Clear a category: `POST /api/redis/clear/category/crypto`
- Clear by symbol: `POST /api/redis/clear/symbol/BTC`

## Docker Commands

Start all services:
```bash
docker-compose up -d
```

View logs:
```bash
docker-compose logs -f
```

Stop all services:
```bash
docker-compose down
```

Rebuild the application:
```bash
docker-compose build
```

## License

This project is licensed under the MIT License.
