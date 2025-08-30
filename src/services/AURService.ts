import * as path from 'path';
import { spawn } from 'child_process';
import { RepositoryInfo } from '../types';
import { PackageDatabase } from './PackageDatabase';
import * as fs from 'fs';

export class AURService {
  private cachedPackagesPath: string;
  private packageDb: PackageDatabase;

  constructor(cachedPackagesPath: string) {
    this.cachedPackagesPath = cachedPackagesPath;
    this.packageDb = new PackageDatabase(cachedPackagesPath);
    this.initializeDatabase();
  }

  private async initializeDatabase(): Promise<void> {
    try {
      await this.packageDb.initialize();
      
      await this.packageDb.fixZeroCounts();
    } catch (error) {
      console.error('Failed to initialize package database:', error);
    }
  }

  /**
   * Fetches a package from AUR and clones it to the cache
   */
  public async fetchPackageFromAUR(packageName: string): Promise<RepositoryInfo | null> {
    try {
      const repoPath = path.join(this.cachedPackagesPath, packageName);
      const aurCloneSuccess = await this.cloneAURPackage(packageName, repoPath);

      if (!aurCloneSuccess) {

        if (fs.existsSync(repoPath)) {
          try {
            fs.rmSync(repoPath, { recursive: true, force: true });

          } catch (cleanupError) {
            console.error(`Error during final cleanup for ${packageName}:`, cleanupError);
          }
        }
        return null;
      }

      await this.convertToBareRepository(repoPath);

      await this.packageDb.recordPackageFetch(packageName, 12);

      const repoInfo: RepositoryInfo = {
        name: packageName,
        path: repoPath,
        isBare: true,
        gitDir: repoPath
      };

      return repoInfo;

    } catch (error) {
      console.error(`Error fetching package ${packageName} from AUR:`, error);
      const repoPath = path.join(this.cachedPackagesPath, packageName);
      if (fs.existsSync(repoPath)) {
        try {
          fs.rmSync(repoPath, { recursive: true, force: true });

        } catch (cleanupError) {
          console.error(`Error during error cleanup for ${packageName}:`, cleanupError);
        }
      }
      return null;
    }
  }

  /**
   * Refreshes an existing package by pulling latest changes
   */
  public async refreshPackage(packageName: string): Promise<boolean> {
    try {
      const repoPath = path.join(this.cachedPackagesPath, packageName);
      if (!repoPath) {
        return false;
      }

      const success = await this.pullLatestChanges(repoPath);
      if (success) {
        await this.packageDb.recordPackageFetch(packageName, 12);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`Error refreshing package ${packageName}:`, error);
      return false;
    }
  }

  /**
   * Check if a package needs to be refreshed based on TTL
   */
  public async shouldRefreshPackage(packageName: string): Promise<boolean> {
    return await this.packageDb.shouldRefreshPackage(packageName);
  }

  /**
   * Update last accessed time for a package
   */
  public async updateLastAccessed(packageName: string): Promise<void> {
    await this.packageDb.updateLastAccessed(packageName);
  }

  /**
   * Ensure a package is recorded in the database (for existing packages that weren't recorded yet)
   */
  public async ensurePackageRecorded(packageName: string): Promise<void> {
    try {
      const existing = await this.packageDb.getPackageRecord(packageName);
      if (!existing) {
        await this.packageDb.recordPackageFetch(packageName, 12);
      } else {
        await this.packageDb.incrementFetchCount(packageName);
      }
    } catch (error) {
      console.error(`Error ensuring package ${packageName} is recorded:`, error);
    }
  }

  /**
   * Get comprehensive package statistics
   */
  public async getPackageStats(): Promise<any> {
    const stats = await this.packageDb.getPackageStats();
    return stats;
  }

  /**
   * Get top packages by fetch count
   */
  public async getTopFetchedPackages(limit: number = 10): Promise<any> {
    return await this.packageDb.getTopFetchedPackages(limit);
  }

