import * as acorn from 'acorn';
import { walk } from 'estree-walker';
import * as fs from 'fs';
import * as path from 'path';
import { ComponentAnalysis, RequireInfo } from '../models/flow-analyzer-types';
import { normalizePath, isLibraryPath as sharedIsLibraryPath } from '../shared';
import { AstUtils, Node } from './ast-utils';
import { ConfigDependencyAnalyzer } from './config-dependency-analyzer';
import { DataUsageAnalyzer } from './data-usage-analyzer';
import { ExternalCallAnalyzer } from './external-call-analyzer';
import { PathResolver } from './path-resolver';

/**
 * Cache entry for component analysis results
 */
interface CacheEntry {
  result: ComponentAnalysis;
  fileHash: string;
  timestamp: number;
}

/**
 * ComponentAnalyzer - Orchestrates component analysis using specialized analyzers
 * 
 * This class follows the Single Responsibility Principle by delegating
 * specific analysis tasks to specialized analyzer classes:
 * - ExternalCallAnalyzer: Handles external API calls (wrapper, httpClient)
 * - DataUsageAnalyzer: Handles res.locals, req.transaction, req.query, etc.
 * - ConfigDependencyAnalyzer: Handles appCache dependencies
 * - PathResolver: Handles module path resolution
 */
export class ComponentAnalyzer {
  private cache = new Map<string, CacheEntry>();
  private analysisStack = new Set<string>();
  private readonly MAX_DEPTH = 10;

  // Specialized analyzers
  private pathResolver: PathResolver;
  private externalCallAnalyzer: ExternalCallAnalyzer;
  private dataUsageAnalyzer: DataUsageAnalyzer;
  private configDependencyAnalyzer: ConfigDependencyAnalyzer;

