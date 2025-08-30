import { Request, Response } from 'express';

export interface GitRequest extends Request {
  body: Buffer;
}

export interface GitResponse extends Response {}

export interface RepositoryInfo {
  name: string;
  path: string;
  isBare: boolean;
  gitDir: string;
}

export interface GitOperation {
  type: 'upload-pack' | 'receive-pack';
  isStateless: boolean;
  isAdvertisement: boolean;
}

export interface GitProcessResult {
  success: boolean;
  error?: string;
  data?: Buffer;
}

export interface ServerConfig {
  port: number;
  cachedPackagesPath: string;
  maxUploadSize: string;
}

export interface GitCommandOptions {
  statelessRpc?: boolean;
  advertiseRefs?: boolean;
  gitDir: string;
}

export interface PackageStats {
  totalPackages: number;
  totalFetches: number;
  totalRequests: number;
  cacheHitRate: number;
  averageTTL: number;
  packagesNeedingRefresh: number;
  lastUpdated: string;
}

export interface TopPackage {
  packageName: string;
  count: number;
  lastAccessed: string;
  lastFetched: string;
}

export interface PackageRecord {
  packageName: string;
  fetchCount: number;
  requestCount: number;
  lastFetched: string;
  lastAccessed: string;
  ttl: number;
}
 