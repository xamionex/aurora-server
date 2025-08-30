import { spawn, ChildProcess } from 'child_process';
import { GitOperation, GitCommandOptions, GitProcessResult } from '../types';

export class GitCommandExecutor {
  public executeGitCommand(
    operation: GitOperation, 
    options: GitCommandOptions, 
    inputData?: Buffer
  ): Promise<GitProcessResult> {
    return new Promise((resolve) => {
      const args: string[] = [];
      
      if (options.statelessRpc) {
        args.push('--stateless-rpc');
      }
      
      if (options.advertiseRefs) {
        args.push('--advertise-refs');
      }
      
      args.push(options.gitDir);

      const command = operation.type === 'upload-pack' ? 'git-upload-pack' : 'git-receive-pack';
      const gitProcess = spawn(command, args);

      let stdoutData = Buffer.alloc(0);
      let stderrData = Buffer.alloc(0);

      gitProcess.stdout?.on('data', (data: Buffer) => {
        stdoutData = Buffer.concat([stdoutData, data]);
      });

      gitProcess.stderr?.on('data', (data: Buffer) => {
        stderrData = Buffer.concat([stderrData, data]);
        console.error(`${command} stderr: ${data.toString()}`);
      });

      gitProcess.on('close', (code: number) => {
        if (code === 0) {
          resolve({
            success: true,
            data: stdoutData
          });
        } else {
          resolve({
            success: false,
            error: `Process exited with code ${code}`,
            data: stderrData
          });
        }
      });

      gitProcess.on('error', (error: Error) => {
        resolve({
          success: false,
          error: error.message
        });
      });

      if (inputData && gitProcess.stdin) {
        gitProcess.stdin.write(inputData);
        gitProcess.stdin.end();
      } else if (gitProcess.stdin) {
        gitProcess.stdin.end();
      }
    });
  }

  public createGitProcess(
    operation: GitOperation, 
    options: GitCommandOptions
  ): ChildProcess {
    const args: string[] = [];
    
    if (options.statelessRpc) {
      args.push('--stateless-rpc');
    }
    
    if (options.advertiseRefs) {
      args.push('--advertise-refs');
    }
    
    args.push(options.gitDir);

    const command = operation.type === 'upload-pack' ? 'git-upload-pack' : 'git-receive-pack';
    return spawn(command, args);
  }

  public pipeGitProcessToResponse(
    gitProcess: ChildProcess, 
    response: any, 
    contentType: string,
    packetLineHeader?: string
  ): void {
    response.set('Content-Type', contentType);
    response.set('Cache-Control', 'no-cache, max-age=0, must-revalidate');

    if (packetLineHeader) {
      response.write(packetLineHeader);
    }

    gitProcess.stdout?.on('data', (data: Buffer) => {
      response.write(data);
    });

    gitProcess.on('close', () => {
      response.end();
    });

    gitProcess.stderr?.on('data', (data: Buffer) => {
      console.error(`Git process stderr: ${data.toString()}`);
    });
  }
}
