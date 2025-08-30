# Aurora Server

A high-performance Git repository caching server designed for Arch Linux AUR packages. Aurora Server provides caching of AUR repositories with intelligent TTL management, reducing external API calls and improving package manager performance.

## Overview

Aurora Server acts as a proxy for AUR repositories, caching packages and serving them via Git protocol. It's designed to work seamlessly with package managers like `yay` and `paru`, providing faster package operations and reducing dependency on external services.

## Features

- **AUR Repository Caching**: Automatically fetches and caches AUR packages
- **Git Protocol Support**: Full Git protocol implementation for seamless integration
- **Intelligent TTL Management**: Configurable cache expiration with automatic refresh
- **Performance Monitoring**: Built-in statistics and monitoring endpoints
- **RPC Request Handling**: Supports AUR RPC requests for package information
- **SQLite Database**: Efficient storage with package metadata tracking

## Architecture

The server consists of several key components:

- **GitServer**: Main HTTP server handling Git operations and RPC requests
- **AURService**: Manages AUR package fetching and repository management
- **PackageDatabase**: SQLite-based storage for package metadata and statistics
- **GitRequestHandler**: Processes Git protocol requests and responses
- **RPCHandler**: Handles AUR RPC requests for package searches and info

## Installation

### Prerequisites

- Node.js 18+ 
- Git
- TypeScript (for development)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/AuroraMirror/aurora-server.git
cd aurora-server
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

4. Start the server:
```bash
npm start
```

## Configuration

The server can be configured using environment variables:

- `PORT`: Server port (default: 3000)
- `CACHED_PACKAGES_PATH`: Path for cached packages (default: `./cached_packages`)
- `MAX_UPLOAD_SIZE`: Maximum upload size for Git operations (default: `50mb`)

## Usage

### Starting the Server

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

### Integration with Package Managers

Configure your package manager to use the local server:

```bash
# For yay, add to /etc/yay.conf.json
{
  "aururl": "http://localhost:3000"
}
```

### API Endpoints

- `GET /stats` - Package statistics overview
- `GET /stats/top-fetched` - Most frequently fetched packages
- `GET /stats/top-requested` - Most frequently requested packages

## Development

### Project Structure

```
src/
├── config/          # Configuration management
├── server/          # HTTP server and routing
├── services/        # Core business logic
└── types/           # TypeScript type definitions
```

### Building

```bash
npm run build
```

The compiled JavaScript will be output to the `dist/` directory.

### Code Quality

The project uses TypeScript for type safety and follows modern JavaScript practices. All source code is in the `src/` directory with proper type definitions.

## License

This project is licensed under the GPL-3.0 License - see the LICENSE file for details.

## Contributing

Contributions are welcome. Please ensure your code follows the existing style and includes appropriate tests.

## Support

For issues and questions, please use the GitHub issue tracker.
