import { GitRequest, GitResponse, RepositoryInfo, GitOperation } from '../types';
import { GitRepositoryManager } from './GitRepositoryManager';
import { GitCommandExecutor } from './GitCommandExecutor';
import * as path from 'path';

export class GitRequestHandler {
  private repoManager: GitRepositoryManager;
  private gitExecutor: GitCommandExecutor;

  constructor(repoManager: GitRepositoryManager, gitExecutor: GitCommandExecutor) {
    this.repoManager = repoManager;
    this.gitExecutor = gitExecutor;
  }

  public async handleGitRequest(req: GitRequest, res: GitResponse, param: string): Promise<void> {
    try {
      const repoInfo = await this.repoManager.extractRepositoryInfo(param);
      
      if (!repoInfo) {
        res.status(404).send(`Repository not found in cache and could not be fetched from AUR`);
        return;
      }

      await this.repoManager.recordGitRequest(repoInfo.name);

      if (req.method === 'POST' && (param.includes('git-upload-pack') || param.includes('git-receive-pack'))) {
        this.handlePostRequest(req, res, repoInfo, param);
      } else {
        this.handleGetRequest(req, res, repoInfo, param);
      }
    } catch (error) {
      console.error('Error handling git request:', error);
      res.status(500).send('Internal server error');
    }
  }

  private handlePostRequest(req: GitRequest, res: GitResponse, repoInfo: RepositoryInfo, param: string): void {
    if (param.includes('git-upload-pack')) {
      this.handleUploadPackPost(req, res, repoInfo);
    } else if (param.includes('git-receive-pack')) {
      this.handleReceivePackPost(req, res, repoInfo);
    }
  }

  private handleUploadPackPost(req: GitRequest, res: GitResponse, repoInfo: RepositoryInfo): void {
    const operation: GitOperation = { type: 'upload-pack', isStateless: true, isAdvertisement: false };
    const options = { statelessRpc: true, gitDir: repoInfo.gitDir };
    
    res.set('Content-Type', 'application/x-git-upload-pack-result');
    
    this.gitExecutor.executeGitCommand(operation, options, req.body)
      .then(result => {
        if (result.success && result.data) {
          res.send(result.data);
        } else {
          res.status(500).send(result.error || 'Upload pack failed');
        }
      })
      .catch(error => {
        res.status(500).send(`Error: ${error.message}`);
      });
  }

  private handleReceivePackPost(req: GitRequest, res: GitResponse, repoInfo: RepositoryInfo): void {
    const operation: GitOperation = { type: 'receive-pack', isStateless: true, isAdvertisement: false };
    const options = { statelessRpc: true, gitDir: repoInfo.gitDir };
    
    res.set('Content-Type', 'application/x-git-receive-pack-result');
    
    this.gitExecutor.executeGitCommand(operation, options, req.body)
      .then(result => {
        if (result.success && result.data) {
          res.send(result.data);
        } else {
          res.status(500).send(result.error || 'Receive pack failed');
        }
      })
      .catch(error => {
        res.status(500).send(`Error: ${error.message}`);
      });
  }

  private handleGetRequest(req: GitRequest, res: GitResponse, repoInfo: RepositoryInfo, param: string): void {
    if (req.query.service === 'git-upload-pack') {
      this.handleUploadPackAdvertisement(req, res, repoInfo);
    } else if (req.query.service === 'git-receive-pack') {
      this.handleReceivePackAdvertisement(req, res, repoInfo);
    } else if (param.includes('/info/refs')) {
      this.handleInfoRefs(req, res, repoInfo);
    } else if (param.includes('/HEAD')) {
      this.handleHead(req, res, repoInfo);
    } else if (param.includes('/objects/') || param.includes('/refs/') || param.includes('.git/')) {
      this.handleGitFile(req, res, repoInfo, param);
    } else {
      res.redirect(`${req.originalUrl}/info/refs?service=git-upload-pack`);
    }
  }

  private handleUploadPackAdvertisement(_req: GitRequest, res: GitResponse, repoInfo: RepositoryInfo): void {
    const operation: GitOperation = { type: 'upload-pack', isStateless: false, isAdvertisement: true };
    const options = { advertiseRefs: true, gitDir: repoInfo.gitDir };
    
    const gitProcess = this.gitExecutor.createGitProcess(operation, options);
    this.gitExecutor.pipeGitProcessToResponse(
      gitProcess, 
      res, 
      'application/x-git-upload-pack-advertisement',
      '001e# service=git-upload-pack\n0000'
    );
  }

  private handleReceivePackAdvertisement(_req: GitRequest, res: GitResponse, repoInfo: RepositoryInfo): void {
    const operation: GitOperation = { type: 'receive-pack', isStateless: false, isAdvertisement: true };
    const options = { advertiseRefs: true, gitDir: repoInfo.gitDir };
    
    const gitProcess = this.gitExecutor.createGitProcess(operation, options);
    this.gitExecutor.pipeGitProcessToResponse(
      gitProcess, 
      res, 
      'application/x-git-receive-pack-advertisement',
      '001f# service=git-receive-pack\n0000'
    );
  }

  private handleInfoRefs(req: GitRequest, res: GitResponse, repoInfo: RepositoryInfo): void {
    const refsPath = path.join(repoInfo.gitDir, 'info', 'refs');
    
    if (this.repoManager.fileExists(refsPath)) {
      res.set('Content-Type', 'text/plain');
      this.repoManager.createReadStream(refsPath).pipe(res);
    } else {
      res.redirect(`${req.originalUrl}?service=git-upload-pack`);
    }
  }

  private handleHead(_req: GitRequest, res: GitResponse, repoInfo: RepositoryInfo): void {
    const headPath = path.join(repoInfo.gitDir, 'HEAD');
    
    if (this.repoManager.fileExists(headPath)) {
      res.set('Content-Type', 'text/plain');
      this.repoManager.createReadStream(headPath).pipe(res);
    } else {
      res.status(404).send('HEAD not found');
    }
  }

  private handleGitFile(_req: GitRequest, res: GitResponse, repoInfo: RepositoryInfo, param: string): void {
    const filePath = this.repoManager.getGitFilePath(repoInfo, param);
    
    if (filePath && this.repoManager.fileExists(filePath) && this.repoManager.isFile(filePath)) {
      res.set('Content-Type', 'application/octet-stream');
      this.repoManager.createReadStream(filePath).pipe(res);
    } else {
      res.status(404).send('File not found');
    }
  }
}