  constructor(
    private workspaceFolder: string,
    private middlewareName: string
  ) {
    this.pathResolver = new PathResolver(workspaceFolder, middlewareName);
    this.externalCallAnalyzer = new ExternalCallAnalyzer();
    this.dataUsageAnalyzer = new DataUsageAnalyzer();
    this.configDependencyAnalyzer = new ConfigDependencyAnalyzer();
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
   */
  public analyze(filePath: string, depth: number = 0, parentPath?: string): ComponentAnalysis | null {
    const normalizedPath = normalizePath(filePath);
    
    if (!fs.existsSync(normalizedPath)) {
      return null;
    }

    if (this.analysisStack.has(normalizedPath)) {
      return this.createShallowReference(normalizedPath, depth, parentPath);
    }

    const cached = this.cache.get(normalizedPath);
    if (cached) {
      const stats = fs.statSync(normalizedPath);
      const currentHash = stats.mtimeMs.toString();
      
      if (cached.fileHash === currentHash) {
        return this.createCachedReference(cached.result, depth, parentPath);
      }
    }

    if (depth >= this.MAX_DEPTH) {
      return this.createShallowReference(normalizedPath, depth, parentPath);
    }

    this.analysisStack.add(normalizedPath);

    try {
      const result = this.analyzeFile(normalizedPath, depth, parentPath);
      
      if (result) {
        const stats = fs.statSync(normalizedPath);
        this.cache.set(normalizedPath, {
          result,
          fileHash: stats.mtimeMs.toString(),
          timestamp: Date.now()
        });
      }

      return result;
    } finally {
      this.analysisStack.delete(normalizedPath);
    }
  }

  /**
   * Analyze a middleware entry point
   */
  public analyzeMiddlewareEntry(middlewarePath: string): ComponentAnalysis | null {
    const middlewareRoot = this.pathResolver.getMiddlewareRoot();
    let fullPath = path.join(middlewareRoot, `${middlewarePath}.js`);
    if (!fs.existsSync(fullPath)) {
      fullPath = path.join(middlewareRoot, `${middlewarePath}/index.js`);
    }

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    return this.analyze(fullPath, 0);
  }

  /**
   * Perform full analysis of a component file using AST
   */
  private analyzeFile(filePath: string, depth: number, parentPath?: string): ComponentAnalysis | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      
      let ast: Node;
      try {
        ast = acorn.parse(content, {
          ecmaVersion: 'latest',
          sourceType: 'script',
          locations: true,
          allowHashBang: true,
          allowReturnOutsideFunction: true
        }) as Node;
      } catch (parseError) {
        console.error(`Parse error in ${filePath}:`, parseError);
        return null;
      }

      const component: ComponentAnalysis = {
        name: this.pathResolver.getModuleName(filePath),
        displayName: this.pathResolver.getDisplayName(filePath),
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

      const isLibrary = sharedIsLibraryPath(filePath);

      // Reset analyzers for new file
      this.externalCallAnalyzer.reset();
      this.dataUsageAnalyzer.reset();
      this.configDependencyAnalyzer.reset();

      // Analyze AST
      this.analyzeAST(ast, component, lines, filePath, isLibrary);

      // Recursively analyze child components
      component.children = this.analyzeChildComponents(component.requires, filePath, depth + 1);

      return component;
    } catch (error) {
      console.error(`Error analyzing component ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Main AST analysis entry point using estree-walker
   */
  private analyzeAST(
    ast: Node,
    component: ComponentAnalysis,
    lines: string[],
    sourcePath: string,
    isLibrary: boolean
  ): void {
    const seenRequires = new Set<string>();
    const ancestors: Node[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    walk(ast as any, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      enter: (n: any) => {
        const node = n as Node;
        const lineNumber = AstUtils.getLineNumber(node);
        const codeSnippet = AstUtils.getCodeSnippet(lines, lineNumber);

        switch (node.type) {
          case 'CallExpression':
            this.handleCallExpression(node, ancestors, lineNumber, codeSnippet, component, seenRequires, sourcePath, isLibrary);
            break;

          case 'MemberExpression':
            this.dataUsageAnalyzer.analyzeMemberExpression(node, ancestors, lineNumber, codeSnippet, component, sourcePath, isLibrary);
            break;

          case 'UnaryExpression':
            if (node.operator === 'delete' && node.argument?.type === 'MemberExpression') {
              this.dataUsageAnalyzer.analyzeDeleteExpression(node, lineNumber, codeSnippet, component, sourcePath, isLibrary);
            }
            break;

          case 'AssignmentExpression':
            this.analyzeExports(node, lineNumber, component);
            break;

          case 'VariableDeclarator':
            this.externalCallAnalyzer.trackWrapperMethodAssignment(node);
            break;
        }

        ancestors.push(node);
      },
      leave: () => {
        ancestors.pop();
      }
    });
  }

  /**
   * Handle CallExpression nodes
   */
  private handleCallExpression(
    node: Node,
    ancestors: Node[],
    lineNumber: number,
    codeSnippet: string,
    component: ComponentAnalysis,
    seenRequires: Set<string>,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    // Check for require()
    if (node.callee?.type === 'Identifier' && node.callee.name === 'require') {
      const arg = node.arguments?.[0];
      if (arg?.type === 'Literal' && typeof arg.value === 'string') {
        const modulePath = arg.value;
        this.handleRequire(modulePath, lineNumber, ancestors, component, seenRequires, sourcePath);
        
        // Detect and register wrapper type
        const wrapperType = this.externalCallAnalyzer.detectWrapperType(modulePath);
        if (wrapperType) {
          this.externalCallAnalyzer.registerWrapperImports(ancestors, wrapperType);
        }
      }
    }

    // Delegate to specialized analyzers
    this.externalCallAnalyzer.analyze(node, ancestors, lineNumber, codeSnippet, component, sourcePath, isLibrary);
    this.configDependencyAnalyzer.analyze(node, lineNumber, codeSnippet, component);
    this.dataUsageAnalyzer.analyzeResponseMethods(node, lineNumber, codeSnippet, component, sourcePath, isLibrary);
    this.dataUsageAnalyzer.analyzeRequestHeaderMethod(node, lineNumber, codeSnippet, component, sourcePath, isLibrary);
  }

  /**
   * Handle require statements
   */
  private handleRequire(
    modulePath: string,
    lineNumber: number,
    ancestors: Node[],
    component: ComponentAnalysis,
    seen: Set<string>,
    currentFilePath: string
  ): void {
    if (seen.has(modulePath)) return;
    seen.add(modulePath);

    // Find variable name from ancestors
    let variableName = '';
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancestor = ancestors[i];
      if (ancestor.type === 'VariableDeclarator' && ancestor.id) {
        if (ancestor.id.type === 'Identifier') {
          variableName = ancestor.id.name ?? '';
        } else if (ancestor.id.type === 'ObjectPattern' && ancestor.id.properties) {
          variableName = ancestor.id.properties
            .map((p: Node) => AstUtils.getPropertyName(p.key))
            .filter(Boolean)
            .join(', ');
        }
        break;
      }
    }

    const isLocal = modulePath.startsWith('./') || modulePath.startsWith('../');
    const isAglModule = modulePath.startsWith('@opus/agl-');
    const resolvedPath = this.pathResolver.resolvePath(modulePath, currentFilePath);

    component.requires.push({
      modulePath,
      variableName,
      resolvedPath,
      lineNumber,
      isLocal,
      isAglModule
    });
  }

  /**
   * Analyze export statements
   */
  private analyzeExports(node: Node, lineNumber: number, component: ComponentAnalysis): void {
    const left = node.left;
    if (left?.type !== 'MemberExpression') return;

    // module.exports.xxx = ...
    if (AstUtils.matchesMemberExpression(left.object, ['module', 'exports'])) {
      const funcName = AstUtils.getPropertyName(left.property);
      if (funcName) {
        component.exportedFunctions.push(funcName);
        if (funcName === 'execute' || funcName === 'run') {
          component.mainFunctionLine = lineNumber;
        }
      }
    }

    // exports.xxx = ...
    if (left.object?.type === 'Identifier' && left.object.name === 'exports') {
      const funcName = AstUtils.getPropertyName(left.property);
      if (funcName) {
        component.exportedFunctions.push(funcName);
      }
    }

    // module.exports = { ... }
    if (AstUtils.matchesMemberExpression(left, ['module', 'exports'])) {
      const right = node.right;
      if (right?.type === 'ObjectExpression' && right.properties) {
        for (const prop of right.properties) {
          const name = AstUtils.getPropertyName(prop.key);
          if (name) {
            component.exportedFunctions.push(name);
          }
        }
      }
    }
  }

  // Helper methods for shallow/cached references

  private createShallowReference(filePath: string, depth: number, parentPath?: string): ComponentAnalysis {
    return {
      name: this.pathResolver.getModuleName(filePath),
      displayName: this.pathResolver.getDisplayName(filePath),
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

  private createCachedReference(cached: ComponentAnalysis, depth: number, parentPath?: string): ComponentAnalysis {
    return {
      ...cached,
      depth,
      parentPath,
      isShallowReference: true
    };
  }

  private analyzeChildComponents(requires: RequireInfo[], parentPath: string, depth: number): ComponentAnalysis[] {
    const children: ComponentAnalysis[] = [];

    for (const req of requires) {
      if (!req.resolvedPath) continue;
      if (!req.isLocal && !req.isAglModule) continue;

      const child = this.analyze(req.resolvedPath, depth, parentPath);
      if (child) {
        children.push(child);
      }
    }

    return children;
  }
}
