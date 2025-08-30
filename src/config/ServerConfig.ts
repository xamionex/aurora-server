import { ServerConfig as IServerConfig } from '../types';

export class ServerConfig implements IServerConfig {
  public readonly port: number;
  public readonly cachedPackagesPath: string;
  public readonly maxUploadSize: string;

  constructor() {
    this.port = this.getPort();
    this.cachedPackagesPath = this.getCachedPackagesPath();
    this.maxUploadSize = this.getMaxUploadSize();
  }

  private getPort(): number {
    const envPort = process.env.PORT;
    if (envPort) {
      const port = parseInt(envPort, 10);
      if (!isNaN(port) && port > 0 && port < 65536) {
        return port;
      }
    }
    return 3000;
  }

  private getCachedPackagesPath(): string {
    return process.env.CACHED_PACKAGES_PATH || './cached_packages';
  }

  private getMaxUploadSize(): string {
    return process.env.MAX_UPLOAD_SIZE || '50mb';
  }

  public validate(): boolean {
    if (this.port <= 0 || this.port > 65535) {
      console.error('Invalid port number:', this.port);
      return false;
    }

    if (!this.cachedPackagesPath) {
      console.error('Cached packages path is required');
      return false;
    }

    if (!this.maxUploadSize) {
      console.error('Max upload size is required');
      return false;
    }

    return true;
  }

  public log(): void {
    console.log('Server Configuration:');
    console.log(`  Port: ${this.port}`);
    console.log(`  Cached Packages Path: ${this.cachedPackagesPath}`);
    console.log(`  Max Upload Size: ${this.maxUploadSize}`);
  }
}
