import * as fs from 'fs';
import * as path from 'path';
import {
  ComponentAnalysis,
  ConfigDependency,
  DataSourceType,
  DataUsage,
  ExternalCall,
  RequireInfo,
  ResLocalsUsage
} from '../models/flow-analyzer-types';
import { normalizePath, isLibraryPath as sharedIsLibraryPath } from '../shared';

/**
 * Array mutation methods used for detecting writes
 */
const MUTATION_METHODS = [
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin',
  'set', 'add', 'delete', 'clear'
] as const;

const MUTATION_METHODS_PATTERN = new RegExp(`\\.(${MUTATION_METHODS.join('|')})$`);
const MUTATION_METHODS_CALL_PATTERN = new RegExp(`^\\s*\\.(${MUTATION_METHODS.join('|')})\\s*\\(`);

/**
 * Native JavaScript methods/properties to skip when analyzing data usage
 */
const NATIVE_METHODS_AND_PROPS = [
  'length', 'indexOf', 'find', 'findIndex', 'filter', 'map', 'reduce', 'reduceRight',
  'forEach', 'some', 'every', 'includes', 'slice', 'concat', 'join', 'flat', 'flatMap',
  'keys', 'values', 'entries', 'at', 'toString', 'toLocaleString', 'constructor',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'valueOf'
] as const;

/**
 * Cache entry for component analysis results
 */
interface CacheEntry {
  result: ComponentAnalysis;
  fileHash: string;
  timestamp: number;
}

/**
 * ComponentAnalyzer - Analyzes a single component file
 * 
 * Key Design Principles:
 * 1. Each component is analyzed independently (no aggregation)
 * 2. Results are cached by absolute file path
 * 3. Same component referenced by multiple parents uses cached result
 * 4. Child components are recursively analyzed with caching
 * 
 * The analyzer extracts:
 * - res.locals reads/writes
 * - req.transaction reads/writes
 * - Request data usage (query, body, params, headers, cookies)
 * - Response data (cookies, headers)
 * - External service calls
 * - Configuration dependencies
 * - Internal module dependencies (child components)
 */
export class ComponentAnalyzer {
  private cache = new Map<string, CacheEntry>();
  private analysisStack = new Set<string>(); // For circular dependency detection
  private readonly MAX_DEPTH = 10;
  private normalizedWorkspaceFolder: string;

  constructor(
    private workspaceFolder: string,
    private middlewareName: string
  ) {
    this.normalizedWorkspaceFolder = normalizePath(workspaceFolder);
  }

  private get middlewareRoot(): string {
    return path.join(this.normalizedWorkspaceFolder, `agl-${this.middlewareName}-middleware`);
  }

  /**
   * Clear the cache (for refresh operations)
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; paths: string[] } {
    return {
      size: this.cache.size,
      paths: Array.from(this.cache.keys())
    };
  }

  /**
   * Analyze a component by its absolute file path
   * Returns cached result if available and file hasn't changed
   * 
   * @param filePath - Absolute path to the component file
   * @param depth - Current depth in the component tree (for MAX_DEPTH check)
   * @param parentPath - Parent component's file path (for reference)
   */
  public analyze(filePath: string, depth: number = 0, parentPath?: string): ComponentAnalysis | null {
    // Normalize path for consistent cache keys
    const normalizedPath = normalizePath(filePath);
    
    // Check if file exists
    if (!fs.existsSync(normalizedPath)) {
      return null;
    }

    // Check for circular dependency
    if (this.analysisStack.has(normalizedPath)) {
      // Return a shallow reference to break the cycle
      return this.createShallowReference(normalizedPath, depth, parentPath);
    }

    // Check cache
    const cached = this.cache.get(normalizedPath);
    if (cached) {
      // Verify file hasn't changed (simple timestamp check)
      const stats = fs.statSync(normalizedPath);
      const currentHash = stats.mtimeMs.toString();
      
      if (cached.fileHash === currentHash) {
        // Return a reference to cached result with updated depth/parent
        return this.createCachedReference(cached.result, depth, parentPath);
      }
    }

    // Check depth limit
    if (depth >= this.MAX_DEPTH) {
      return this.createShallowReference(normalizedPath, depth, parentPath);
    }

    // Add to analysis stack (for circular dependency detection)
    this.analysisStack.add(normalizedPath);

    try {
      // Perform full analysis
      const result = this.analyzeFile(normalizedPath, depth, parentPath);
      
      if (result) {
        // Cache the result
        const stats = fs.statSync(normalizedPath);
        this.cache.set(normalizedPath, {
          result,
          fileHash: stats.mtimeMs.toString(),
          timestamp: Date.now()
        });
      }

      return result;
    } finally {
      // Remove from analysis stack
      this.analysisStack.delete(normalizedPath);
    }
  }

