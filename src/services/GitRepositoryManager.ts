import * as fs from 'fs';
import * as path from 'path';
import { RepositoryInfo } from '../types';
import { AURService } from './AURService';

export class GitRepositoryManager {
  private cachedPackagesPath: string;
  private aurService: AURService;

  constructor(cachedPackagesPath: string) {
    this.cachedPackagesPath = cachedPackagesPath;
    this.aurService = new AURService(cachedPackagesPath);
    this.ensureCacheDirectoryExists();
  }

  private ensureCacheDirectoryExists(): void {
    if (!fs.existsSync(this.cachedPackagesPath)) {
      fs.mkdirSync(this.cachedPackagesPath, { recursive: true });
    }
  }

  public isGitRequest(param: string): boolean {
    return param.endsWith(".git") ||
           param.includes(".git/") ||
           param.includes("/info/refs") ||
           param.includes("/HEAD") ||
           param.includes("/objects/") ||
           param.includes("/refs/") ||
           param.includes("/git-upload-pack") ||
           param.includes("/git-receive-pack") ||
           param.includes("git-upload-pack") ||
           param.includes("git-receive-pack") ||
           param.includes("info/refs") ||
           param.includes("HEAD") ||
           param.includes("objects/") ||
           param.includes("refs/");
  }

  public async extractRepositoryInfo(param: string): Promise<RepositoryInfo | null> {
    let repoName: string;
    
    if (param.endsWith(".git")) {
      repoName = path.basename(param, '.git');
    } else if (param.includes(".git/")) {
      repoName = path.basename(param.split('.git')[0]);
    } else {
      repoName = param.split('/')[0];
    }

    const repoPath = path.join(this.cachedPackagesPath, repoName);

    if (!fs.existsSync(repoPath)) {
      const repoInfo = await this.aurService.fetchPackageFromAUR(repoName);
      
      if (repoInfo) {
        return repoInfo;
      } else {
        return null;
      }
    }

    const isBareRepo = fs.existsSync(path.join(repoPath, 'HEAD')) && 
                      !fs.existsSync(path.join(repoPath, '.git'));

    const gitDir = isBareRepo ? repoPath : path.join(repoPath, '.git');

    await this.aurService.ensurePackageRecorded(repoName);

    if (await this.aurService.shouldRefreshPackage(repoName)) {
      await this.aurService.refreshPackage(repoName);
    }

    if (param.includes('git-upload-pack') || param.includes('git-receive-pack') || param.includes('/objects/')) {
      await this.aurService.updateLastAccessed(repoName);
    }

    return {
      name: repoName,
      path: repoPath,
      isBare: isBareRepo,
      gitDir: gitDir
    };
  }

  public getGitFilePath(repoInfo: RepositoryInfo, param: string): string | null {
    if (param.includes('/info/refs')) {
      return path.join(repoInfo.gitDir, 'info', 'refs');
    } else if (param.includes('/HEAD')) {
      return path.join(repoInfo.gitDir, 'HEAD');
    } else if (param.includes('/objects/') || param.includes('/refs/')) {
      const gitFilePath = param.substring(param.indexOf('/') + 1);
      return path.join(repoInfo.gitDir, gitFilePath);
    } else if (param.includes('.git/')) {
      const gitFilePath = param.split('.git/')[1];
      return path.join(repoInfo.gitDir, gitFilePath);
    }
    
    return null;
  }

  public fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  public isFile(filePath: string): boolean {
    try {
      const stats = fs.statSync(filePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  public createReadStream(filePath: string): fs.ReadStream {
    return fs.createReadStream(filePath);
  }

  /**
   * Get comprehensive package statistics
   */
  public async getPackageStats(): Promise<any> {
    return await this.aurService.getPackageStats();
  }

  /**
   * Get top packages by fetch count
   */
  public async getTopFetchedPackages(limit: number = 10): Promise<any> {
    return await this.aurService.getTopFetchedPackages(limit);
  }

  /**
   * Get top packages by request count
   */
  public async getTopRequestedPackages(limit: number = 10): Promise<any> {
    return await this.aurService.getTopRequestedPackages(limit);
  }

  /**
   * Handle RPC requests by generating our own responses
   */
  public async handleRPCRequest(path: string, query: string): Promise<string> {
    const { RPCHandler } = await import('./RPCHandler');
    const rpcHandler = new RPCHandler(this.cachedPackagesPath);
    return await rpcHandler.handleRPCRequest(path, query);
  }

  /**
   * Record a Git request for a package
   */
  public async recordGitRequest(packageName: string): Promise<void> {
    await this.aurService.recordGitRequest(packageName);
  }
}
