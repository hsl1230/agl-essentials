import * as fs from 'fs';
import * as path from 'path';
import { normalizePath } from '../shared';

/**
 * PathResolver - Handles module path resolution
 * 
 * Responsible for resolving local and @opus/agl-* module paths
 * to their actual file system locations.
 */
export class PathResolver {
  private normalizedWorkspaceFolder: string;
  private middlewareRoot: string;

  constructor(workspaceFolder: string, middlewareName: string) {
    this.normalizedWorkspaceFolder = normalizePath(workspaceFolder);
    this.middlewareRoot = path.join(this.normalizedWorkspaceFolder, `agl-${middlewareName}-middleware`);
  }

  /**
   * Get the middleware root path
   */
  getMiddlewareRoot(): string {
    return this.middlewareRoot;
  }

  /**
   * Get the normalized workspace folder
   */
  getWorkspaceFolder(): string {
    return this.normalizedWorkspaceFolder;
  }

  /**
   * Resolve a local module path to absolute path
   */
  resolveLocalPath(modulePath: string, currentDir: string): string | undefined {
    const basePath = path.resolve(currentDir, modulePath);
    
    if (modulePath.endsWith('.js') || modulePath.endsWith('.ts')) {
      return fs.existsSync(basePath) ? basePath : undefined;
    }
    
    return this.findExistingPath(this.getPathCandidates(basePath));
  }

  /**
   * Resolve an @opus/agl-* module path to absolute path
   */
  resolveAglModulePath(modulePath: string): string | undefined {
    const moduleMapping: { [key: string]: string } = {
      '@opus/agl-core': 'agl-core',
      '@opus/agl-utils': 'agl-utils',
      '@opus/agl-cache': 'agl-cache',
      '@opus/agl-logger': 'agl-logger'
    };

    if (moduleMapping[modulePath]) {
      const root = this.getAglModuleRoot(moduleMapping[modulePath]);
      if (root) {
        const indexPath = path.join(root, 'index.js');
        if (fs.existsSync(indexPath)) {
          return indexPath;
        }
      }
      return undefined;
    }

    for (const [modulePrefix, moduleName] of Object.entries(moduleMapping)) {
      if (modulePath.startsWith(modulePrefix + '/')) {
        const root = this.getAglModuleRoot(moduleName);
        if (!root) continue;
        
        const subPath = modulePath.substring(modulePrefix.length + 1);
        const basePath = path.join(root, subPath);
        
        const resolved = this.findExistingPath(this.getPathCandidates(basePath));
        if (resolved) return resolved;
      }
    }

    return undefined;
  }

  /**
   * Resolve module path based on type (local or agl-module)
   */
  resolvePath(modulePath: string, currentFilePath: string): string | undefined {
    const isLocal = modulePath.startsWith('./') || modulePath.startsWith('../');
    const isAglModule = modulePath.startsWith('@opus/agl-');
    const currentDir = path.dirname(currentFilePath);

    if (isLocal) {
      return this.resolveLocalPath(modulePath, currentDir);
    } else if (isAglModule) {
      return this.resolveAglModulePath(modulePath);
    }
    return undefined;
  }

  /**
   * Get module name from file path (relative to middleware root)
   */
  getModuleName(filePath: string): string {
    const relativePath = path.relative(this.middlewareRoot, filePath);
    return relativePath.replace(/\\/g, '/').replace(/\.js$/, '');
  }

  /**
   * Get display name from file path
   */
  getDisplayName(filePath: string): string {
    const fileName = path.basename(filePath, '.js');
    if (fileName === 'index') {
      return path.basename(path.dirname(filePath));
    }
    return fileName;
  }

  // Private helper methods

  private getNodeModulesAglPath(moduleName: string): string {
    return path.join(this.middlewareRoot, 'node_modules', '@opus', moduleName);
  }

  private getAglModuleRoot(moduleName: string): string | undefined {
    const workspacePath = path.join(this.normalizedWorkspaceFolder, moduleName);
    if (fs.existsSync(workspacePath)) {
      return workspacePath;
    }
    
    const nodeModulesPath = this.getNodeModulesAglPath(moduleName);
    if (fs.existsSync(nodeModulesPath)) {
      return nodeModulesPath;
    }
    
    return undefined;
  }

  private findExistingPath(candidates: string[]): string | undefined {
    return candidates.find(c => fs.existsSync(c));
  }

  private getPathCandidates(basePath: string): string[] {
    return [
      `${basePath}.js`,
      `${basePath}.ts`,
      path.join(basePath, 'index.js'),
      path.join(basePath, 'index.ts')
    ];
  }
}
