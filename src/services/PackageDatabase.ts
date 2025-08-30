import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import * as path from 'path';

export interface PackageRecord {
  name: string;
  fetched_at: Date;
  last_accessed: Date;
  last_meaningful_access: Date;
  ttl_hours: number;
  fetch_count: number;
  total_requests: number;
}

export interface PackageStats {
  totalPackages: number;
  totalRequests: number;
  totalFetches: number;
  cacheSize: string;
  lastUpdated: string;
  mostFetched: Array<{ name: string; fetch_count: number }>;
  mostRequested: Array<{ name: string; total_requests: number }>;
  recentlyFetched: Array<{ name: string; fetched_at: Date }>;
}

export class PackageDatabase {
  private db: Database | null = null;
  private dbPath: string;

  constructor(cachedPackagesPath: string) {
    this.dbPath = path.join(cachedPackagesPath, 'packages.db');
  }

  /**
   * Initialize the database and create tables
   */
  public async initialize(): Promise<void> {
    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database
    });

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS packages (
        name TEXT PRIMARY KEY,
        fetched_at DATETIME NOT NULL,
        last_accessed DATETIME NOT NULL,
        last_meaningful_access DATETIME NOT NULL,
        ttl_hours INTEGER DEFAULT 12,
        fetch_count INTEGER DEFAULT 1,
        total_requests INTEGER DEFAULT 1
      )
    `);

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS rpc_cache (
        cache_key TEXT PRIMARY KEY,
        response_data TEXT NOT NULL,
        cached_at DATETIME NOT NULL
      )
    `);

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS hourly_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hour_start DATETIME NOT NULL,
        package_name TEXT NOT NULL,
        fetch_count INTEGER DEFAULT 0,
        request_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(hour_start, package_name)
      )
    `);

    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_hourly_activity_hour 
      ON hourly_activity(hour_start)
    `);
  }

  /**
   * Record when a package was fetched
   */
  public async recordPackageFetch(packageName: string, ttlHours: number = 12): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const now = new Date();
    
    const existing = await this.getPackageRecord(packageName);
    
    if (existing) {
      await this.db.run(
        'UPDATE packages SET fetched_at = ?, fetch_count = fetch_count + 1, ttl_hours = ? WHERE name = ?',
        [now.toISOString(), ttlHours, packageName]
      );
    } else {
      await this.db.run(
        'INSERT INTO packages (name, fetched_at, last_accessed, last_meaningful_access, ttl_hours, fetch_count, total_requests) VALUES (?, ?, ?, ?, ?, 1, 1)',
        [packageName, now.toISOString(), now.toISOString(), now.toISOString(), ttlHours]
      );
    }
  }

  /**
   * Update last accessed time and increment request counter for a package
   */
  public async updateLastAccessed(packageName: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const now = new Date();
    await this.db.run(
      'UPDATE packages SET last_accessed = ?, total_requests = total_requests + 1 WHERE name = ?',
      [now.toISOString(), packageName]
    );
  }

  /**
   * Update last meaningful access time (for actual package usage, not metadata)
   */
  public async updateLastMeaningfulAccess(packageName: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const now = new Date();
    await this.db.run(
      'UPDATE packages SET last_meaningful_access = ? WHERE name = ?',
      [now.toISOString(), packageName]
    );
  }

  /**
   * Increment fetch count for an existing package (cache hits)
   */
  public async incrementFetchCount(packageName: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    await this.db.run(
      'UPDATE packages SET fetch_count = fetch_count + 1 WHERE name = ?',
      [packageName]
    );
  }

  /**
   * Fix packages with 0 fetch_count or total_requests (for existing data)
   */
  public async fixZeroCounts(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      await this.db.run(
        'UPDATE packages SET fetch_count = 1 WHERE fetch_count = 0 OR fetch_count IS NULL'
      );
      
      await this.db.run(
        'UPDATE packages SET total_requests = 1 WHERE total_requests = 0 OR total_requests IS NULL'
      );
      
    } catch (error) {
      console.error('Error fixing zero counts:', error);
    }
  }

  /**
   * Check if a package needs to be refreshed based on TTL
   */
  public async shouldRefreshPackage(packageName: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');
    
    const record = await this.db.get(
      'SELECT * FROM packages WHERE name = ?',
      [packageName]
    ) as PackageRecord | undefined;

    if (!record) {
      return true;
    }

    const now = new Date();
    const fetchedAt = new Date(record.fetched_at);
    const hoursSinceFetch = (now.getTime() - fetchedAt.getTime()) / (1000 * 60 * 60);
    
    return hoursSinceFetch >= record.ttl_hours;
  }

  /**
   * Get package record
   */
  public async getPackageRecord(packageName: string): Promise<PackageRecord | null> {
    if (!this.db) throw new Error('Database not initialized');
    
    const record = await this.db.get(
      'SELECT * FROM packages WHERE name = ?',
      [packageName]
    ) as PackageRecord | undefined;
    
    return record || null;
  }

  /**
   * Record hourly activity for a package
   */


  /**
   * Calculate the total cache size by summing up package directories
   */
  public async getCacheSize(): Promise<string> {
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      const cacheDir = path.dirname(this.dbPath);
      
      let totalSize = 0;
      
      const packages = await this.db.all('SELECT name FROM packages') as Array<{ name: string }>;
      
      for (const pkg of packages) {
        const packagePath = path.join(cacheDir, pkg.name);
        if (fs.existsSync(packagePath)) {
          totalSize += this.calculateDirectorySize(packagePath);
        }
      }
      
      return this.formatBytes(totalSize);
    } catch (error) {
      console.error('Error calculating cache size:', error);
      return 'Unknown';
    }
  }

  /**
   * Recursively calculate directory size
   */
  private calculateDirectorySize(dirPath: string): number {
    try {
      const fs = require('fs');
      const path = require('path');
      
      let totalSize = 0;
      
      if (fs.existsSync(dirPath)) {
        const items = fs.readdirSync(dirPath);
        
        for (const item of items) {
          const itemPath = path.join(dirPath, item);
          const stats = fs.statSync(itemPath);
          
          if (stats.isDirectory()) {
            totalSize += this.calculateDirectorySize(itemPath);
          } else {
            totalSize += stats.size;
          }
        }
      }
      
      return totalSize;
    } catch (error) {
      console.error(`Error calculating size for ${dirPath}:`, error);
      return 0;
    }
  }

  /**
   * Format bytes into human readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get comprehensive package statistics
   */
  public async getPackageStats(): Promise<PackageStats> {
    if (!this.db) throw new Error('Database not initialized');
    
    const totalPackages = await this.db.get('SELECT COUNT(*) as count FROM packages') as { count: number } | undefined;
    const totalRequests = await this.db.get('SELECT SUM(total_requests) as total FROM packages') as { total: number } | undefined;
    const totalFetches = await this.db.get('SELECT SUM(fetch_count) as total FROM packages') as { total: number } | undefined;
    
    const mostFetched = await this.db.all(
      'SELECT name, fetch_count FROM packages ORDER BY fetch_count DESC LIMIT 10'
    ) as Array<{ name: string; fetch_count: number }>;
    
    const mostRequested = await this.db.all(
      'SELECT name, total_requests FROM packages ORDER BY total_requests DESC LIMIT 10'
    ) as Array<{ name: string; total_requests: number }>;
    
    const recentlyFetched = await this.db.all(
      'SELECT name, fetched_at FROM packages ORDER BY fetched_at DESC LIMIT 10'
    ) as Array<{ name: string; fetched_at: string }>;

    const cacheSize = await this.getCacheSize();

    return {
      totalPackages: totalPackages?.count || 0,
      totalRequests: totalRequests?.total || 0,
      totalFetches: totalFetches?.total || 0,
      cacheSize: cacheSize,
      lastUpdated: new Date().toISOString(),
      mostFetched: mostFetched || [],
      mostRequested: mostRequested || [],
      recentlyFetched: (recentlyFetched || []).map((r) => ({ ...r, fetched_at: new Date(r.fetched_at) }))
    };
  }

  /**
   * Get top packages by fetch count
   */
  public async getTopFetchedPackages(limit: number = 10): Promise<Array<{ name: string; fetch_count: number; fetched_at: string }>> {
    if (!this.db) throw new Error('Database not initialized');
    
    const result = await this.db.all(
      'SELECT name, fetch_count, fetched_at FROM packages ORDER BY fetch_count DESC LIMIT ?',
      [limit]
    ) as Array<{ name: string; fetch_count: number; fetched_at: string }>;
    
    return result || [];
  }

  /**
   * Get top packages by request count
   */
  public async getTopRequestedPackages(limit: number = 10): Promise<Array<{ name: string; total_requests: number; fetched_at: string }>> {
    if (!this.db) throw new Error('Database not initialized');
    
    const result = await this.db.all(
      'SELECT name, total_requests, fetched_at FROM packages ORDER BY total_requests DESC LIMIT ?',
      [limit]
    ) as Array<{ name: string; total_requests: number; fetched_at: string }>;
    
    return result || [];
  }

  /**
   * Get all packages that need refresh
   */
  public async getPackagesNeedingRefresh(): Promise<string[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const now = new Date();
    const records = await this.db.all(
      'SELECT * FROM packages WHERE datetime(fetched_at, "+" || ttl_hours || " hours") <= datetime(?)',
      [now.toISOString()]
    ) as Array<PackageRecord>;
    
    return (records || []).map((record) => record.name);
  }

  /**
   * Close the database connection
   */
  public async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  /**
   * Get cached RPC response if it exists and is not expired
   */
  public async getCachedRPCResponse(path: string, query: string): Promise<string | null> {
    if (!this.db) throw new Error('Database not initialized');
    
    const cacheKey = this.generateRPCCacheKey(path, query);
    const record = await this.db.get(
      'SELECT * FROM rpc_cache WHERE cache_key = ?',
      [cacheKey]
    ) as any;

    if (!record) {
      return null;
    }

    const now = new Date();
    const cachedAt = new Date(record.cached_at);
    const hoursSinceCache = (now.getTime() - cachedAt.getTime()) / (1000 * 60 * 60);
    
    if (hoursSinceCache >= 12) {
      await this.db.run('DELETE FROM rpc_cache WHERE cache_key = ?', [cacheKey]);
      return null;
    }

    return record.response_data;
  }

  /**
   * Cache an RPC response
   */
  public async cacheRPCResponse(path: string, query: string, data: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const cacheKey = this.generateRPCCacheKey(path, query);
    const now = new Date();
    
    await this.db.run(
      'INSERT OR REPLACE INTO rpc_cache (cache_key, response_data, cached_at) VALUES (?, ?, ?)',
      [cacheKey, data, now.toISOString()]
    );
  }

  /**
   * Generate a smart cache key for RPC requests
   */
  private generateRPCCacheKey(path: string, query: string): string {
    try {
      const url = new URL(`http://localhost${path}${query}`);
      const type = url.searchParams.get('type') || 'unknown';
      
      if (type === 'search') {
        const arg = url.searchParams.get('arg');
        if (arg) {
          return `${path}?type=${type}&arg=${arg}`;
        }
      }
      
      if (type === 'info') {
        const args = url.searchParams.getAll('arg[]');
        if (args.length > 0) {
          const sortedArgs = args.sort();
          return `${path}?type=${type}&packages=${sortedArgs.join(',')}`;
        }
      }
      
      return `${path}${query}`;
    } catch {
      return `${path}${query}`;
    }
  }
}
