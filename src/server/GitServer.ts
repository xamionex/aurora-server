import express, { Application, Request, Response } from 'express';
import { ServerConfig } from '../types';
import { GitRepositoryManager } from '../services/GitRepositoryManager';
import { GitCommandExecutor } from '../services/GitCommandExecutor';
import { GitRequestHandler } from '../services/GitRequestHandler';

export class GitServer {
  private app: Application;
  private config: ServerConfig;
  private repoManager: GitRepositoryManager;
  private gitExecutor: GitCommandExecutor;
  private gitHandler: GitRequestHandler;

  constructor(config: ServerConfig) {
    this.config = config;
    this.app = express();
    this.repoManager = new GitRepositoryManager(config.cachedPackagesPath);
    this.gitExecutor = new GitCommandExecutor();
    this.gitHandler = new GitRequestHandler(this.repoManager, this.gitExecutor);

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.raw({
      type: 'application/x-git-upload-pack-request',
      limit: this.config.maxUploadSize
    }));
    this.app.use(express.raw({
      type: 'application/x-git-receive-pack-request',
      limit: this.config.maxUploadSize
    }));
  }

  private setupRoutes(): void {
    this.app.get('/', (_req: Request, res: Response) => {
      res.send('Welcome to AURora, please follow the instructions on the README to configure your package manager.');
    });

    this.app.get('/stats', async (_req: Request, res: Response) => {
      try {
        const stats = await this.repoManager.getPackageStats();
        res.json(stats);
      } catch (error) {
        console.error('Error getting package stats:', error);
        res.status(500).json({ error: 'Failed to get package stats' });
      }
    });

    this.app.get('/stats/top-fetched', async (req: Request, res: Response) => {
      try {
        const limit = parseInt(req.query.limit as string) || 10;
        const topFetched = await this.repoManager.getTopFetchedPackages(limit);
        res.json(topFetched);
      } catch (error) {
        console.error('Error getting top fetched packages:', error);
        res.status(500).json({ error: 'Failed to get top fetched packages' });
      }
    });

    this.app.get('/stats/top-requested', async (req: Request, res: Response) => {
      try {
        const limit = parseInt(req.query.limit as string) || 10;
        const topRequested = await this.repoManager.getTopRequestedPackages(limit);
        res.json(topRequested);
      } catch (error) {
        console.error('Error getting top requested packages:', error);
        res.status(500).json({ error: 'Failed to get top requested packages' });
      }
    });

    this.app.use(async (req: Request, res: Response, next) => {
      if (req.path === '/') {
        return next();
      }

      const fullPath = req.path.substring(1);

      if (req.path.startsWith('/rpc')) {
        try {
          const response = await this.repoManager.handleRPCRequest(req.path, req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
          
          res.set('Content-Type', 'application/json');
          res.set('X-Source', 'Local Cache');
          res.send(response);
        } catch (error) {
          console.error('Error handling RPC request:', error);
          res.status(500).send('Failed to handle RPC request');
        }
        return;
      }

      if (this.repoManager.isGitRequest(fullPath)) {
        try {
          await this.gitHandler.handleGitRequest(req as any, res as any, fullPath);
        } catch (error) {
          console.error('Error in git request handler:', error);
          res.status(500).send('Internal server error');
        }
      } else {
        res.send(`Non-git request: ${fullPath}`);
      }
    });
  }

  public start(): void {
    this.app.listen(this.config.port, () => {
      console.log(`Git server listening on port ${this.config.port}`);
      console.log(`Cached packages directory: ${this.config.cachedPackagesPath}`);
    });
  }

  public getApp(): Application {
    return this.app;
  }
}