  /**
   * Analyze a middleware entry point and return its analysis
   * This is a convenience method for analyzing middleware files
   */
  public analyzeMiddlewareEntry(middlewarePath: string): ComponentAnalysis | null {
    let fullPath = path.join(this.middlewareRoot, `${middlewarePath}.js`);
    if (!fs.existsSync(fullPath)) {
      fullPath = path.join(this.middlewareRoot, `${middlewarePath}/index.js`);
    }

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    return this.analyze(fullPath, 0);
  }

  /**
   * Perform full analysis of a component file
   */
  private analyzeFile(filePath: string, depth: number, parentPath?: string): ComponentAnalysis | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      const component: ComponentAnalysis = {
        name: this.getModuleName(filePath),
        displayName: this.getDisplayName(filePath),
        filePath,
        exists: true,
        depth,
        parentPath,
        resLocalsReads: [],
        resLocalsWrites: [],
        reqTransactionReads: [],
        reqTransactionWrites: [],
        dataUsages: [],
        externalCalls: [],
        configDeps: [],
        requires: [],
        children: [],
        exportedFunctions: []
      };

      // Analyze the file content
      this.analyzeResLocals(lines, component.resLocalsReads, component.resLocalsWrites, filePath);
      this.analyzeReqTransaction(lines, component.reqTransactionReads, component.reqTransactionWrites, filePath);
      this.analyzeDataUsages(lines, component.dataUsages, filePath);
      this.analyzeExternalCalls(lines, component.externalCalls, filePath);
      this.analyzeConfigDeps(lines, component.configDeps);
      component.requires = this.analyzeRequires(lines, filePath);
      this.findExportedFunctions(lines, component);

      // Recursively analyze child components
      component.children = this.analyzeChildComponents(component.requires, filePath, depth + 1);