  /**
   * Get top packages by request count
   */
  public async getTopRequestedPackages(limit: number = 10): Promise<any> {
    return await this.packageDb.getTopRequestedPackages(limit);
  }

  /**
   * Get cached RPC response
   */
  public async getCachedRPCResponse(path: string, query: string): Promise<string | null> {
    return await this.packageDb.getCachedRPCResponse(path, query);
  }

  /**
   * Cache RPC response
   */
  public async cacheRPCResponse(path: string, query: string, data: string): Promise<void> {
    return await this.packageDb.cacheRPCResponse(path, query, data);
  }

  /**
   * Clones the AUR package directly to the cache directory
   */
  private async cloneAURPackage(packageName: string, repoPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (fs.existsSync(repoPath)) {
        try {
          fs.rmSync(repoPath, { recursive: true, force: true });
          console.log(`Removed existing partial directory for ${packageName}`);
        } catch (error) {
          console.error(`Error removing existing directory for ${packageName}:`, error);
        }
      }

      const gitProcess = spawn('git', ['clone', `https://aur.archlinux.org/${packageName}.git`, repoPath]);

      const timeout = setTimeout(() => {
        gitProcess.kill('SIGKILL');
        
        if (fs.existsSync(repoPath)) {
          try {
            fs.rmSync(repoPath, { recursive: true, force: true });
          } catch (cleanupError) {
            console.error(`Error cleaning up partial directory for ${packageName}:`, cleanupError);
          }
        }
        resolve(false);
      }, 30000); // 30 second timeout

      gitProcess.on('close', (code: number) => {
        clearTimeout(timeout);
        
        if (code === 0) {
          const gitDir = path.join(repoPath, '.git');
          const pkgbuildPath = path.join(repoPath, 'PKGBUILD');
          
          if (fs.existsSync(gitDir) && fs.existsSync(pkgbuildPath)) {
            resolve(true);
          } else {
            try {
              fs.rmSync(repoPath, { recursive: true, force: true });
            } catch (error) {
              console.error(`Error cleaning up invalid repository for ${packageName}:`, error);
            }
            resolve(false);
          }
        } else {
          if (fs.existsSync(repoPath)) {
            try {
              fs.rmSync(repoPath, { recursive: true, force: true });
            } catch (error) {
              console.error(`Error cleaning up partial directory for ${packageName}:`, error);
            }
          }
          resolve(false);
        }
      });

      gitProcess.on('error', (error) => {
        clearTimeout(timeout);
        console.error(`Git process error for ${packageName}:`, error);
        if (fs.existsSync(repoPath)) {
          try {
            fs.rmSync(repoPath, { recursive: true, force: true });

          } catch (cleanupError) {
            console.error(`Error cleaning up partial directory for ${packageName}:`, cleanupError);
          }
        }
        resolve(false);
      });
    });
  }

  /**
   * Pulls latest changes for an existing repository
   */
  private async pullLatestChanges(repoPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const gitProcess = spawn('git', ['pull'], { cwd: repoPath });

      gitProcess.on('close', (code: number) => {
        resolve(code === 0);
      });

      gitProcess.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Converts a regular repository to a bare repository
   */
  private async convertToBareRepository(repoPath: string): Promise<void> {
    return new Promise((resolve) => {
      const gitProcess = spawn('git', ['config', '--bool', 'core.bare', 'true'], { cwd: repoPath });

      gitProcess.on('close', () => {
        resolve();
      });

      gitProcess.on('error', () => {
        resolve();
      });
    });
  }

  /**
   * Record a Git request for a package
   */
  public async recordGitRequest(packageName: string): Promise<void> {
    await this.packageDb.updateLastAccessed(packageName);
  }

  /**
   * Cleanup method to close database connection
   */
  public async cleanup(): Promise<void> {
    await this.packageDb.close();
  }
}
