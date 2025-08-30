import { ServerConfig } from './config/ServerConfig';
import { GitServer } from './server/GitServer';

async function main(): Promise<void> {
  try {
    const config = new ServerConfig();

    if (!config.validate()) {
      console.error('Invalid configuration. Exiting...');
      process.exit(1);
    }

    config.log();

    const server = new GitServer(config);
    server.start();

    process.on('SIGINT', () => {
      console.log('\nReceived SIGINT. Shutting down gracefully...');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\nReceived SIGTERM. Shutting down gracefully...');
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
