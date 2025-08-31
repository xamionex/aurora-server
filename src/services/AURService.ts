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

      const tryClone = (args: string[], source: string): Promise<boolean> => {
        return new Promise((resolveClone) => {
          console.log(`Attempting to clone ${packageName} from ${source}...`);
          const gitProcess = spawn('git', args);

          const timeout = setTimeout(() => {
            console.log(`Clone from ${source} timed out for ${packageName}`);
            gitProcess.kill('SIGKILL');
            resolveClone(false);
          }, 30000);

          gitProcess.on('close', (code: number) => {
            clearTimeout(timeout);
            if (code === 0) {
              console.log(`Successfully cloned ${packageName} from ${source}`);
            } else {
              console.log(`Failed to clone ${packageName} from ${source}, exit code: ${code}`);
            }
            resolveClone(code === 0);
          });

          gitProcess.on('error', (error) => {
            clearTimeout(timeout);
            console.error(`Git process error for ${packageName} from ${source}:`, error);
            resolveClone(false);
          });
        });
      };

      const validateRepo = (): boolean => {
        const gitDir = path.join(repoPath, '.git');
        const pkgbuildPath = path.join(repoPath, 'PKGBUILD');
        const isValid = fs.existsSync(gitDir) && fs.existsSync(pkgbuildPath);
        if (!isValid) {
          console.log(`Repository validation failed for ${packageName}`);
        }
        return isValid;
      };

      // Try AUR first
      tryClone(['clone', `https://aur.archlinux.org/${packageName}.git`, repoPath], 'AUR')
      .then(async (aurSuccess) => {
        if (aurSuccess && validateRepo()) {
          resolve(true);
          return;
        }

        // Cleanup failed AUR attempt
        if (fs.existsSync(repoPath)) {
          try {
            fs.rmSync(repoPath, { recursive: true, force: true });
            console.log(`Cleaned up failed AUR clone for ${packageName}`);
          } catch (cleanupError) {
            console.error(`Error cleaning up failed AUR clone for ${packageName}:`, cleanupError);
          }
        }

        // Try GitHub mirror
        console.log(`Trying GitHub mirror for ${packageName}...`);
        const githubSuccess = await tryClone([
          'clone',
          '--branch',
          packageName,
          '--single-branch',
          'https://github.com/archlinux/aur.git',
          repoPath
        ], 'GitHub mirror');

        if (githubSuccess && validateRepo()) {
          console.log(`Successfully cloned ${packageName} from GitHub mirror`);
          resolve(true);
        } else {
          // Final cleanup
          if (fs.existsSync(repoPath)) {
            try {
              fs.rmSync(repoPath, { recursive: true, force: true });
              console.log(`Cleaned up failed GitHub clone for ${packageName}`);
            } catch (cleanupError) {
              console.error(`Error during final cleanup for ${packageName}:`, cleanupError);
            }
          }
          console.log(`All clone attempts failed for ${packageName}`);
          resolve(false);
        }
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
