import * as fs from 'fs';
import * as path from 'path';
import {
  ComponentAnalysis,
  ConfigDependency,
  DataSourceType,
  DataUsage,
  ExternalCall,
  MiddlewareAnalysis,
  RequireInfo,
  ResLocalsUsage
} from '../models/flow-analyzer-types';

/**
 * Analyzes middleware source code to extract:
 * - res.locals reads/writes
 * - Request data (query, body, params, headers, cookies)
 * - Response data (cookies, headers)
 * - External service calls
 * - Configuration dependencies
 * - Internal module dependencies (components)
 * - Recursively analyzes all components
 */
export class MiddlewareAnalyzer {
  private analyzedPaths = new Set<string>();
  private analyzedComponents = new Map<string, ComponentAnalysis>();
  private readonly MAX_DEPTH = 10;
  private normalizedWorkspaceFolder: string;

  constructor(
    private workspaceFolder: string,
    private middlewareName: string
  ) {
    // Normalize path for Windows: convert /c/... to C:/...
    this.normalizedWorkspaceFolder = this.normalizePath(workspaceFolder);
  }

  /**
   * Normalize path for cross-platform compatibility
   * Converts Git Bash style /c/... to Windows style C:/...
   */
  private normalizePath(p: string): string {
    // Convert /c/Users/... to C:/Users/...
    if (/^\/[a-zA-Z]\//.test(p)) {
      return p.replace(/^\/([a-zA-Z])\//, '$1:/');
    }
    return p;
  }

  private get middlewareRoot(): string {
    return path.join(this.normalizedWorkspaceFolder, `agl-${this.middlewareName}-middleware`);
  }


  /**
   * Get node_modules path for @opus modules
   * Falls back to middleware project's node_modules if workspace-level libraries don't exist
   */
  private getNodeModulesAglPath(moduleName: string): string {
    return path.join(this.middlewareRoot, 'node_modules', '@opus', moduleName);
  }

  /**
   * Check if workspace-level library exists (development mode)
   * If not, use node_modules path (installed dependency mode)
   */
  private getAglModuleRoot(moduleName: string): string | undefined {
    // First try workspace-level (development mode)
    const workspacePath = path.join(this.normalizedWorkspaceFolder, moduleName);
    if (fs.existsSync(workspacePath)) {
      return workspacePath;
    }
    
    // Fall back to node_modules (installed dependency mode)
    const nodeModulesPath = this.getNodeModulesAglPath(moduleName);
    if (fs.existsSync(nodeModulesPath)) {
      return nodeModulesPath;
    }
    
    return undefined;
  }

  /**
   * Check if a file path belongs to a low-level library (agl-core, agl-utils, etc.)
   * These files contain infrastructure code rather than business logic
   * Supports both workspace-level paths (agl-core/...) and node_modules paths (node_modules/@opus/agl-core/...)
   */
  private isLibraryPath(filePath: string): boolean {
    if (!filePath) return false;
    
    const libraryPatterns = [
      // agl-utils - entire module is infrastructure
      // Require path separator before module name to avoid matching 'abc_agl-utils'
      /[/\\]agl-utils[/\\]/i,
      
      // agl-core - entire module is infrastructure
      /[/\\]agl-core[/\\]/i,
      
      // agl-cache - entire module is infrastructure
      /[/\\]agl-cache[/\\]/i,
      
      // agl-logger - entire module is infrastructure
      /[/\\]agl-logger[/\\]/i,
      
      // Local utils/wrapper in middleware projects
      /utils[/\\]wrapper[/\\]/i,
      
      // Shared utility files in middleware projects
      /shared[/\\].*[/\\](wrapper|request|http)/i,
    ];
    
    return libraryPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Analyze a single middleware file with deep component analysis
   */
  public analyzeMiddleware(middlewarePath: string): MiddlewareAnalysis {
    this.analyzedPaths.clear();
    this.analyzedComponents.clear();
    console.log(`[FlowAnalyzer] Starting analysis of: ${middlewarePath}`);

    const result: MiddlewareAnalysis = {
      name: middlewarePath,
      filePath: '',
      exists: false,
      resLocalsReads: [],
      resLocalsWrites: [],
      reqTransactionReads: [],
      reqTransactionWrites: [],
      dataUsages: [],
      externalCalls: [],
      configDeps: [],
      internalDeps: [],
      components: [],
      allResLocalsReads: [],
      allResLocalsWrites: [],
      allReqTransactionReads: [],
      allReqTransactionWrites: [],
      allDataUsages: [],
      allExternalCalls: [],
      allConfigDeps: []
    };

    let fullPath = path.join(this.middlewareRoot, `${middlewarePath}.js`);
    if (!fs.existsSync(fullPath)) {
      fullPath = path.join(this.middlewareRoot, `${middlewarePath}/index.js`);
    }

    if (!fs.existsSync(fullPath)) {
      result.filePath = fullPath;
      return result;
    }

    result.filePath = fullPath;
    result.exists = true;
    this.analyzedPaths.add(fullPath);

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      console.log(`[FlowAnalyzer] File has ${lines.length} lines`);

      console.log(`[FlowAnalyzer] Analyzing res.locals...`);
      this.analyzeResLocals(lines, result.resLocalsReads, result.resLocalsWrites, fullPath);
      console.log(`[FlowAnalyzer] Analyzing req.transaction...`);
      this.analyzeReqTransaction(lines, result.reqTransactionReads, result.reqTransactionWrites, fullPath);
      console.log(`[FlowAnalyzer] Analyzing data usages...`);
      this.analyzeDataUsages(lines, result.dataUsages, fullPath);
      console.log(`[FlowAnalyzer] Analyzing external calls...`)
      this.analyzeExternalCalls(lines, result.externalCalls, fullPath);
      console.log(`[FlowAnalyzer] Analyzing config deps...`);
      this.analyzeConfigDeps(lines, result.configDeps);
      console.log(`[FlowAnalyzer] Analyzing requires...`);
      const requires = this.analyzeRequires(lines, fullPath);
      result.internalDeps = requires.map(r => r.modulePath);
      this.findFunctionLocations(lines, result);

      console.log(`[FlowAnalyzer] Analyzing ${requires.length} components...`);
      result.components = this.analyzeComponents(requires, fullPath, 0);
      console.log(`[FlowAnalyzer] Aggregating component data...`);
      this.aggregateComponentData(result);
      console.log(`[FlowAnalyzer] Middleware analysis complete`);

    } catch (error) {
      console.error(`Error analyzing ${middlewarePath}:`, error);
    }

    return result;
  }

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
    
    // If path already has an extension, check if it exists directly
    if (modulePath.endsWith('.js') || modulePath.endsWith('.ts')) {
      if (fs.existsSync(basePath)) {
        return basePath;
      }
      return undefined;
    }
    
    // Otherwise try adding extensions
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
    // Map @opus/agl-xxx to the actual module name
    const moduleMapping: { [key: string]: string } = {
      '@opus/agl-core': 'agl-core',
      '@opus/agl-utils': 'agl-utils',
      '@opus/agl-cache': 'agl-cache',
      '@opus/agl-logger': 'agl-logger'
    };

    // Check for exact module match first (e.g., @opus/agl-core)
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

    // Handle submodule paths (e.g., @opus/agl-core/shared/authUserCookieDecrypt)
    for (const [modulePrefix, moduleName] of Object.entries(moduleMapping)) {
      if (modulePath.startsWith(modulePrefix + '/')) {
        const root = this.getAglModuleRoot(moduleName);
        if (!root) {
          continue;
        }
        
        const subPath = modulePath.substring(modulePrefix.length + 1);
        const basePath = path.join(root, subPath);
        
        // Try various extensions and index.js
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

  private analyzeComponents(requires: RequireInfo[], parentPath: string, depth: number): ComponentAnalysis[] {
    if (depth >= this.MAX_DEPTH) {
      console.log(`[FlowAnalyzer] Max depth ${this.MAX_DEPTH} reached, stopping recursion`);
      return [];
    }

    const components: ComponentAnalysis[] = [];
    console.log(`[FlowAnalyzer] Depth ${depth}: Processing ${requires.filter(r => r.resolvedPath && (r.isLocal || r.isAglModule)).length} local/agl requires`);

    for (const req of requires) {
      if (!req.resolvedPath) {
        continue;
      }
      if (!req.isLocal && !req.isAglModule) {
        continue;
      }

      // Check if already analyzed - if so, reuse the cached result
      const alreadyAnalyzed = this.analyzedPaths.has(req.resolvedPath);
      
      if (alreadyAnalyzed) {
        // Reuse cached component (with all its children preserved)
        const cachedComponent = this.analyzedComponents.get(req.resolvedPath);
        if (cachedComponent) {
          // Create a reference to the cached component (preserves children!)
          const componentRef: ComponentAnalysis = {
            ...cachedComponent,
            depth, // Update depth for this occurrence
            parentPath, // Update parent for this occurrence
            isShallowReference: true
          };
          components.push(componentRef);
        }
      } else {
        // Full analysis for new components
        console.log(`[FlowAnalyzer] Depth ${depth}: Analyzing component: ${req.modulePath}`);
        this.analyzedPaths.add(req.resolvedPath);
        const component = this.analyzeComponent(req, parentPath, depth);
        if (component && component.exists) {
          // Cache the analyzed component
          this.analyzedComponents.set(req.resolvedPath, component);
          components.push(component);
        }
      }
    }

    return components;
  }

  private createShallowComponent(requireInfo: RequireInfo, parentPath: string, depth: number): ComponentAnalysis | null {
    const filePath = requireInfo.resolvedPath;
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    // Create component with basic info but no deep analysis
    // This prevents the same module from being fully analyzed multiple times
    // while still showing it as a child of each parent that requires it
    return {
      name: requireInfo.modulePath,
      displayName: this.getDisplayName(requireInfo.modulePath),
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
      children: [], // No children for shallow references
      exportedFunctions: [],
      isShallowReference: true // Mark as shallow to avoid confusion
    };
  }

  private analyzeComponent(requireInfo: RequireInfo, parentPath: string, depth: number): ComponentAnalysis | null {
    const filePath = requireInfo.resolvedPath;
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    const component: ComponentAnalysis = {
      name: requireInfo.modulePath,
      displayName: this.getDisplayName(requireInfo.modulePath),
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

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      this.analyzeResLocals(lines, component.resLocalsReads, component.resLocalsWrites, filePath);
      this.analyzeReqTransaction(lines, component.reqTransactionReads, component.reqTransactionWrites, filePath);
      this.analyzeDataUsages(lines, component.dataUsages, filePath);
      this.analyzeExternalCalls(lines, component.externalCalls, filePath);
      this.analyzeConfigDeps(lines, component.configDeps);
      component.requires = this.analyzeRequires(lines, filePath);
      this.findExportedFunctions(lines, component);

      component.children = this.analyzeComponents(component.requires, filePath, depth + 1);

    } catch (error) {
      console.error(`Error analyzing component ${requireInfo.modulePath}:`, error);
    }

    return component;
  }

  private getDisplayName(modulePath: string): string {
    if (modulePath.startsWith('@opus/')) {
      return modulePath.replace('@opus/', '');
    }
    const parts = modulePath.split('/');
    return parts[parts.length - 1] || modulePath;
  }

  private aggregateComponentData(result: MiddlewareAnalysis): void {
    result.allResLocalsReads = [...result.resLocalsReads];
    result.allResLocalsWrites = [...result.resLocalsWrites];
    result.allReqTransactionReads = [...result.reqTransactionReads];
    result.allReqTransactionWrites = [...result.reqTransactionWrites];
    result.allDataUsages = [...result.dataUsages];
    result.allExternalCalls = [...result.externalCalls];
    result.allConfigDeps = [...result.configDeps];

    // Track already collected file paths to avoid duplicate collection
    // when same component is referenced from multiple places
    const collectedPaths = new Set<string>();

    const collectFromComponent = (component: ComponentAnalysis) => {
      // Skip if this component's file has already been collected
      // This prevents duplicate data when same file is referenced multiple times
      if (collectedPaths.has(component.filePath)) {
        return;
      }
      collectedPaths.add(component.filePath);

      result.allResLocalsReads.push(...component.resLocalsReads);
      result.allResLocalsWrites.push(...component.resLocalsWrites);
      result.allReqTransactionReads.push(...component.reqTransactionReads);
      result.allReqTransactionWrites.push(...component.reqTransactionWrites);
      result.allDataUsages.push(...component.dataUsages);
      result.allExternalCalls.push(...component.externalCalls);
      result.allConfigDeps.push(...component.configDeps);

      for (const child of component.children) {
        collectFromComponent(child);
      }
    };

    for (const component of result.components) {
      collectFromComponent(component);
    }

    // Deduplicate all aggregated data - removes exact duplicates but keeps all unique source files
    result.allResLocalsReads = this.deduplicateUsages(result.allResLocalsReads);
    result.allResLocalsWrites = this.deduplicateUsages(result.allResLocalsWrites);
    result.allReqTransactionReads = this.deduplicateUsages(result.allReqTransactionReads);
    result.allReqTransactionWrites = this.deduplicateUsages(result.allReqTransactionWrites);
    result.allDataUsages = this.deduplicateDataUsages(result.allDataUsages);
    result.allExternalCalls = this.deduplicateExternalCalls(result.allExternalCalls);
    result.allConfigDeps = this.deduplicateConfigDeps(result.allConfigDeps);
  }

  /**
   * Deduplicate external calls by type, template, and source path
   * Keep only one entry per unique call per source file
   * Filter out library-level calls - these are implementation details
   */
  private deduplicateExternalCalls(calls: ExternalCall[]): ExternalCall[] {
    const seen = new Map<string, ExternalCall>();
    for (const call of calls) {
      // Skip library-level external calls - these are internal implementation details
      // e.g., callDcqDecoupledESTemplate inside dcq_es_mapper.js
      if (call.isLibrary) {
        continue;
      }
      // Key by type + template + sourcePath (not line number - same call in same file counts as one)
      const key = `${call.type}:${call.template || ''}:${call.sourcePath}`;
      if (!seen.has(key)) {
        seen.set(key, call);
      }
    }
    return Array.from(seen.values());
  }

  /**
   * Deduplicate data usages (req.query, req.headers, etc.)
   * Keep one entry per sourceType + property + type + sourcePath combination
   * This removes exact duplicates but preserves all unique source files
   */
  private deduplicateDataUsages(usages: DataUsage[]): DataUsage[] {
    const seen = new Map<string, DataUsage>();
    
    for (const usage of usages) {
      // Key by sourceType + property + type + sourcePath
      const key = `${usage.sourceType}:${usage.property}:${usage.type}:${usage.sourcePath}`;
      if (!seen.has(key)) {
        seen.set(key, usage);
      }
    }
    
    return Array.from(seen.values());
  }

  /**
   * Deduplicate config dependencies by source and key
   */
  private deduplicateConfigDeps(deps: ConfigDependency[]): ConfigDependency[] {
    const seen = new Map<string, ConfigDependency>();
    for (const dep of deps) {
      const key = `${dep.source}:${dep.key}`;
      if (!seen.has(key)) {
        seen.set(key, dep);
      }
    }
    return Array.from(seen.values());
  }

  /**
   * Analyze various data usages: req.query, req.body, req.params, req.headers, req.cookies, etc.
   * Now with dynamic read/write detection based on code context
   * Supports both req/request and res/response naming styles
   */
  private analyzeDataUsages(lines: string[], results: DataUsage[], sourcePath: string): void {
    // Check if this is a library file - we still analyze it but mark the results
    const isLibrary = this.isLibraryPath(sourcePath);

    // Patterns that need context-based read/write detection
    // Support both req and request naming
    const contextPatterns: { regex: RegExp; sourceType: DataSourceType }[] = [
      // Request data (can be read or written) - support both req and request
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
    
    // Patterns that are always reads (function calls) - support both req and request
    const readOnlyPatterns: { regex: RegExp; sourceType: DataSourceType }[] = [
      { regex: /(?:req|request)\.header\(['"]([^'"]+)['"]\)/g, sourceType: 'req.headers' },
    ];
    
    // Patterns that are always writes - support both res and response
    const writeOnlyPatterns: { regex: RegExp; sourceType: DataSourceType }[] = [
      { regex: /(?:res|response)\.cookie\(['"](\w+)['"]/g, sourceType: 'res.cookie' },
      { regex: /(?:res|response)\.setHeader\(['"]([^'"]+)['"]/g, sourceType: 'res.header' },
      { regex: /(?:res|response)\.set\(['"]([^'"]+)['"]/g, sourceType: 'res.header' },
      { regex: /(?:res|response)\.header\(['"]([^'"]+)['"]/g, sourceType: 'res.header' },
    ];

    // Use Set for O(1) deduplication
    const seen = new Set<string>();
    results.forEach(r => seen.add(`${r.sourceType}:${r.property}:${r.lineNumber}:${r.type}`));

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      // Process context-based patterns (detect if it's read or write)
      for (const { regex, sourceType } of contextPatterns) {
        regex.lastIndex = 0; // Reset regex state
        let match;
        while ((match = regex.exec(line)) !== null) {
          const property = match[1];
          const matchIndex = match.index;
          const afterMatch = line.substring(matchIndex + match[0].length);
          const beforeMatch = line.substring(0, matchIndex);
          
          // Check for delete statement
          const isDelete = /delete\s+$/.test(beforeMatch);
          
          // Determine if write operation (same logic as res.locals)
          const isSpreadRead = /\.\.\.\s*$/.test(beforeMatch);
          const isWrite = isDelete || (!isSpreadRead && (
            /^\s*=(?!=)/.test(afterMatch) ||                    // direct assignment
            /^\s*\[[^\]]*\]\s*=(?!=)/.test(afterMatch) ||       // indexed assignment
            /^\s*\.\w+\s*=(?!=)/.test(afterMatch) ||            // property assignment
            /^\s*(\+\+|--|[+\-*/%]?=(?!=)|\*\*=)/.test(afterMatch) ||  // compound assignment
            /^\s*\.(push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\s*\(/.test(afterMatch) ||  // array mutation
            /^\s*\.(set|add|delete|clear)\s*\(/.test(afterMatch)   // Map/Set mutation
          ));

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
      
      // Process read-only patterns
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
      
      // Process write-only patterns
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

  private analyzeResLocals(lines: string[], reads: ResLocalsUsage[], writes: ResLocalsUsage[], sourcePath: string): void {
    // Check if this is a library file - we still analyze it but mark the results
    const isLibrary = this.isLibraryPath(sourcePath);

    // Support both res.locals and response.locals
    const resLocalsPattern = /(?:res|response)\.locals\.(\w+(?:\.\w+)*)/g;
    
    // Use Sets for O(1) deduplication lookup
    const seenWrites = new Set<string>();
    const seenReads = new Set<string>();
    
    // Pre-populate sets with existing entries
    writes.forEach(w => seenWrites.add(`${w.property}:${w.lineNumber}:${w.sourcePath}`));
    reads.forEach(r => seenReads.add(`${r.property}:${r.lineNumber}:${r.sourcePath}`));
    
    // List of mutation methods that modify the object/array they're called on
    const mutationMethods = [
      'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin',
      'set', 'add', 'delete', 'clear'
    ];
    const mutationMethodsPattern = new RegExp(`\\.(${mutationMethods.join('|')})$`);

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      let match;
      resLocalsPattern.lastIndex = 0;

      // Check for delete statement: delete res.locals.xxx or delete response.locals.xxx
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
        let property = match[1];
        const codeSnippet = line.trim();
        const matchIndex = match.index;
        const afterMatch = line.substring(matchIndex + match[0].length);
        const beforeMatch = line.substring(0, matchIndex);

        // Skip if this was already captured as a delete operation (support both res and response)
        if (/delete\s+(?:res|response)\.locals\.\w*$/.test(beforeMatch) || /delete\s+$/.test(beforeMatch)) continue;

        // Handle mutation methods captured in property name
        let isMutationMethodCall = false;
        const methodMatch = property.match(mutationMethodsPattern);
        if (methodMatch && /^\s*\(/.test(afterMatch)) {
          isMutationMethodCall = true;
          property = property.substring(0, property.length - methodMatch[0].length);
        }
        
        // Skip JavaScript native array/object methods and properties
        // These are not actual data properties set by the application
        const nativeMethodsAndProps = [
          'length', 'indexOf', 'find', 'findIndex', 'filter', 'map', 'reduce', 'reduceRight',
          'forEach', 'some', 'every', 'includes', 'slice', 'concat', 'join', 'flat', 'flatMap',
          'keys', 'values', 'entries', 'at', 'toString', 'toLocaleString', 'constructor',
          'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'valueOf'
        ];
        
        // Check if the property ends with a native method/property being called or accessed
        const propertyParts = property.split('.');
        const lastPart = propertyParts[propertyParts.length - 1];
        if (nativeMethodsAndProps.includes(lastPart)) {
          // Remove the native method/property part to get the actual data property
          propertyParts.pop();
          if (propertyParts.length === 0) continue; // Skip if only native method
          property = propertyParts.join('.');
        }

        // Determine if write operation
        const isSpreadRead = /\.\.\.\s*$/.test(beforeMatch);
        const isWrite = !isSpreadRead && (
          isMutationMethodCall ||
          /^\s*=(?!=)/.test(afterMatch) ||                    // direct assignment
          /^\s*\[[^\]]*\]\s*=(?!=)/.test(afterMatch) ||       // indexed assignment
          /^\s*\.\w+\s*=(?!=)/.test(afterMatch) ||            // property assignment
          /^\s*(\+\+|--|[+\-*/%]?=(?!=)|\*\*=)/.test(afterMatch) ||  // compound assignment
          /^\s*\[[^\]]*\]\s*(\+\+|--|[+\-*/%]?=(?!=)|\*\*=)/.test(afterMatch) ||  // indexed compound
          /^\s*\.(push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\s*\(/.test(afterMatch) ||  // array mutation
          /^\s*\.(set|add|delete|clear)\s*\(/.test(afterMatch) ||  // Map/Set mutation
          /Object\.assign\s*\(\s*$/.test(beforeMatch)         // Object.assign target
        );

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
          
          // Detect nested properties in object literal assignments
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
   * Extract nested properties from object literal assignments
   * e.g., res.locals.seedData = { containers: [], foo: { bar: 1 } }
   * should record writes to: seedData, seedData.containers, seedData.foo, seedData.foo.bar
   */
  private extractNestedPropertiesFromObjectLiteral(
    lines: string[], 
    startLineIndex: number, 
    parentProperty: string, 
    writes: ResLocalsUsage[], 
    sourcePath: string,
    isLibrary: boolean = false
  ): void {
    // Find the object literal content - could span multiple lines (limit to 20 lines for performance)
    let objectContent = '';
    let braceCount = 0;
    let started = false;
    let lineNumber = startLineIndex + 1;
    
    for (let i = startLineIndex; i < lines.length && i < startLineIndex + 20; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '{') {
          if (!started) {
            started = true;
          }
          braceCount++;
          objectContent += char;
        } else if (char === '}') {
          braceCount--;
          objectContent += char;
          if (started && braceCount === 0) {
            // Found complete object literal - only parse top level properties (no recursion for performance)
            this.parseObjectLiteralPropertiesFlat(objectContent, parentProperty, writes, lineNumber, sourcePath, isLibrary);
            return;
          }
        } else if (started) {
          objectContent += char;
        }
      }
      if (started) {
        objectContent += '\n';
      }
    }
  }

  /**
   * Parse object literal and extract only top-level property paths (no recursion for performance)
   */
  private parseObjectLiteralPropertiesFlat(
    objectContent: string, 
    parentProperty: string, 
    writes: ResLocalsUsage[], 
    lineNumber: number, 
    sourcePath: string,
    isLibrary: boolean = false
  ): void {
    // Simple regex-based parsing for top-level properties only
    // Match patterns like: propertyName: value, or 'propertyName': value, or "propertyName": value
    const propertyPattern = /(?:^|[,{])\s*(['"]?)(\w+)\1\s*:/g;
    let match;
    const seenProps = new Set<string>();
    
    while ((match = propertyPattern.exec(objectContent)) !== null) {
      const propName = match[2];
      const fullProperty = `${parentProperty}.${propName}`;
      
      // Skip if already seen
      if (seenProps.has(fullProperty)) continue;
      seenProps.add(fullProperty);
      
      const usage: ResLocalsUsage = {
        property: fullProperty,
        type: 'write',
        lineNumber,
        codeSnippet: `(initialized in object literal)`,
        fullPath: fullProperty,
        sourcePath,
        isLibrary
      };
      
      writes.push(usage);
    }
  }

  /**
   * Analyze req.transaction (or request.transaction) reads and writes
   * Similar to res.locals analysis
   * Note: req.transaction can be used directly without child properties (unlike res.locals)
   * Also: Skip logger calls like logger.info(..., req.transaction)
   */
  private analyzeReqTransaction(lines: string[], reads: ResLocalsUsage[], writes: ResLocalsUsage[], sourcePath: string): void {
    // Check if this is a library file - we still analyze it but mark the results
    const isLibrary = this.isLibraryPath(sourcePath);

    // Match both req.transaction and request.transaction - with optional child properties
    // Pattern 1: req.transaction.xxx (with child properties)
    const reqTransactionWithPropsPattern = /(?:req|request)\.transaction\.(\w+(?:\.\w+)*)/g;
    // Pattern 2: req.transaction (direct use, no child properties)
    const reqTransactionDirectPattern = /(?:req|request)\.transaction(?!\.)/g;
    
    // Use Sets for O(1) deduplication lookup
    const seenWrites = new Set<string>();
    const seenReads = new Set<string>();
    
    // Pre-populate sets with existing entries
    writes.forEach(w => seenWrites.add(`${w.property}:${w.lineNumber}:${w.sourcePath}`));
    reads.forEach(r => seenReads.add(`${r.property}:${r.lineNumber}:${r.sourcePath}`));
    
    // List of mutation methods that modify the object/array they're called on
    const mutationMethods = [
      'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin',
      'set', 'add', 'delete', 'clear'
    ];
    const mutationMethodsPattern = new RegExp(`\\.(${mutationMethods.join('|')})$`);
    
    // Pattern to detect logger calls - skip these for direct req.transaction usage
    const loggerCallPattern = /logger\.(info|warn|error|debug|trace|fatal|log)\s*\([^)]*$/;

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      let match;
      
      // Check for delete statement: delete req.transaction.xxx or delete request.transaction.xxx
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

      // Pattern 1: Handle req.transaction.xxx (with child properties)
      reqTransactionWithPropsPattern.lastIndex = 0;
      while ((match = reqTransactionWithPropsPattern.exec(line)) !== null) {
        let property = match[1];
        const codeSnippet = line.trim();
        const matchIndex = match.index;
        const afterMatch = line.substring(matchIndex + match[0].length);
        const beforeMatch = line.substring(0, matchIndex);

        // Skip if this was already captured as a delete operation (support both req and request)
        if (/delete\s+(?:req|request)\.transaction\.\w*$/.test(beforeMatch) || /delete\s+$/.test(beforeMatch)) continue;

        // Handle mutation methods captured in property name
        let isMutationMethodCall = false;
        const methodMatch = property.match(mutationMethodsPattern);
        if (methodMatch && /^\s*\(/.test(afterMatch)) {
          isMutationMethodCall = true;
          property = property.substring(0, property.length - methodMatch[0].length);
        }

        // Determine if write operation
        const isSpreadRead = /\.\.\.\s*$/.test(beforeMatch);
        const isWrite = !isSpreadRead && (
          isMutationMethodCall ||
          /^\s*=(?!=)/.test(afterMatch) ||                    // direct assignment
          /^\s*\[[^\]]*\]\s*=(?!=)/.test(afterMatch) ||       // indexed assignment
          /^\s*\.\w+\s*=(?!=)/.test(afterMatch) ||            // property assignment
          /^\s*(\+\+|--|[+\-*/%]?=(?!=)|\*\*=)/.test(afterMatch) ||  // compound assignment
          /^\s*\[[^\]]*\]\s*(\+\+|--|[+\-*/%]?=(?!=)|\*\*=)/.test(afterMatch) ||  // indexed compound
          /^\s*\.(push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\s*\(/.test(afterMatch) ||  // array mutation
          /^\s*\.(set|add|delete|clear)\s*\(/.test(afterMatch) ||  // Map/Set mutation
          /Object\.assign\s*\(\s*$/.test(beforeMatch)         // Object.assign target
        );

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
          
          // Detect nested properties in object literal assignments
          if (/^\s*=(?!=)/.test(afterMatch)) {
            this.extractNestedPropertiesFromObjectLiteralForReqTransaction(lines, index, property, writes, sourcePath, isLibrary);
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
      
      // Pattern 2: Handle direct req.transaction usage (no child properties)
      // Skip logger calls like logger.info(..., req.transaction)
      reqTransactionDirectPattern.lastIndex = 0;
      while ((match = reqTransactionDirectPattern.exec(line)) !== null) {
        const matchIndex = match.index;
        const beforeMatch = line.substring(0, matchIndex);
        const afterMatch = line.substring(matchIndex + match[0].length);
        const codeSnippet = line.trim();
        
        // Skip if this is a logger call - check if beforeMatch contains logger.xxx( pattern
        if (loggerCallPattern.test(beforeMatch)) {
          continue;
        }
        
        // Also skip if it's passed as argument to any function and looks like logging context
        // e.g., someFunction(..., req.transaction) at end of call
        if (/,\s*$/.test(beforeMatch) && /^\s*\)/.test(afterMatch)) {
          // Check if it's a logger call by looking back further
          if (/logger\.\w+\s*\(/.test(line)) {
            continue;
          }
        }
        
        // Use special property name to indicate direct usage
        const property = '(direct)';
        const key = `${property}:${lineNumber}:${sourcePath}`;
        
        // Determine if write operation
        const isWrite = (
          /^\s*=(?!=)/.test(afterMatch) ||                    // direct assignment: req.transaction = {...}
          /Object\.assign\s*\(\s*$/.test(beforeMatch)         // Object.assign target
        );
        
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
   * Extract nested properties from object literal assignments for req.transaction
   */
  private extractNestedPropertiesFromObjectLiteralForReqTransaction(
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
          if (!started) {
            started = true;
          }
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
      if (started) {
        objectContent += '\n';
      }
    }
  }

  /**
   * Deduplicate res.locals/req.transaction usages
   * Keep one entry per property + sourcePath combination
   * This removes exact duplicates but preserves all unique source files
   */
  private deduplicateUsages(usages: ResLocalsUsage[]): ResLocalsUsage[] {
    const seen = new Map<string, ResLocalsUsage>();
    
    for (const u of usages) {
      // Key by property + sourcePath (same property in different files = different entries)
      const key = `${u.property}:${u.sourcePath}`;
      if (!seen.has(key)) {
        seen.set(key, u);
      }
    }
    
    return Array.from(seen.values());
  }

  private analyzeExternalCalls(lines: string[], results: ExternalCall[], sourcePath: string): void {
    // Check if this is a library file - we still analyze it but mark the results
    const isLibrary = this.isLibraryPath(sourcePath);
    
    // DEBUG: Log when analyzing geo-blocking or inHome-ms
    const isDebugTarget = sourcePath.includes('geo-blocking') || sourcePath.includes('inHome-ms');
    if (isDebugTarget) {
      console.log(`[FlowAnalyzer] DEBUG: Analyzing external calls in: ${sourcePath}`);
      console.log(`[FlowAnalyzer] DEBUG: isLibrary=${isLibrary}, lines=${lines.length}`);
    }

    // Patterns that capture meaningful template/endpoint names
    // Note: For multi-line calls, we use [\s\S]*? for non-greedy multi-line matching
    // Note: (?:\w+\.)? matches any prefix like 'wrapper.', 'avsRequest.', etc. or no prefix
    // IMPORTANT: Use [\s\S]*? instead of [^,]* to match across line breaks for multi-line function calls
    const patterns: { pattern: RegExp, type: ExternalCall['type'], extractName?: boolean }[] = [
      // DCQ patterns - capture template name (last string argument before closing paren)
      // Pattern matches: callAVSDCQTemplate(..., 'TemplateName') across multiple lines
      { pattern: /(?:\w+\.)?callAVSDCQTemplate\s*\([\s\S]*?['"](\w+)['"]\s*\)/g, type: 'dcq', extractName: true },
      { pattern: /(?:\w+\.)?callDCQ\s*\([\s\S]*?['"](\w+)['"][\s\S]*?\)/g, type: 'dcq', extractName: true },
      { pattern: /(?:\w+\.)?callAVSDCQSearch\s*\([\s\S]*?['"](\w+)['"][\s\S]*?\)/g, type: 'dcq', extractName: true },
      
      // AVS patterns - capture endpoint/action name based on method signature
      // Use comma-separated matching with [\s\S]*? for multi-line support
      // callAVS(req, res, apiType, method, action, ...) - action is 5th param
      { pattern: /(?:\w+\.)?callAVS\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'avs', extractName: true },
      // callAVSB2C(req, res, action, ...) - action is 3rd param
      { pattern: /(?:\w+\.)?callAVSB2C\s*\([\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'avs', extractName: true },
      // callAVSB2CWithFullResponse(req, res, action, ...) - action is 3rd param
      { pattern: /(?:\w+\.)?callAVSB2CWithFullResponse\s*\([\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'avs', extractName: true },
      // callAVSB2B(req, res, method, action, ...) - action is 4th param
      { pattern: /(?:\w+\.)?callAVSB2B\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'avs', extractName: true },
      // callAVSB2BWithFullResponse(req, res, method, action, ...) - action is 4th param
      { pattern: /(?:\w+\.)?callAVSB2BWithFullResponse\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'avs', extractName: true },
      // callAVSB2BVersioned(req, res, version, method, action, ...) - action is 5th param
      { pattern: /(?:\w+\.)?callAVSB2BVersioned\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'avs', extractName: true },
      // callAVSB2BVersionedWithFullResponse(req, res, version, method, action, ...) - action is 5th param
      { pattern: /(?:\w+\.)?callAVSB2BVersionedWithFullResponse\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'avs', extractName: true },
      
      // Pinboard patterns - callPinboard(req, res, method, restParams, ...) - no string name, detect the call
      { pattern: /(?:\w+\.)?callPinboard\s*\(/g, type: 'pinboard', extractName: false },
      
      // Elasticsearch patterns - capture template name based on method signature
      // callAVSESTemplate(req, res, templateName, ...) - templateName is 3rd param
      { pattern: /(?:\w+\.)?callAVSESTemplate\s*\([\s\S]*?,[\s\S]*?,\s*['"](\w+)['"]/g, type: 'elasticsearch', extractName: true },
      // callDcqDecoupledESTemplate(req, res, templateName, ...) - templateName is 3rd param
      { pattern: /(?:\w+\.)?callDcqDecoupledESTemplate\s*\([\s\S]*?,[\s\S]*?,\s*['"](\w+)['"]/g, type: 'elasticsearch', extractName: true },
      // callAVSESSearch(req, res, indexes, ...) - indexes is array, just detect the call
      { pattern: /(?:\w+\.)?callAVSESSearch\s*\(/g, type: 'elasticsearch', extractName: false },
      // callES(req, res, method, indexes, ...) - indexes is array, just detect the call
      { pattern: /(?:\w+\.)?callES\s*\(/g, type: 'elasticsearch', extractName: false },
      
      // External API patterns - callExternal(req, res, method, url, ...) - url is 4th param
      { pattern: /(?:\w+\.)?callExternal\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'external', extractName: true },
      // Also match when url is a variable
      { pattern: /(?:\w+\.)?callExternal\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,\s*(\w+)/g, type: 'external', extractName: true },
      
      // AVA patterns
      { pattern: /(?:\w+\.)?callAVA\s*\(/g, type: 'ava', extractName: false },
      
      // DSF patterns - callDsf(req, res, method, url, ...) - url is 4th param
      { pattern: /(?:\w+\.)?callDsf\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'dsf', extractName: true },
      { pattern: /(?:\w+\.)?callDsf\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,\s*(\w+)/g, type: 'dsf', extractName: true },
      
      // Microservice patterns - capture service name
      { pattern: /(?:\w+\.)?callAVSMicroservice\s*\([\s\S]*?,\s*['"]([^'"]+)['"]/g, type: 'microservice', extractName: true },
      
      // DCQ ES Mapper patterns - method name IS the endpoint name
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

    // Use Set for O(1) deduplication
    const seen = new Set<string>();
    results.forEach(e => seen.add(`${e.type}:${e.template || ''}:${e.lineNumber}:${e.sourcePath}`));

    // Join all lines for multi-line pattern matching
    const content = lines.join('\n');

    // DEBUG: For debug targets, test specific pattern
    if (isDebugTarget) {
      const testPattern = /(?:\w+\.)?callAVSB2BVersioned\s*\([\s\S]*?,[\s\S]*?,[\s\S]*?,[\s\S]*?,\s*['"]([^'"]+)['"]/g;
      console.log(`[FlowAnalyzer] DEBUG: Testing callAVSB2BVersioned pattern on content length: ${content.length}`);
      testPattern.lastIndex = 0;
      const testMatch = testPattern.exec(content);
      if (testMatch) {
        console.log(`[FlowAnalyzer] DEBUG: Found match: ${testMatch[0].substring(0, 100)}...`);
        console.log(`[FlowAnalyzer] DEBUG: Captured group: ${testMatch[1]}`);
      } else {
        console.log(`[FlowAnalyzer] DEBUG: No match found for callAVSB2BVersioned`);
        // Check if callAVSB2BVersioned exists at all
        if (content.includes('callAVSB2BVersioned')) {
          console.log(`[FlowAnalyzer] DEBUG: callAVSB2BVersioned text EXISTS in content`);
          // Find the line
          const lineIdx = lines.findIndex(l => l.includes('callAVSB2BVersioned'));
          if (lineIdx >= 0) {
            console.log(`[FlowAnalyzer] DEBUG: Found at line ${lineIdx + 1}: ${lines[lineIdx].trim().substring(0, 80)}`);
          }
        }
      }
    }

    // First pass: detect standard patterns (supports multi-line calls)
    for (const { pattern, type, extractName } of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        let template: string | undefined;
        
        // Calculate line number from match position
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
        
        if (extractName && match[1]) {
          // Extract template name from capture group
          template = match[1];
        } else if (!extractName) {
          // Extract method name from the pattern match for methods like callGetAggregatedContentDetail
          const methodMatch = match[0].match(/call(\w+)\s*\(/);
          if (methodMatch) {
            template = methodMatch[1];
          }
        }
        
        const key = `${type}:${template || ''}:${lineNumber}:${sourcePath}`;
        
        if (!seen.has(key)) {
          seen.add(key);
          // Get the line for code snippet
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
    
    // Second pass: detect HTTP client calls and extract meaningful names from context
    this.detectHttpCalls(lines, results, seen, sourcePath, isLibrary);
  }
  
  /**
   * Detect HTTP client calls and extract meaningful endpoint names from context
   * For library files, still detect the calls but mark them as isLibrary
   * This allows them to show in component details while being filtered in aggregated views
   */
  private detectHttpCalls(lines: string[], results: ExternalCall[], seen: Set<string>, sourcePath: string, isLibrary: boolean = false): void {
    const httpPatterns = [
      /aglUtils\.httpClient\s*\(/,
      /aglUtils\.forwardRequest\s*\(/,
      /aglUtils\.v2\.httpClient\s*\(/,
    ];
    
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      
      for (const pattern of httpPatterns) {
        if (pattern.test(line)) {
          // Try to extract meaningful endpoint name from surrounding context
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
              isLibrary  // Mark as library - will be filtered in deduplicateExternalCalls but visible in component details
            });
          }
          break; // Only count once per line
        }
      }
    });
  }
  
  /**
   * Extract meaningful HTTP endpoint name from code context
   * Looks for URL variables, config keys, or environment variables
   */
  private extractHttpEndpointName(lines: string[], currentIndex: number): string {
    // Look at surrounding lines (10 lines before and the current line)
    const startIndex = Math.max(0, currentIndex - 10);
    const contextLines = lines.slice(startIndex, currentIndex + 1);
    
    // Patterns to find meaningful names, ordered by priority
    const namePatterns = [
      // Environment variable: process.env.SCORES_MS_URL
      /process\.env\.([A-Z_]+URL[A-Z_]*)/,
      /process\.env\.([A-Z_]+SERVICE[A-Z_]*)/,
      /process\.env\.([A-Z_]+API[A-Z_]*)/,
      /process\.env\.([A-Z_]+ENDPOINT[A-Z_]*)/,
      /process\.env\.([A-Z][A-Z_]+)/,
      
      // URL variable assignment: const scoresMsURL = ...
      /(?:const|let|var)\s+(\w+(?:URL|Url|url))\s*=/,
      /(?:const|let|var)\s+(\w+(?:Endpoint|endpoint))\s*=/,
      /(?:const|let|var)\s+(\w+(?:Service|service))\s*=/,
      
      // Config key: getMWareConfig('scores_enrichment')
      /getMWareConfig\s*\(\s*['"](\w+)['"]/,
      
      // URL in object: url: scoresMsURLFinal
      /url:\s*(\w+(?:URL|Url|url)\w*)/,
      /url:\s*['"]([^'"]+)['"]/,
    ];
    
    // Search context lines for meaningful names
    for (const contextLine of contextLines.reverse()) { // Search from closest to furthest
      for (const pattern of namePatterns) {
        const match = contextLine.match(pattern);
        if (match && match[1]) {
          return match[1];
        }
      }
    }
    
    return 'httpClient'; // Default fallback
  }

  private analyzeConfigDeps(lines: string[], results: ConfigDependency[]): void {
    const patterns = [
      { pattern: /appCache\.getMWareConfig\s*\(\s*['"](\w+)['"]/g, source: 'mWareConfig' as const },
      { pattern: /appCache\.getAppConfig\s*\(\s*['"]?(\w+)?['"]?\s*\)/g, source: 'appConfig' as const },
      { pattern: /appCache\.getSysParameter\s*\(\s*['"](\w+)['"]/g, source: 'sysParameter' as const },
      { pattern: /appCache\.get\s*\(\s*['"](\w+)['"]/g, source: 'appCache' as const },
    ];

    // Use Set for O(1) deduplication
    const seen = new Set<string>();
    results.forEach(d => seen.add(`${d.source}:${d.key}`));

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

  private findFunctionLocations(lines: string[], result: MiddlewareAnalysis): void {
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      if (/(?:module\.exports\.run|exports\.run|const run|function run)\s*=?\s*(?:\(|async)/.test(line)) {
        result.runFunctionLine = lineNumber;
      }
      if (/(?:module\.exports\.panic|exports\.panic)\s*=/.test(line)) {
        result.panicFunctionLine = lineNumber;
      }
    });
  }

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
