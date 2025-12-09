/**
 * Shared utility functions used across the extension
 */
import * as fs from 'fs';
import * as path from 'path';
import { AGL_APPS, AGL_LIBS, CONFIG_PREFIX, MIDDLEWARE_PREFIX, MIDDLEWARE_SUFFIX } from './constants';

/**
 * Get the middleware name from a file path
 * @param filePath - The file path to extract middleware name from
 * @returns The middleware name or undefined if not found
 */
export function getMiddlewareNameFromPath(filePath: string): string | undefined {
  for (const app of AGL_APPS) {
    const configPattern = new RegExp(`[/\\\\]${CONFIG_PREFIX}${app}[/\\\\]`, 'i');
    if (configPattern.test(filePath)) {
      return app;
    }
  }
  return undefined;
}

/**
 * Get the full middleware directory name from a short name
 * @param middlewareName - Short middleware name (e.g., 'content')
 * @returns Full middleware directory name (e.g., 'agl-content-middleware')
 */
export function getFullMiddlewareName(middlewareName: string): string {
  return `${MIDDLEWARE_PREFIX}${middlewareName}${MIDDLEWARE_SUFFIX}`;
}

/**
 * Resolve a middleware file path
 * @param workspaceFolder - The workspace folder path
 * @param middlewareName - The middleware name
 * @param relativePath - The relative path within the middleware
 * @returns The full resolved path or undefined if not found
 */
export function resolveMiddlewareFilePath(
  workspaceFolder: string,
  middlewareName: string,
  relativePath: string
): string | undefined {
  const fullMiddlewareName = getFullMiddlewareName(middlewareName);
  
  // Try with .js extension first
  let fullPath = path.join(workspaceFolder, fullMiddlewareName, `${relativePath}.js`);
  if (fs.existsSync(fullPath)) {
    return fullPath;
  }
  
  // Try index.js
  fullPath = path.join(workspaceFolder, fullMiddlewareName, `${relativePath}/index.js`);
  if (fs.existsSync(fullPath)) {
    return fullPath;
  }
  
  return undefined;
}

/**
 * Derive the unit test file path from a source file path
 * @param filePath - The source file path
 * @returns The test file path or undefined if not derivable
 */
export function deriveTestFilePath(filePath: string): string | undefined {
  const dirName = path.dirname(filePath);
  const baseName = path.basename(filePath, '.js');
  
  // Check middleware apps
  for (const app of AGL_APPS) {
    const middlewareDir = getFullMiddlewareName(app);
    const patterns = [
      { find: `/${middlewareDir}/`, replace: `/${middlewareDir}/test/` },
      { find: `\\${middlewareDir}\\`, replace: `\\${middlewareDir}\\test\\` }
    ];
    
    for (const { find, replace } of patterns) {
      if (dirName.includes(find)) {
        const testDir = dirName.replace(find, replace);
        return path.join(testDir, `${baseName}.test.js`);
      }
    }
  }
  
  // Check library projects
  for (const lib of AGL_LIBS) {
    const patterns = [
      { find: `/${lib}/`, replace: `/${lib}/test/` },
      { find: `\\${lib}\\`, replace: `\\${lib}\\test\\` }
    ];
    
    for (const { find, replace } of patterns) {
      if (dirName.includes(find)) {
        const testDir = dirName.replace(find, replace);
        return path.join(testDir, `${baseName}.test.js`);
      }
    }
  }
  
  return undefined;
}

/**
 * Check if a path belongs to a low-level library (infrastructure code)
 * @param filePath - The file path to check
 * @returns True if the path is a library path
 */
export function isLibraryPath(filePath: string): boolean {
  if (!filePath) return false;
  
  const libraryPatterns = [
    /[/\\]agl-utils[/\\]/i,
    /[/\\]agl-core[/\\]/i,
    /[/\\]agl-cache[/\\]/i,
    /[/\\]agl-logger[/\\]/i,
    /utils[/\\]wrapper[/\\]/i,
    /shared[/\\].*[/\\](wrapper|request|http)/i,
  ];
  
  return libraryPatterns.some(pattern => pattern.test(filePath));
}

/**
 * Get short path from full path (last 2-3 parts)
 * @param fullPath - The full file path
 * @param parts - Number of path parts to include (default 3)
 * @returns The shortened path
 */
export function getShortPath(fullPath: string, parts: number = 3): string {
  const normalizedPath = fullPath.replace(/\\/g, '/');
  const pathParts = normalizedPath.split('/');
  return pathParts.slice(-parts).join('/');
}

/**
 * Normalize path for cross-platform compatibility
 * Converts Git Bash style /c/... to Windows style C:/...
 * @param pathString - The path to normalize
 * @returns The normalized path
 */
export function normalizePath(pathString: string): string {
  if (/^\/[a-zA-Z]\//.test(pathString)) {
    return pathString.replace(/^\/([a-zA-Z])\//, '$1:/');
  }
  return pathString;
}
