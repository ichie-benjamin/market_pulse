# Market Data Platform

A real-time market data distribution platform built with Express.js, Redis, and WebSockets.

## Features

- Real-time market data streaming via WebSockets
- Multiple asset categories support (cryptocurrencies, stocks, forex, etc.)
- Configurable data providers (currently supports CoinCap)
- Redis-based caching and pub/sub
- Simple REST API for asset discovery
- Docker containerization for easy deployment

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/en/) (v16 or higher)
- [Docker](https://www.docker.com/products/docker-desktop) and Docker Compose

### Installation

1. Clone the repository
2. Create a `.env` file from the example:
   ```
   cp .env.example .env
   ```
3. Modify the `.env` file as needed

### Running with Docker

#### Development Mode

```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

This starts the application in development mode with:
- Hot-reloading enabled
- Source code mounted from your local machine
- Redis Commander available at http://localhost:8081

#### Production Mode

```bash
docker-compose up --build
```

This starts the application in production mode.

### Running without Docker

1. Install depend