      return component;
    } catch (error) {
      console.error(`Error analyzing component ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Create a shallow reference for cached/circular components
   */
  private createShallowReference(filePath: string, depth: number, parentPath?: string): ComponentAnalysis {
    return {
      name: this.getModuleName(filePath),
      displayName: this.getDisplayName(filePath),
      filePath,
      exists: true,
      depth,
      parentPath,
      resLocalsReads: [],
      resLocalsWrites: [],
      reqTransactionReads: [],
      reqTransactionWrites: [],
      dataUsages: [],
      externalCalls: [],
      configDeps: [],
      requires: [],
      children: [],
      exportedFunctions: [],
      isShallowReference: true
    };
  }

  /**
   * Create a reference to a cached result with updated context
   */
  private createCachedReference(cached: ComponentAnalysis, depth: number, parentPath?: string): ComponentAnalysis {
    // Return a reference that preserves the cached analysis data
    // but updates the context-specific fields
    return {
      ...cached,
      depth,
      parentPath,
      isShallowReference: true // Mark as reference to indicate reuse
    };
  }

  /**
   * Analyze child components from require statements
   */
  private analyzeChildComponents(requires: RequireInfo[], parentPath: string, depth: number): ComponentAnalysis[] {
    const children: ComponentAnalysis[] = [];

    for (const req of requires) {
      if (!req.resolvedPath) continue;
      if (!req.isLocal && !req.isAglModule) continue;

      // Use the recursive analyze method (which handles caching)
      const child = this.analyze(req.resolvedPath, depth, parentPath);
      if (child) {
        children.push(child);
      }
    }

    return children;
  }

  /**
   * Get module name from file path
   */
  private getModuleName(filePath: string): string {
    const relativePath = path.relative(this.middlewareRoot, filePath);
    return relativePath.replace(/\\/g, '/').replace(/\.js$/, '');
  }

  /**
   * Get display name from file path
   */
  private getDisplayName(filePath: string): string {
    const fileName = path.basename(filePath, '.js');
    if (fileName === 'index') {
      return path.basename(path.dirname(filePath));
    }
    return fileName;
  }

  /**
   * Check if a file path belongs to a library
   */
  private isLibraryPath(filePath: string): boolean {
    return sharedIsLibraryPath(filePath);
  }

  /**
   * Get node_modules path for @opus modules
   */
  private getNodeModulesAglPath(moduleName: string): string {
    return path.join(this.middlewareRoot, 'node_modules', '@opus', moduleName);
  }

  /**
   * Check if workspace-level library exists (development mode)
   * If not, use node_modules path (installed dependency mode)
   */
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

  // ==================== Require Analysis ====================

  private analyzeRequires(lines: string[], currentFilePath: string): RequireInfo[] {
    const requires: RequireInfo[] = [];
    const seenModules = new Set<string>();
    const currentDir = path.dirname(currentFilePath);

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      const requirePatterns = [
        /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
        /(?:const|let|var)\s+\{\s*([^}]+)\s*\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
        /require\s*\(\s*['"]([^'"]+)['"]\s*\)/
      ];

      for (const pattern of requirePatterns) {
        const match = line.match(pattern);
        if (match) {
          let variableName: string;
          let modulePath: string;

          if (match.length === 3) {
            variableName = match[1].split(',')[0].trim();
            modulePath = match[2];
          } else {
            variableName = '';
            modulePath = match[1];
          }

          const isLocal = modulePath.startsWith('./') || modulePath.startsWith('../');
          const isAglModule = modulePath.startsWith('@opus/agl-');

          let resolvedPath: string | undefined;
          if (isLocal) {
            resolvedPath = this.resolveLocalPath(modulePath, currentDir);
          } else if (isAglModule) {
            resolvedPath = this.resolveAglModulePath(modulePath);
          }

          if (!seenModules.has(modulePath)) {
            seenModules.add(modulePath);
            requires.push({
              modulePath,
              variableName,
              resolvedPath,
              lineNumber,
              isLocal,
              isAglModule
            });
          }
          break;
        }
      }
    });

    return requires;
  }

  private resolveLocalPath(modulePath: string, currentDir: string): string | undefined {
    const basePath = path.resolve(currentDir, modulePath);
    
    if (modulePath.endsWith('.js') || modulePath.endsWith('.ts')) {
      if (fs.existsSync(basePath)) {
        return basePath;
      }
      return undefined;
    }
    
    const candidates = [
      `${basePath}.js`,
      `${basePath}.ts`,
      path.join(basePath, 'index.js'),
      path.join(basePath, 'index.ts')
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  private resolveAglModulePath(modulePath: string): string | undefined {
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
        
        const candidates = [
          `${basePath}.js`,
          `${basePath}.ts`,
          path.join(basePath, 'index.js'),
          path.join(basePath, 'index.ts')
        ];

        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }
      }
    }

    return undefined;
  }

  // ==================== res.locals Analysis ====================

  private analyzeResLocals(lines: string[], reads: ResLocalsUsage[], writes: ResLocalsUsage[], sourcePath: string): void {
    const isLibrary = this.isLibraryPath(sourcePath);
    const resLocalsPattern = /(?:res|response)\.locals\.(\w+(?:\.\w+)*)/g;
    
    const seenWrites = new Set<string>();
    const seenReads = new Set<string>();

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      let match;
      resLocalsPattern.lastIndex = 0;

      const deleteMatch = line.match(/delete\s+(?:res|response)\.locals\.(\w+(?:\.\w+)*)/);
      if (deleteMatch) {
        const property = deleteMatch[1];
        const key = `${property}:${lineNumber}:${sourcePath}`;
        if (!seenWrites.has(key)) {
          seenWrites.add(key);
          writes.push({
            property,
            type: 'write',
            lineNumber,
            codeSnippet: line.trim(),
            fullPath: property,
            sourcePath,
            isLibrary
          });
        }
      }

      while ((match = resLocalsPattern.exec(line)) !== null) {
        const codeSnippet = line.trim();
        const matchIndex = match.index;
        const afterMatch = line.substring(matchIndex + match[0].length);
        const beforeMatch = line.substring(0, matchIndex);

        if (/delete\s+(?:res|response)\.locals\.\w*$/.test(beforeMatch) || /delete\s+$/.test(beforeMatch)) continue;

        // Detect write operation and clean up property name
        const { isWrite, cleanedProperty } = this.detectWriteOperation(match[1], beforeMatch, afterMatch);
        
        // Remove native methods/props from property path
        let property = cleanedProperty;
        const propertyParts = property.split('.');
        const lastPart = propertyParts[propertyParts.length - 1];
        if (NATIVE_METHODS_AND_PROPS.includes(lastPart as typeof NATIVE_METHODS_AND_PROPS[number])) {
          propertyParts.pop();
          if (propertyParts.length === 0) continue;
          property = propertyParts.join('.');
        }

        const key = `${property}:${lineNumber}:${sourcePath}`;
        
        if (isWrite) {
          if (!seenWrites.has(key)) {
            seenWrites.add(key);
            writes.push({
              property,
              type: 'write',
              lineNumber,
              codeSnippet,
              fullPath: property,
              sourcePath,
              isLibrary
            });
          }
          
          if (/^\s*=(?!=)/.test(afterMatch)) {
            this.extractNestedPropertiesFromObjectLiteral(lines, index, property, writes, sourcePath, isLibrary);
          }
        } else {
          if (!seenReads.has(key)) {
            seenReads.add(key);
            reads.push({
              property,
              type: 'read',
              lineNumber,
              codeSnippet,
              fullPath: property,
              sourcePath,
              isLibrary
            });
          }
        }
      }
    });
  }

  /**
   * Determine if an operation is a write and clean up the property name
   * 
   * Handles:
   * - Direct assignment: obj.prop = value
   * - Delete operation: delete obj.prop
   * - Mutation methods: obj.prop.push(...) or obj.prop\n  .push(...)
   * - Compound assignment: obj.prop += value, obj.prop++
   * - Object.assign: Object.assign(obj.prop, ...)
   * 
   * @returns Object with isWrite flag and cleaned property name
   */
  private detectWriteOperation(
    property: string,
    beforeMatch: string,
    afterMatch: string
  ): { isWrite: boolean; cleanedProperty: string } {
    let cleanedProperty = property;
    let isMutationMethodCall = false;

    // Pattern 1: mutation method is part of property (e.g., "items.push")
    const methodMatch = property.match(MUTATION_METHODS_PATTERN);
    if (methodMatch && /^\s*\(/.test(afterMatch)) {
      isMutationMethodCall = true;
      cleanedProperty = property.substring(0, property.length - methodMatch[0].length);
    }

    // Pattern 2: mutation method is in afterMatch (e.g., "\n  .push(...)")
    if (!isMutationMethodCall && MUTATION_METHODS_CALL_PATTERN.test(afterMatch)) {
      isMutationMethodCall = true;
    }

    const isDelete = /delete\s+$/.test(beforeMatch);
    const isSpreadRead = /\.\.\.\s*$/.test(beforeMatch);
    const isWrite = isDelete || (!isSpreadRead && (
      isMutationMethodCall ||
      /^\s*=(?!=)/.test(afterMatch) ||
      /^\s*\[[^\]]*\]\s*=(?!=)/.test(afterMatch) ||
      /^\s*\.\w+\s*=(?!=)/.test(afterMatch) ||
      /^\s*(\+\+|--|[+\-*/%]?=(?!=)|\*\*=)/.test(afterMatch) ||
      /^\s*\[[^\]]*\]\s*(\+\+|--|[+\-*/%]?=(?!=)|\*\*=)/.test(afterMatch) ||
      /Object\.assign\s*\(\s*$/.test(beforeMatch)
    ));

    return { isWrite, cleanedProperty };
  }

  private extractNestedPropertiesFromObjectLiteral(
    lines: string[], 
    startLineIndex: number, 
    parentProperty: string, 
    writes: ResLocalsUsage[], 
    sourcePath: string,
    isLibrary: boolean = false
  ): void {
    let objectContent = '';
    let braceCount = 0;
    let started = false;
    let lineNumber = startLineIndex + 1;
    
    for (let i = startLineIndex; i < lines.length && i < startLineIndex + 20; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '{') {
          if (!started) started = true;
          braceCount++;
          objectContent += char;
        } else if (char === '}') {
          braceCount--;
          objectContent += char;
          if (started && braceCount === 0) {
            this.parseObjectLiteralPropertiesFlat(objectContent, parentProperty, writes, lineNumber, sourcePath, isLibrary);
            return;
          }
        } else if (started) {
          objectContent += char;
        }
      }
      if (started) objectContent += '\n';
    }
  }

  private parseObjectLiteralPropertiesFlat(
    objectContent: string, 
    parentProperty: string, 
    writes: ResLocalsUsage[], 
    lineNumber: number, 
    sourcePath: string,
    isLibrary: boolean = false
  ): void {
    const propertyPattern = /(?:^|[,{])\s*(['"]?)(\w+)\1\s*:/g;
    let match;
    const seenProps = new Set<string>();
    
    while ((match = propertyPattern.exec(objectContent)) !== null) {
      const propName = match[2];
      const fullProperty = `${parentProperty}.${propName}`;
      
      if (seenProps.has(fullProperty)) continue;
      seenProps.add(fullProperty);
      
      writes.push({
        property: fullProperty,
        type: 'write',
        lineNumber,
        codeSnippet: `(initialized in object literal)`,
        fullPath: fullProperty,
        sourcePath,
        isLibrary
      });
    }
  }

  // ==================== req.transaction Analysis ====================

  private analyzeReqTransaction(lines: string[], reads: ResLocalsUsage[], writes: ResLocalsUsage[], sourcePath: string): void {
    const isLibrary = this.isLibraryPath(sourcePath);
    const reqTransactionWithPropsPattern = /(?:req|request)\.transaction\.(\w+(?:\.\w+)*)/g;
    const reqTransactionDirectPattern = /(?:req|request)\.transaction(?!\.)/g;
    
    const seenWrites = new Set<string>();
    const seenReads = new Set<string>();
    const loggerCallPattern = /logger\.(info|warn|error|debug|trace|fatal|log)\s*\([^)]*$/;

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      let match;
      
      const deleteMatch = line.match(/delete\s+(?:req|request)\.transaction\.(\w+(?:\.\w+)*)/);
      if (deleteMatch) {
        const property = deleteMatch[1];
        const key = `${property}:${lineNumber}:${sourcePath}`;
        if (!seenWrites.has(key)) {
          seenWrites.add(key);
          writes.push({
            property,
            type: 'write',
            lineNumber,
            codeSnippet: line.trim(),
            fullPath: property,
            sourcePath,
            isLibrary
          });
        }
      }

      reqTransactionWithPropsPattern.lastIndex = 0;
      while ((match = reqTransactionWithPropsPattern.exec(line)) !== null) {
        const codeSnippet = line.trim();
        const matchIndex = match.index;
        const afterMatch = line.substring(matchIndex + match[0].length);
        const beforeMatch = line.substring(0, matchIndex);

        if (/delete\s+(?:req|request)\.transaction\.\w*$/.test(beforeMatch) || /delete\s+$/.test(beforeMatch)) continue;

        // Detect write operation and clean up property name
        const { isWrite, cleanedProperty: property } = this.detectWriteOperation(match[1], beforeMatch, afterMatch);
        const key = `${property}:${lineNumber}:${sourcePath}`;
        
        if (isWrite) {
          if (!seenWrites.has(key)) {
            seenWrites.add(key);
            writes.push({
              property,
              type: 'write',
              lineNumber,
              codeSnippet,
              fullPath: property,
              sourcePath,
              isLibrary
            });
          }
          
          if (/^\s*=(?!=)/.test(afterMatch)) {
            this.extractNestedPropertiesFromObjectLiteral(lines, index, property, writes, sourcePath, isLibrary);
          }
        } else {
          if (!seenReads.has(key)) {
            seenReads.add(key);
            reads.push({
              property,
              type: 'read',
              lineNumber,
              codeSnippet,
              fullPath: property,
              sourcePath,
              isLibrary
            });
          }
        }
      }
      
      reqTransactionDirectPattern.lastIndex = 0;
      while ((match = reqTransactionDirectPattern.exec(line)) !== null) {
        const matchIndex = match.index;
        const beforeMatch = line.substring(0, matchIndex);
        const afterMatch = line.substring(matchIndex + match[0].length);
        const codeSnippet = line.trim();
        
        if (loggerCallPattern.test(beforeMatch)) continue;
        if (/,\s*$/.test(beforeMatch) && /^\s*\)/.test(afterMatch)) {
          if (/logger\.\w+\s*\(/.test(line)) continue;
        }
        
        const property = '(direct)';
        const key = `${property}:${lineNumber}:${sourcePath}`;
        
        const isWrite = (
          /^\s*=(?!=)/.test(afterMatch) ||
          /Object\.assign\s*\(\s*$/.test(beforeMatch)
        );
        
        if (isWrite) {
          if (!seenWrites.has(key)) {
            seenWrites.add(key);
            writes.push({ property, type: 'write', lineNumber, codeSnippet, fullPath: property, sourcePath, isLibrary });
          }
        } else {
          if (!seenReads.has(key)) {
            seenReads.add(key);
            reads.push({ property, type: 'read', lineNumber, codeSnippet, fullPath: property, sourcePath, isLibrary });
          }
        }
      }
    });
  }

  // ==================== Data Usage Analysis ====================

  private analyzeDataUsages(lines: string[], results: DataUsage[], sourcePath: string): void {
    const isLibrary = this.isLibraryPath(sourcePath);

    const contextPatterns: { regex: RegExp; sourceType: DataSourceType }[] = [
      { regex: /(?:req|request)\.query\.(\w+)/g, sourceType: 'req.query' },
      { regex: /(?:req|request)\.query\[['"](\w+)['"]\]/g, sourceType: 'req.query' },
      { regex: /(?:req|request)\.body\.(\w+)/g, sourceType: 'req.body' },
      { regex: /(?:req|request)\.body\[['"](\w+)['"]\]/g, sourceType: 'req.body' },
      { regex: /(?:req|request)\.params\.(\w+)/g, sourceType: 'req.params' },
      { regex: /(?:req|request)\.params\[['"](\w+)['"]\]/g, sourceType: 'req.params' },
      { regex: /(?:req|request)\.headers\.(\w+)/g, sourceType: 'req.headers' },
      { regex: /(?:req|request)\.headers\[['"]([^'"]+)['"]\]/g, sourceType: 'req.headers' },
      { regex: /(?:req|request)\.cookies\.(\w+)/g, sourceType: 'req.cookies' },
      { regex: /(?:req|request)\.cookies\[['"](\w+)['"]\]/g, sourceType: 'req.cookies' },
    ];
    
    const readOnlyPatterns: { regex: RegExp; sourceType: DataSourceType }[] = [
      { regex: /(?:req|request)\.header\(['"]([^'"]+)['"]\)/g, sourceType: 'req.headers' },
    ];
    
    const writeOnlyPatterns: { regex: RegExp; sourceType: DataSourceType }[] = [
      { regex: /(?:res|response)\.cookie\(['"](\w+)['"]/g, sourceType: 'res.cookie' },
      { regex: /(?:res|response)\.setHeader\(['"]([^'"]+)['"]/g, sourceType: 'res.header' },
      { regex: /(?:res|response)\.set\(['"]([^'"]+)['"]/g, sourceType: 'res.header' },
      { regex: /(?:res|response)\.header\(['"]([^'"]+)['"]/g, sourceType: 'res.header' },
    ];

    const seen = new Set<string>();

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      for (const { regex, sourceType } of contextPatterns) {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(line)) !== null) {
          const matchIndex = match.index;
          const afterMatch = line.substring(matchIndex + match[0].length);
          const beforeMatch = line.substring(0, matchIndex);
          
          const { isWrite, cleanedProperty: property } = this.detectWriteOperation(match[1], beforeMatch, afterMatch);

          const usageType = isWrite ? 'write' : 'read';
          const key = `${sourceType}:${property}:${lineNumber}:${usageType}`;
          
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              sourceType,
              property,
              type: usageType,
              lineNumber,
              codeSnippet: line.trim(),
              fullPath: property,
              sourcePath,
              isLibrary
            });
          }
        }
      }
      
      for (const { regex, sourceType } of readOnlyPatterns) {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(line)) !== null) {
          const property = match[1];
          const key = `${sourceType}:${property}:${lineNumber}:read`;
          
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              sourceType,
              property,
              type: 'read',
              lineNumber,
              codeSnippet: line.trim(),
              fullPath: property,
              sourcePath,
              isLibrary
            });
          }
        }
      }
      
      for (const { regex, sourceType } of writeOnlyPatterns) {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(line)) !== null) {
          const property = match[1];
          const key = `${sourceType}:${property}:${lineNumber}:write`;
          
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              sourceType,
              property,
              type: 'write',
              lineNumber,
              codeSnippet: line.trim(),
              fullPath: property,
              sourcePath,
              isLibrary
            });
          }
        }
      }
    });
  }

  // ==================== External Calls Analysis ====================

  private analyzeExternalCalls(lines: string[], results: ExternalCall[], sourcePath: string): void {
    const isLibrary = this.isLibraryPath(sourcePath);

    const patterns: { pattern: RegExp, type: ExternalCall['type'], extractName?: boolean }[] = [
      { pattern: /(?:\w+\.)?callAVSDCQTemplate\s*\([\s\S]*?['"](\w+)['"]\s*\)/g, type: 'dcq', extractName: true },
      { pattern: /(?:\w+\.)?callDCQ\s*\([\s\S]*?['"](\w+)['"][\s\S]*?\)/g, type: 'dcq', extractName: true },
      { pattern: /(?:\w+\.)?callAVSDCQSearch\s*\([\s\S]*?['"](\w+)['"][\s\S]*?\)/g, type: 'dcq', extractName: true },
      { pattern: /(?:\w+\.)?callAVS\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'avs', extractName: true },
      { pattern: /(?:\w+\.)?callAVSB2C\s*\([\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'avs', extractName: true },
      { pattern: /(?:\w+\.)?callAVSB2CWithFullResponse\s*\([\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'avs', extractName: true },
      { pattern: /(?:\w+\.)?callAVSB2B\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'avs', extractName: true },
      { pattern: /(?:\w+\.)?callAVSB2BWithFullResponse\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'avs', extractName: true },
      { pattern: /(?:\w+\.)?callAVSB2BVersioned\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'avs', extractName: true },
      { pattern: /(?:\w+\.)?callAVSB2BVersionedWithFullResponse\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'avs', extractName: true },
      { pattern: /(?:\w+\.)?callPinboard\s*\(/g, type: 'pinboard', extractName: false },
      { pattern: /(?:\w+\.)?callAVSESTemplate\s*\([\s\S]*?,[\s\S]*?,\s*['"](\w+)['"]/g, type: 'elasticsearch', extractName: true },
      { pattern: /(?:\w+\.)?callDcqDecoupledESTemplate\s*\([\s\S]*?,[\s\S]*?,\s*['"](\w+)['"]/g, type: 'elasticsearch', extractName: true },
      { pattern: /(?:\w+\.)?callAVSESSearch\s*\(/g, type: 'elasticsearch', extractName: false },
      { pattern: /(?:\w+\.)?callES\s*\(/g, type: 'elasticsearch', extractName: false },
      { pattern: /(?:\w+\.)?callExternal\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'external', extractName: true },
      { pattern: /(?:\w+\.)?callExternal\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,\s*(\w+)/g, type: 'external', extractName: true },
      { pattern: /(?:\w+\.)?callAVA\s*\(/g, type: 'ava', extractName: false },
      { pattern: /(?:\w+\.)?callDsf\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'dsf', extractName: true },
      { pattern: /(?:\w+\.)?callDsf\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,\s*(\w+)/g, type: 'dsf', extractName: true },
      { pattern: /(?:\w+\.)?callAVSMicroservice\s*\([\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'microservice', extractName: true },
      { pattern: /(?:\w+\.)?callGetAggregatedContentDetail\s*\(/g, type: 'dcq', extractName: false },
      { pattern: /(?:\w+\.)?callGetLiveContentMetadata\s*\(/g, type: 'dcq', extractName: false },
      { pattern: /(?:\w+\.)?callGetVodContentMetadata\s*\(/g, type: 'dcq', extractName: false },
      { pattern: /(?:\w+\.)?callGetLauncherMetadata\s*\(/g, type: 'dcq', extractName: false },
      { pattern: /(?:\w+\.)?callGetLiveChannelList\s*\(/g, type: 'dcq', extractName: false },
      { pattern: /(?:\w+\.)?callSearchSuggestions\s*\(/g, type: 'dcq', extractName: false },
      { pattern: /(?:\w+\.)?callSearchVodEvents\s*\(/g, type: 'dcq', extractName: false },
      { pattern: /(?:\w+\.)?callSearchContents\s*\(/g, type: 'dcq', extractName: false },
      { pattern: /(?:\w+\.)?callGetLiveInfo\s*\(/g, type: 'dcq', extractName: false },
      { pattern: /(?:\w+\.)?callGetEpg\s*\(/g, type: 'dcq', extractName: false },
      { pattern: /(?:\w+\.)?callESTemplate\s*\([\s\S]*?['"](\w+)['"][\s\S]*?\)/g, type: 'elasticsearch', extractName: true },
    ];

    const seen = new Set<string>();
    const content = lines.join('\n');

    for (const { pattern, type, extractName } of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        let template: string | undefined;
        
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
        
        if (extractName && match[1]) {
          template = match[1];
        } else if (!extractName) {
          const methodMatch = match[0].match(/call(\w+)\s*\(/);
          if (methodMatch) {
            template = methodMatch[1];
          }
        }
        
        const key = `${type}:${template || ''}:${lineNumber}:${sourcePath}`;
        
        if (!seen.has(key)) {
          seen.add(key);
          const snippetLine = lines[lineNumber - 1] || '';
          results.push({
            type,
            lineNumber,
            template,
            codeSnippet: snippetLine.trim(),
            sourcePath,
            isLibrary
          });
        }
      }
    }
    
    this.detectHttpCalls(lines, results, seen, sourcePath, isLibrary);
  }
  
  private detectHttpCalls(lines: string[], results: ExternalCall[], seen: Set<string>, sourcePath: string, isLibrary: boolean): void {
    const httpPatterns = [
      /aglUtils\.httpClient\s*\(/,
      /aglUtils\.forwardRequest\s*\(/,
      /aglUtils\.v2\.httpClient\s*\(/,
    ];
    
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      
      for (const pattern of httpPatterns) {
        if (pattern.test(line)) {
          const endpointName = this.extractHttpEndpointName(lines, index);
          const key = `http:${endpointName}:${lineNumber}:${sourcePath}`;
          
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              type: 'http',
              lineNumber,
              template: endpointName,
              codeSnippet: line.trim(),
              sourcePath,
              isLibrary
            });
          }
          break;
        }
      }
    });
  }
  
  private extractHttpEndpointName(lines: string[], currentIndex: number): string {
    const startIndex = Math.max(0, currentIndex - 10);
    const contextLines = lines.slice(startIndex, currentIndex + 1);
    
    const namePatterns = [
      /process\.env\.([A-Z_]+URL[A-Z_]*)/,
      /process\.env\.([A-Z_]+SERVICE[A-Z_]*)/,
      /process\.env\.([A-Z_]+API[A-Z_]*)/,
      /process\.env\.([A-Z_]+ENDPOINT[A-Z_]*)/,
      /process\.env\.([A-Z][A-Z_]+)/,
      /(?:const|let|var)\s+(\w+(?:URL|Url|url))\s*=/,
      /(?:const|let|var)\s+(\w+(?:Endpoint|endpoint))\s*=/,
      /(?:const|let|var)\s+(\w+(?:Service|service))\s*=/,
      /getMWareConfig\s*\(\s*['"](\w+)['"]/,
      /url:\s*(\w+(?:URL|Url|url)\w*)/,
      /url:\s*['"]([^'"]+)['"]/,
    ];
    
    for (const contextLine of contextLines.reverse()) {
      for (const pattern of namePatterns) {
        const match = contextLine.match(pattern);
        if (match && match[1]) {
          return match[1];
        }
      }
    }
    
    return 'httpClient';
  }

  // ==================== Config Dependencies Analysis ====================

  private analyzeConfigDeps(lines: string[], results: ConfigDependency[]): void {
    const patterns = [
      { pattern: /appCache\.getMWareConfig\s*\(\s*['"](\w+)['"]/g, source: 'mWareConfig' as const },
      { pattern: /appCache\.getAppConfig\s*\(\s*['"]?(\w+)?['"]?\s*\)/g, source: 'appConfig' as const },
      { pattern: /appCache\.getSysParameter\s*\(\s*['"](\w+)['"]/g, source: 'sysParameter' as const },
      { pattern: /appCache\.get\s*\(\s*['"](\w+)['"]/g, source: 'appCache' as const },
    ];

    const seen = new Set<string>();

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      patterns.forEach(({ pattern, source }) => {
        let match;
        const regex = new RegExp(pattern.source, pattern.flags);
        while ((match = regex.exec(line)) !== null) {
          const key = match[1] || 'default';
          const dedupKey = `${source}:${key}`;

          if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            results.push({ source, key, lineNumber, codeSnippet: line.trim() });
          }
        }
      });
    });
  }

  // ==================== Exported Functions Analysis ====================

  private findExportedFunctions(lines: string[], component: ComponentAnalysis): void {
    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      const exportMatch = line.match(/module\.exports\.(\w+)\s*=/);
      if (exportMatch) {
        component.exportedFunctions.push(exportMatch[1]);
        if (exportMatch[1] === 'execute' || exportMatch[1] === 'run') {
          component.mainFunctionLine = lineNumber;
        }
      }

      const exportsMatch = line.match(/^exports\.(\w+)\s*=/);
      if (exportsMatch) {
        component.exportedFunctions.push(exportsMatch[1]);
      }

      const moduleExportsObjMatch = line.match(/module\.exports\s*=\s*\{([^}]+)\}/);
      if (moduleExportsObjMatch) {
        const functions = moduleExportsObjMatch[1].split(',').map(f => f.trim().split(':')[0].trim());
        component.exportedFunctions.push(...functions.filter(f => f));
      }
    });
  }
}
