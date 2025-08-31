import * as fs from 'fs';
import * as path from 'path';
import { AURService } from './AURService';
import { writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

export interface AURPackage {
  Name: string;
  PackageBase: string;
  Version: string;
  Description: string;
  URL: string;
  Maintainer: string;
  NumVotes: number;
  Popularity: number;
  OutOfDate: number | null;
  FirstSubmitted: number;
  LastModified: number;
  License: string[];
  Depends: string[];
  MakeDepends: string[];
  Conflicts: string[];
  Provides: string[];
  Replaces: string[];
  Keywords: string[];
}

export class RPCHandler {
  private cachedPackagesPath: string;
  private aurService: AURService;

  constructor(cachedPackagesPath: string) {
    this.cachedPackagesPath = cachedPackagesPath;
    this.aurService = new AURService(cachedPackagesPath);
  }

  /**
   * Handle RPC requests by generating our own responses
   */
  public async handleRPCRequest(_path: string, query: string): Promise<string> {
    try {
      const searchParams = new URLSearchParams(query);
      const type = searchParams.get('type');
      const version = searchParams.get('v');

      let response: string;
      if (type === 'info') {
        response = await this.handleInfoRequest(searchParams);
      } else if (type === 'search') {
        response = await this.handleSearchRequest(searchParams);
      } else if (type === 'multiinfo') {
        response = await this.handleMultiInfoRequest(searchParams);
      } else {
        response = this.generateEmptyResponse(type || 'unknown', version || 5);
      }

      return response;
    } catch (error) {
      console.error('Error handling RPC request:', error);
      return this.generateErrorResponse();
    }
  }

  /**
   * Handle info requests
   */
  private async handleInfoRequest(searchParams: URLSearchParams): Promise<string> {
    const args = searchParams.getAll('arg[]');
    
    if (args.length === 0) {
      return this.generateEmptyResponse('info', 5);
    }

    const packages: AURPackage[] = [];
    for (const arg of args) {
      const packageInfo = await this.getPackageInfo(arg);
      if (packageInfo) {
        packages.push(packageInfo);
      }
    }

    if (packages.length > 0) {
      return this.generateInfoResponse(packages);
    }

    return this.generateEmptyResponse('info', 5);
  }

  /**
   * Handle multiinfo requests (multiple package info)
   */
  private async handleMultiInfoRequest(searchParams: URLSearchParams): Promise<string> {
    const args = searchParams.getAll('arg[]');
    if (args.length === 0) {
      return this.generateEmptyResponse('multiinfo', 5);
    }

    const packages: AURPackage[] = [];
    for (const arg of args) {
      const packageInfo = await this.getPackageInfo(arg);
      if (packageInfo) {
        packages.push(packageInfo);
      }
    }

    if (packages.length > 0) {
      return this.generateInfoResponse(packages);
    }

    return this.generateEmptyResponse('multiinfo', 5);
  }

  /**
   * Handle search requests
   */
  private async handleSearchRequest(searchParams: URLSearchParams): Promise<string> {
    const arg = searchParams.get('arg');
    if (!arg) {
      return this.generateEmptyResponse('search', 5);
    }

    const packages = await this.searchPackages(arg);
    if (packages.length > 0) {
      return this.generateInfoResponse(packages);
    }

    return this.generateEmptyResponse('search', 5);
  }

  /**
   * Get package info from our cache
   */
  private async getPackageInfo(packageName: string): Promise<AURPackage | null> {
    const packagePath = path.join(this.cachedPackagesPath, packageName);
    
    if (!fs.existsSync(packagePath)) {
      try {
        await this.aurService.fetchPackageFromAUR(packageName);
        
        if (fs.existsSync(packagePath)) {
          // Package was successfully fetched
        } else {
          return null;
        }
      } catch (error) {
        console.error(`Error fetching ${packageName} from AUR:`, error);
        return null;
      }
    }

    const pkgbuildPath = path.join(packagePath, 'PKGBUILD');
    
    if (!fs.existsSync(pkgbuildPath)) {
      return null;
    }

    try {
      const pkgbuildContent = fs.readFileSync(pkgbuildPath, 'utf8');
      console.log(`PKGBUILD content length: ${pkgbuildContent.length}`);
      const packageInfo = this.parsePKGBUILD(packageName, pkgbuildContent);
      console.log(`Parsed package info:`, packageInfo);
      return packageInfo;
    } catch (error) {
      console.error(`Error parsing PKGBUILD for ${packageName}:`, error);
      return null;
    }
  }

  /**
   * Search packages in our cache
   */
  private async searchPackages(searchTerm: string): Promise<AURPackage[]> {
    const packages: AURPackage[] = [];
    
    try {
      const items = fs.readdirSync(this.cachedPackagesPath);
      for (const item of items) {
        if (item.toLowerCase().includes(searchTerm.toLowerCase())) {
          const packageInfo = await this.getPackageInfo(item);
          if (packageInfo) {
            packages.push(packageInfo);
          }
        }
      }
      
      if (packages.length === 0) {
        try {
          await this.aurService.fetchPackageFromAUR(searchTerm);
          
          const packageInfo = await this.getPackageInfo(searchTerm);
          if (packageInfo) {
            packages.push(packageInfo);
          }
        } catch (error) {
          console.error(`Error fetching ${searchTerm} from AUR:`, error);
        }
      }
    } catch (error) {
      console.error('Error searching packages:', error);
    }

    return packages;
  }

  private parsePKGBUILD(packageName: string, content: string): AURPackage {
    try {
      const bashScript = [
        'set -euo pipefail',
        '',
        'temp_file=$(mktemp)',
        "trap 'rm -f \"$temp_file\"' EXIT",
        '',
        'cat > "$temp_file" <<\'EOF\'',
        content, // PKGBUILD content inserted safely
        'EOF',
        '',
        'source "$temp_file"',
        '',
        // Echo variables (arrays flattened with [@])
        'echo "PKGVER=${pkgver-}"',
        'echo "PKGREL=${pkgrel-}"',
        'echo "PKGDESC=${pkgdesc-}"',
        'echo "URL=${url-}"',
        'echo "MAINTAINER=${maintainer-}"',
        'echo "LICENSE=${license[@]-}"',
        'echo "DEPENDS=${depends[@]-}"',
        'echo "MAKEDEPENDS=${makedepends[@]-}"',
        'echo "CONFLICTS=${conflicts[@]-}"',
        'echo "PROVIDES=${provides[@]-}"',
        'echo "REPLACES=${replaces[@]-}"'
      ].join('\n');

      const tmpFile = join(tmpdir(), `parse-pkgbuild-${Date.now()}.sh`);
      writeFileSync(tmpFile, bashScript, { encoding: "utf8" });

      let output: string = "";

      try {
        output = execSync(`bash "${tmpFile}"`, { encoding: "utf8", timeout: 10000 });
      } catch (err) {
        console.error("Bash failed:", err);
      } finally {
        unlinkSync(tmpFile)
      }

      console.log("Output:", output);

      // Parse the output into key-value pairs
      const variables: Record<string, string> = {};
      output.split("\n").forEach((line: string) => {
        const match = line.match(/^([A-Z_]+)=(.*)$/);
        if (match) {
          variables[match[1]] = match[2];
        }
      });

      // Helper to handle array-like vars
      const parseArray = (value: string): string[] => {
        if (!value) return [];
        const cleaned = value.replace(/^\(|\)$/g, "").trim();
        if (!cleaned) return [];
        return cleaned
        .split(/\s+/)
        .map((item) => item.replace(/['"]/g, "").trim())
        .filter((item) => item.length > 0);
      };

      return {
        Name: packageName,
        PackageBase: packageName,
        Version: `${variables.PKGVER || "unknown"}-${variables.PKGREL || "1"}`,
        Description: variables.PKGDESC || "No description available",
        URL: variables.URL || "",
        Maintainer: variables.MAINTAINER || "Unknown",
        NumVotes: 0,
        Popularity: 0,
        OutOfDate: null,
        FirstSubmitted: Math.floor(Date.now() / 1000),
        LastModified: Math.floor(Date.now() / 1000),
        License: parseArray(variables.LICENSE),
        Depends: parseArray(variables.DEPENDS),
        MakeDepends: parseArray(variables.MAKEDEPENDS),
        Conflicts: parseArray(variables.CONFLICTS),
        Provides: parseArray(variables.PROVIDES),
        Replaces: parseArray(variables.REPLACES),
        Keywords: [],
      };
    } catch (error: any) {
      console.error(`Error sourcing PKGBUILD for ${packageName}:`, error.message);
      if (error.stderr) {
        console.error("Bash stderr:", error.stderr.toString());
      }
      return this.fallbackParsePKGBUILD(packageName, content);
    }
  }

  /**
   * Fallback parsing method if bash sourcing fails
   */
  private fallbackParsePKGBUILD(packageName: string, content: string): AURPackage {
    const lines = content.split('\n');
    
    const packageInfo: AURPackage = {
      Name: packageName,
      PackageBase: packageName,
      Version: this.extractValue(lines, 'pkgver') + "-" + this.extractValue(lines, 'pkgrel') || 'Unknown version',
      Description: this.extractValue(lines, 'pkgdesc') || 'No description available',
      URL: this.extractValue(lines, 'url') || '',
      Maintainer: this.extractValue(lines, 'Maintainer') || 'Unknown',
      NumVotes: 0,
      Popularity: 0,
      OutOfDate: null,
      FirstSubmitted: Math.floor(Date.now() / 1000),
      LastModified: Math.floor(Date.now() / 1000),
      License: this.extractArray(lines, 'license'),
      Depends: this.extractArray(lines, 'depends'),
      MakeDepends: this.extractArray(lines, 'makedepends'),
      Conflicts: this.extractArray(lines, 'conflicts'),
      Provides: this.extractArray(lines, 'provides'),
      Replaces: this.extractArray(lines, 'replaces'),
      Keywords: []
    };
  
    return packageInfo;
  }

  /**
   * Extract single value from PKGBUILD
   */
  private extractValue(lines: string[], key: string): string {
    for (const line of lines) {
      if (line.startsWith(`${key}=`)) {
        const value = line.substring(key.length + 1).trim();
        return value.replace(/['"]/g, '');
      }
    }
    return '';
  }

  /**
   * Extract array value from PKGBUILD
   */
  private extractArray(lines: string[], key: string): string[] {
    for (const line of lines) {
      if (line.startsWith(`${key}=`)) {
        const value = line.substring(key.length + 1).trim();
        if (value.startsWith('(') && value.endsWith(')')) {
          const arrayContent = value.substring(1, value.length - 1);
          return arrayContent.split(' ')
            .map(item => item.trim().replace(/['"]/g, ''))
            .filter(item => item.length > 0);
        }
      }
    }
    return [];
  }

  /**
   * Generate info response in AUR format
   */
  private generateInfoResponse(packages: AURPackage[]): string {
    const response = {
      resultcount: packages.length,
      results: packages,
      type: 'multiinfo',
      version: 5
    };
    return JSON.stringify(response, null, 2);
  }

  /**
   * Generate empty response
   */
  private generateEmptyResponse(type: string, version: string | number): string {
    const response = {
      resultcount: 0,
      results: [],
      type: type,
      version: typeof version === 'string' ? parseInt(version) || 5 : version
    };
    return JSON.stringify(response, null, 2);
  }

  /**
   * Generate error response
   */
  private generateErrorResponse(): string {
    const response = {
      error: 'Internal server error',
      type: 'error',
      version: 5
    };
    return JSON.stringify(response, null, 2);
  }
}
