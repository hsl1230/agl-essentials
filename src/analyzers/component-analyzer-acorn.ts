import * as acorn from 'acorn';
import { walk } from 'estree-walker';
import * as fs from 'fs';
import * as path from 'path';
import {
  ComponentAnalysis,
  ConfigDependency,
  DataSourceType,
  RequireInfo
} from '../models/flow-analyzer-types';
import { normalizePath, isLibraryPath as sharedIsLibraryPath } from '../shared';

// ESTree node types (acorn uses ESTree format)
type Node = acorn.Node & {
  type: string;
  name?: string;
  object?: Node;
  property?: Node;
  callee?: Node;
  arguments?: Node[];
  left?: Node;
  right?: Node;
  operator?: string;
  argument?: Node;
  declarations?: Node[];
  init?: Node;
  id?: Node;
  value?: unknown;
  properties?: Node[];
  key?: Node;
  computed?: boolean;
  expression?: Node;
  body?: Node | Node[];
  consequent?: Node;
  alternate?: Node;
};

/**
 * External call type derived from require path
 */
type ExternalCallType = 'dcq' | 'avs' | 'ava' | 'dsf' | 'elasticsearch' | 'external' | 'pinboard' | 'microservice' | 'http' | 'cache';

/**
 * Regex to extract wrapper type from require path
 * Matches: /wrapper/request/dcq, /wrapper/request/avs.js, etc.
 */
const WRAPPER_PATH_PATTERN = /\/wrapper\/request\/(\w+)(?:\.js)?$/;

/**
 * Map short names to canonical type names
 */
const WRAPPER_TYPE_ALIASES: Record<string, ExternalCallType> = {
  'es': 'elasticsearch'
};

/**
 * Array mutation methods used for detecting writes
 */
const MUTATION_METHODS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin',
  'set', 'add', 'delete', 'clear'
]);

/**
 * Native JavaScript methods/properties to skip when analyzing data usage
 */
const NATIVE_METHODS_AND_PROPS = new Set([
  'length', 'indexOf', 'find', 'findIndex', 'filter', 'map', 'reduce', 'reduceRight',
  'forEach', 'some', 'every', 'includes', 'slice', 'concat', 'join', 'flat', 'flatMap',
  'keys', 'values', 'entries', 'at', 'toString', 'toLocaleString', 'constructor',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'valueOf'
]);

/**
 * Cache entry for component analysis results
 */
interface CacheEntry {
  result: ComponentAnalysis;
  fileHash: string;
  timestamp: number;
}

/**
 * Context for tracking write operations during AST traversal
 */
interface WriteContext {
  isAssignmentTarget: boolean;
  isDeleteTarget: boolean;
  isMutationCall: boolean;
  isObjectAssignTarget: boolean;
}

/**
 * ComponentAnalyzerAcorn - AST-based analyzer using acorn
 * 
 * This implementation uses acorn to parse JavaScript files into AST,
 * providing more accurate analysis than regex-based approaches,
 * especially for:
 * - Cross-line expressions
 * - Nested object access
 * - Complex assignment patterns
 * 
 * The external interface matches ComponentAnalyzer exactly.
 */
export class ComponentAnalyzer {
  private cache = new Map<string, CacheEntry>();
  private analysisStack = new Set<string>();
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

      const isLibrary = this.isLibraryPath(filePath);

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
    const seen = {
      resLocalsWrites: new Set<string>(),
      resLocalsReads: new Set<string>(),
      reqTransactionWrites: new Set<string>(),
      reqTransactionReads: new Set<string>(),
      dataUsages: new Set<string>(),
      externalCalls: new Set<string>(),
      configDeps: new Set<string>(),
      requires: new Set<string>()
    };

    // Map: variable name -> external call type (inferred from require path)
    const wrapperImports = new Map<string, ExternalCallType>();

    const ancestors: Node[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    walk(ast as any, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      enter: (n: any) => {
        const node = n as Node;
        const lineNumber = this.getLineNumber(node);
        const codeSnippet = this.getCodeSnippet(lines, lineNumber);

        switch (node.type) {
          case 'CallExpression':
            this.handleCallExpression(node, ancestors, lineNumber, codeSnippet, component, seen, wrapperImports, sourcePath, isLibrary);
            break;

          case 'MemberExpression':
            this.handleMemberExpression(node, ancestors, lineNumber, codeSnippet, component, seen, sourcePath, isLibrary);
            break;

          case 'UnaryExpression':
            if (node.operator === 'delete' && node.argument?.type === 'MemberExpression') {
              this.handleDeleteExpression(node, lineNumber, codeSnippet, component, seen, sourcePath, isLibrary);
            }
            break;

          case 'AssignmentExpression':
            this.analyzeExports(node, lineNumber, component);
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
   * Find all enclosing scopes from ancestors (function scopes + global)
   * Returns scopes from innermost to outermost (global is last)
   */
  private findEnclosingScopes(ancestors: Node[]): Node[] {
    const scopes: Node[] = [];
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const node = ancestors[i];
      if (node.type === 'FunctionDeclaration' || 
          node.type === 'FunctionExpression' || 
          node.type === 'ArrowFunctionExpression' ||
          node.type === 'Program') {
        scopes.push(node);
      }
    }
    return scopes;
  }

  /**
   * Resolve variable value by searching from current scope up to global scope
   * @param variableName - The variable name to resolve
   * @param ancestors - The ancestor chain to find scopes
   * @returns Possible string values joined by ' | ', or undefined if not found
   */
  private resolveVariableInScope(variableName: string, ancestors: Node[]): string | undefined {
    const scopes = this.findEnclosingScopes(ancestors);
    
    for (const scopeNode of scopes) {
      const values = this.findVariableInScope(variableName, scopeNode);
      if (values.length > 0) {
        return values.join(' | ');
      }
    }
    
    return undefined;
  }

  /**
   * Search for variable declaration within a specific scope
   */
  private findVariableInScope(variableName: string, scopeNode: Node): string[] {
    const values: string[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    walk(scopeNode as any, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      enter: (n: any, parent: any) => {
        const node = n as Node;
        const parentNode = parent as Node | undefined;
        
        // Skip nested function scopes (they have their own scope)
        if (parentNode && 
            (node.type === 'FunctionDeclaration' || 
             node.type === 'FunctionExpression' || 
             node.type === 'ArrowFunctionExpression') &&
            node !== scopeNode) {
          return false; // Skip this subtree
        }

        if (node.type === 'VariableDeclarator' && 
            node.id?.type === 'Identifier' && 
            node.id.name === variableName && 
            node.init) {
          values.push(...this.extractPossibleStringValues(node.init));
        }
      }
    });

    return values;
  }

  /**
   * Extract possible string values from an expression
   * Handles: Literal, ConditionalExpression, LogicalExpression
   */
  private extractPossibleStringValues(node: Node): string[] {
    const values: string[] = [];
    
    switch (node.type) {
      case 'Literal':
        if (typeof node.value === 'string') {
          values.push(node.value);
        }
        break;
      
      case 'ConditionalExpression':
        // condition ? consequent : alternate
        if (node.consequent) {
          values.push(...this.extractPossibleStringValues(node.consequent));
        }
        if (node.alternate) {
          values.push(...this.extractPossibleStringValues(node.alternate));
        }
        break;
      
      case 'LogicalExpression':
        // left || right or left && right
        if (node.left) {
          values.push(...this.extractPossibleStringValues(node.left));
        }
        if (node.right) {
          values.push(...this.extractPossibleStringValues(node.right));
        }
        break;
    }
    
    return values;
  }

  /** Handle CallExpression nodes */
  private handleCallExpression(
    node: Node,
    ancestors: Node[],
    lineNumber: number,
    codeSnippet: string,
    component: ComponentAnalysis,
    seen: { requires: Set<string>; externalCalls: Set<string>; configDeps: Set<string>; dataUsages: Set<string> },
    wrapperImports: Map<string, ExternalCallType>,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    // Check for require()
    if (node.callee?.type === 'Identifier' && node.callee.name === 'require') {
      const arg = node.arguments?.[0];
      if (arg?.type === 'Literal' && typeof arg.value === 'string') {
        const modulePath = arg.value;
        this.handleRequire(modulePath, lineNumber, ancestors, component, seen.requires, sourcePath);
        
        // Detect wrapper type from require path and register it
        const wrapperType = this.detectWrapperType(modulePath);
        if (wrapperType) {
          // Register all variable names (handles both simple and destructured imports)
          this.registerWrapperImports(ancestors, wrapperType, wrapperImports);
        }
      }
    }

    this.analyzeExternalCall(node, ancestors, lineNumber, codeSnippet, component, seen.externalCalls, wrapperImports, sourcePath, isLibrary);
    this.analyzeConfigDep(node, lineNumber, codeSnippet, component, seen.configDeps);
    this.analyzeResponseMethods(node, lineNumber, codeSnippet, component, seen.dataUsages, sourcePath, isLibrary);
    this.analyzeRequestHeaderMethod(node, lineNumber, codeSnippet, component, seen.dataUsages, sourcePath, isLibrary);
  }

  /** Detect wrapper type from require path */
  private detectWrapperType(modulePath: string): ExternalCallType | null {
    // Check for agl-utils (httpClient)
    if (/@opus\/agl-utils/.test(modulePath)) {
      return 'http';
    }
    
    // Extract type from /wrapper/request/xxx pattern
    const match = WRAPPER_PATH_PATTERN.exec(modulePath);
    if (match) {
      const rawType = match[1];
      // Apply alias mapping (e.g., 'es' -> 'elasticsearch')
      return WRAPPER_TYPE_ALIASES[rawType] || rawType as ExternalCallType;
    }
    
    return null;
  }

  /**
   * Register wrapper imports for both simple and destructured patterns
   * - Simple: const wrapper = require('./dcq') -> wrapper: dcq
   * - Destructured: const { callX, callY } = require('./dcq') -> callX: dcq, callY: dcq
   */
  private registerWrapperImports(
    ancestors: Node[],
    wrapperType: ExternalCallType,
    wrapperImports: Map<string, ExternalCallType>
  ): void {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancestor = ancestors[i];
      if (ancestor.type === 'VariableDeclarator' && ancestor.id) {
        // Simple: const wrapper = require(...)
        if (ancestor.id.type === 'Identifier' && ancestor.id.name) {
          wrapperImports.set(ancestor.id.name, wrapperType);
        }
        // Destructured: const { callX, callY } = require(...)
        else if (ancestor.id.type === 'ObjectPattern' && ancestor.id.properties) {
          for (const prop of ancestor.id.properties) {
            // Get the local variable name (value for renamed, key otherwise)
            const propNode = prop as { key?: Node; value?: Node };
            const localName = this.getPropertyName(propNode.value) || this.getPropertyName(propNode.key);
            if (localName) {
              wrapperImports.set(localName, wrapperType);
            }
          }
        }
        break;
      }
    }
  }

  /** Handle MemberExpression nodes */
  private handleMemberExpression(
    node: Node,
    ancestors: Node[],
    lineNumber: number,
    codeSnippet: string,
    component: ComponentAnalysis,
    seen: { resLocalsReads: Set<string>; resLocalsWrites: Set<string>; reqTransactionReads: Set<string>; reqTransactionWrites: Set<string>; dataUsages: Set<string> },
    sourcePath: string,
    isLibrary: boolean
  ): void {
    // Skip if this node is the object of a parent MemberExpression
    // e.g., for req.transaction.avsToken, skip the inner req.transaction node
    const parent = ancestors[ancestors.length - 1];
    if (parent?.type === 'MemberExpression' && parent.object === node) {
      return;
    }

    const writeContext = this.getWriteContext(node, ancestors);
    this.analyzeResLocals(node, lineNumber, codeSnippet, writeContext, component, seen.resLocalsReads, seen.resLocalsWrites, sourcePath, isLibrary);
    this.analyzeReqTransaction(node, lineNumber, codeSnippet, writeContext, component, seen.reqTransactionReads, seen.reqTransactionWrites, sourcePath, isLibrary);
    this.analyzeDataUsage(node, lineNumber, codeSnippet, writeContext, component, seen.dataUsages, sourcePath, isLibrary);
  }

  /** Handle delete expressions */
  private handleDeleteExpression(
    node: Node,
    lineNumber: number,
    codeSnippet: string,
    component: ComponentAnalysis,
    seen: { resLocalsWrites: Set<string>; reqTransactionWrites: Set<string> },
    sourcePath: string,
    isLibrary: boolean
  ): void {
    const arg = node.argument!;

    // res.locals delete
    const resLocalsPath = this.extractPropertyPath(arg, 'res', 'locals') || this.extractPropertyPath(arg, 'response', 'locals');
    if (resLocalsPath) {
      const key = `${resLocalsPath}:${lineNumber}:${sourcePath}`;
      if (!seen.resLocalsWrites.has(key)) {
        seen.resLocalsWrites.add(key);
        component.resLocalsWrites.push({ property: resLocalsPath, type: 'write', lineNumber, codeSnippet, fullPath: resLocalsPath, sourcePath, isLibrary });
      }
    }

    // req.transaction delete
    const reqTransPath = this.extractPropertyPath(arg, 'req', 'transaction') || this.extractPropertyPath(arg, 'request', 'transaction');
    if (reqTransPath) {
      const key = `${reqTransPath}:${lineNumber}:${sourcePath}`;
      if (!seen.reqTransactionWrites.has(key)) {
        seen.reqTransactionWrites.add(key);
        component.reqTransactionWrites.push({ property: reqTransPath, type: 'write', lineNumber, codeSnippet, fullPath: reqTransPath, sourcePath, isLibrary });
      }
    }
  }

  /**
   * Determine if a node is in a write context
   */
  private getWriteContext(node: Node, ancestors: Node[]): WriteContext {
    const context: WriteContext = {
      isAssignmentTarget: false,
      isDeleteTarget: false,
      isMutationCall: false,
      isObjectAssignTarget: false
    };

    // Check ancestors for write patterns
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancestor = ancestors[i];

      // Assignment target
      if (ancestor.type === 'AssignmentExpression' && ancestor.left === ancestors[i + 1]) {
        context.isAssignmentTarget = true;
        break;
      }

      // Update expression (++, --)
      if (ancestor.type === 'UpdateExpression') {
        context.isAssignmentTarget = true;
        break;
      }

      // Delete expression
      if (ancestor.type === 'UnaryExpression' && ancestor.operator === 'delete') {
        context.isDeleteTarget = true;
        break;
      }

      // Mutation method call (push, pop, etc.)
      if (ancestor.type === 'CallExpression' && ancestor.callee?.type === 'MemberExpression') {
        const methodName = this.getPropertyName(ancestor.callee.property);
        if (methodName && MUTATION_METHODS.has(methodName)) {
          // Check if our node is the object being mutated
          if (this.isDescendantOf(node, ancestor.callee.object)) {
            context.isMutationCall = true;
            break;
          }
        }
      }

      // Object.assign target
      if (ancestor.type === 'CallExpression') {
        const callee = ancestor.callee;
        if (callee?.type === 'MemberExpression' &&
            this.getPropertyName(callee.object) === 'Object' &&
            this.getPropertyName(callee.property) === 'assign') {
          const firstArg = ancestor.arguments?.[0];
          if (firstArg && this.isDescendantOf(node, firstArg)) {
            context.isObjectAssignTarget = true;
            break;
          }
        }
      }
    }

    return context;
  }

  /**
   * Check if a node is a descendant of another node
   */
  private isDescendantOf(node: Node, potentialAncestor: Node | undefined): boolean {
    if (!potentialAncestor) return false;
    if (node === potentialAncestor) return true;
    
    // Simple check - compare positions
    const nodeStart = (node as acorn.Node).start;
    const nodeEnd = (node as acorn.Node).end;
    const ancestorStart = (potentialAncestor as acorn.Node).start;
    const ancestorEnd = (potentialAncestor as acorn.Node).end;
    
    return nodeStart >= ancestorStart && nodeEnd <= ancestorEnd;
  }

  /**
   * Check if node is a write operation based on context
   */
  private isWriteOperation(writeContext: WriteContext): boolean {
    return writeContext.isAssignmentTarget || writeContext.isDeleteTarget || 
           writeContext.isMutationCall || writeContext.isObjectAssignTarget;
  }

  /**
   * Generic method to analyze object property access (res.locals, req.transaction, etc.)
   */
  private analyzePropertyAccess(
    node: Node,
    lineNumber: number,
    codeSnippet: string,
    writeContext: WriteContext,
    prefixes: [string, string][],
    readsArray: ComponentAnalysis['resLocalsReads'],
    writesArray: ComponentAnalysis['resLocalsWrites'],
    seenReads: Set<string>,
    seenWrites: Set<string>,
    sourcePath: string,
    isLibrary: boolean,
    checkDirectAccess: boolean = false
  ): void {
    let property: string | null = null;
    
    for (const [obj, prop] of prefixes) {
      property = this.extractPropertyPath(node, obj, prop);
      if (property) break;
    }

    // Check for direct access (e.g., req.transaction without property)
    if (!property && checkDirectAccess) {
      for (const [obj, prop] of prefixes) {
        if (this.matchesMemberExpression(node, [obj, prop])) {
          property = '(direct)';
          break;
        }
      }
    }

    if (!property) return;

    // Clean property path for res.locals (remove native methods)
    if (!checkDirectAccess) {
      property = this.cleanPropertyPath(property);
      if (!property) return;
    }

    const isWrite = this.isWriteOperation(writeContext);
    const key = `${property}:${lineNumber}:${sourcePath}`;
    const type: 'write' | 'read' = isWrite ? 'write' : 'read';
    const entry = { property, type, lineNumber, codeSnippet, fullPath: property, sourcePath, isLibrary };

    if (isWrite) {
      if (!seenWrites.has(key)) {
        seenWrites.add(key);
        writesArray.push(entry);
      }
    } else {
      if (!seenReads.has(key)) {
        seenReads.add(key);
        readsArray.push(entry);
      }
    }
  }

  /**
   * Analyze res.locals access
   */
  private analyzeResLocals(
    node: Node,
    lineNumber: number,
    codeSnippet: string,
    writeContext: WriteContext,
    component: ComponentAnalysis,
    seenReads: Set<string>,
    seenWrites: Set<string>,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    this.analyzePropertyAccess(
      node, lineNumber, codeSnippet, writeContext,
      [['res', 'locals'], ['response', 'locals']],
      component.resLocalsReads, component.resLocalsWrites,
      seenReads, seenWrites, sourcePath, isLibrary, false
    );
  }

  /**
   * Analyze req.transaction access
   */
  private analyzeReqTransaction(
    node: Node,
    lineNumber: number,
    codeSnippet: string,
    writeContext: WriteContext,
    component: ComponentAnalysis,
    seenReads: Set<string>,
    seenWrites: Set<string>,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    this.analyzePropertyAccess(
      node, lineNumber, codeSnippet, writeContext,
      [['req', 'transaction'], ['request', 'transaction']],
      component.reqTransactionReads, component.reqTransactionWrites,
      seenReads, seenWrites, sourcePath, isLibrary, true
    );
  }

  /**
   * Analyze data usage (req.query, req.body, etc.)
   */
  private analyzeDataUsage(
    node: Node,
    lineNumber: number,
    codeSnippet: string,
    writeContext: WriteContext,
    component: ComponentAnalysis,
    seen: Set<string>,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    const dataTypes: [string, string, DataSourceType][] = [
      ['req', 'query', 'req.query'], ['request', 'query', 'req.query'],
      ['req', 'body', 'req.body'], ['request', 'body', 'req.body'],
      ['req', 'params', 'req.params'], ['request', 'params', 'req.params'],
      ['req', 'headers', 'req.headers'], ['request', 'headers', 'req.headers'],
      ['req', 'cookies', 'req.cookies'], ['request', 'cookies', 'req.cookies'],
    ];

    for (const [obj, prop, sourceType] of dataTypes) {
      const property = this.extractPropertyPath(node, obj, prop);
      if (property) {
        const usageType: 'write' | 'read' = this.isWriteOperation(writeContext) ? 'write' : 'read';
        const key = `${sourceType}:${property}:${lineNumber}:${usageType}`;
        if (!seen.has(key)) {
          seen.add(key);
          component.dataUsages.push({ sourceType, property, type: usageType, lineNumber, codeSnippet, fullPath: property, sourcePath, isLibrary });
        }
        return;
      }
    }
  }

  /**
   * Analyze response methods (res.cookie, res.setHeader, etc.)
   */
  private analyzeResponseMethods(
    node: Node,
    lineNumber: number,
    codeSnippet: string,
    component: ComponentAnalysis,
    seen: Set<string>,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    const callee = node.callee;
    if (callee?.type !== 'MemberExpression') return;

    const objectName = this.getPropertyName(callee.object);
    if (objectName !== 'res' && objectName !== 'response') return;

    const methodName = this.getPropertyName(callee.property);
    const firstArg = node.arguments?.[0];
    
    if (!methodName || !firstArg || firstArg.type !== 'Literal' || typeof firstArg.value !== 'string') return;

    const property = firstArg.value;
    let sourceType: DataSourceType | null = null;

    if (methodName === 'cookie') {
      sourceType = 'res.cookie';
    } else if (methodName === 'setHeader' || methodName === 'set' || methodName === 'header') {
      sourceType = 'res.header';
    }

    if (sourceType) {
      const key = `${sourceType}:${property}:${lineNumber}:write`;
      if (!seen.has(key)) {
        seen.add(key);
        component.dataUsages.push({
          sourceType,
          property,
          type: 'write',
          lineNumber,
          codeSnippet,
          fullPath: property,
          sourcePath,
          isLibrary
        });
      }
    }
  }

  /**
   * Analyze request header method (req.header())
   */
  private analyzeRequestHeaderMethod(
    node: Node,
    lineNumber: number,
    codeSnippet: string,
    component: ComponentAnalysis,
    seen: Set<string>,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    const callee = node.callee;
    if (callee?.type !== 'MemberExpression') return;

    const objectName = this.getPropertyName(callee.object);
    if (objectName !== 'req' && objectName !== 'request') return;

    const methodName = this.getPropertyName(callee.property);
    if (methodName !== 'header') return;

    const firstArg = node.arguments?.[0];
    if (!firstArg || firstArg.type !== 'Literal' || typeof firstArg.value !== 'string') return;

    const property = firstArg.value;
    const key = `req.headers:${property}:${lineNumber}:read`;

    if (!seen.has(key)) {
      seen.add(key);
      component.dataUsages.push({
        sourceType: 'req.headers',
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

  /**
   * Analyze external calls (callAVS, callDCQ, etc.)
   * Uses wrapperImports to infer type from require paths when possible
   */
  private analyzeExternalCall(
    node: Node,
    ancestors: Node[],
    lineNumber: number,
    codeSnippet: string,
    component: ComponentAnalysis,
    seen: Set<string>,
    wrapperImports: Map<string, ExternalCallType>,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    const callee = node.callee;
    let methodName: string | null = null;
    let objectName: string | null = null;

    if (callee?.type === 'Identifier') {
      methodName = callee.name ?? null;
    } else if (callee?.type === 'MemberExpression') {
      methodName = this.getPropertyName(callee.property) ?? null;
      objectName = this.getPropertyName(callee.object) ?? null;
    }

    if (!methodName) return;

    // Check for httpClient/forwardRequest calls
    if (methodName === 'httpClient' || methodName === 'forwardRequest') {
      this.addExternalCall(component, seen, 'http', methodName, lineNumber, codeSnippet, sourcePath, isLibrary);
      return;
    }

    // Case 1: wrapper.callXxx() - infer type from wrapper variable
    if (objectName && wrapperImports.has(objectName)) {
      const inferredType = wrapperImports.get(objectName)!;
      const template = this.extractTemplateArg(node, methodName, ancestors) || methodName.replace(/^call/, '');
      this.addExternalCall(component, seen, inferredType, template, lineNumber, codeSnippet, sourcePath, isLibrary);
      return;
    }

    // Case 2: callXxx() directly - infer type from the function name (registered via destructured import)
    if (wrapperImports.has(methodName)) {
      const inferredType = wrapperImports.get(methodName)!;
      const template = this.extractTemplateArg(node, methodName, ancestors) || methodName.replace(/^call/, '');
      this.addExternalCall(component, seen, inferredType, template, lineNumber, codeSnippet, sourcePath, isLibrary);
      return;
    }
  }

  /** Helper to add external call with deduplication */
  private addExternalCall(
    component: ComponentAnalysis,
    seen: Set<string>,
    type: ExternalCallType,
    template: string,
    lineNumber: number,
    codeSnippet: string,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    const key = `${type}:${template}:${lineNumber}:${sourcePath}`;
    if (!seen.has(key)) {
      seen.add(key);
      component.externalCalls.push({ type, lineNumber, template, codeSnippet, sourcePath, isLibrary });
    }
  }

  /**
   * Template argument position for specific methods
   * Maps method name patterns to the argument index containing the template name
   */
  private static readonly TEMPLATE_ARG_INDEX: [RegExp, number][] = [
    [/^callAVSDCQTemplate$/, 4],
    [/^callDCQ$/, 6],
    [/^callAVS$/, 4],
    [/^callAVSB2C(WithFullResponse)?$/, 2],
    [/^callAVSB2B(WithFullResponse)?$/, 3],
    [/^callAVSB2BVersioned(WithFullResponse)?$/, 4],
    [/^callAVSESTemplate$/, 2],
    [/^callDcqDecoupledESTemplate$/, 2],
    [/^callESTemplate$/, 3],
    [/^callExternal$/, 3],
    [/^callDsf$/, 2],
    [/^callAVSDCQSearch$/, -1],
    [/^callAVSESSearch$/, 1],
    [/^callES$/, 3],
    [/^callExternal$/, 3],
    [/^callPinboard$/, -1],
    [/^callAVA$/, -1],
    [/^callGetAggregatedContentDetail$/, -1],
    [/^callGetLiveContentMetadata$/, -1],
    [/^callGetVodContentMetadata$/, -1],
    [/^callGetLauncherMetadata$/, -1],
    [/^callGetLiveChannelList$/, -1],
    [/^callSearchSuggestions$/, -1],
    [/^callSearchVodEvents$/, -1],
    [/^callSearchContents$/, -1],
    [/^callGetLiveInfo$/, -1],
    [/^callGetEpg$/, -1],
  ];

  /** Extract template argument based on method name, resolving variable references within scope */
  private extractTemplateArg(
    node: Node, 
    methodName?: string,
    ancestors?: Node[]
  ): string | undefined {
    if (!node.arguments) return undefined;

    // Try to find template at known position for specific methods
    if (methodName) {
      for (const [pattern, argIndex] of ComponentAnalyzer.TEMPLATE_ARG_INDEX) {
        if (argIndex >= 0 && argIndex < node.arguments.length && node.arguments[argIndex] && pattern.test(methodName)) {
          const arg = node.arguments[argIndex];
          if (arg?.type === 'Literal' && typeof arg.value === 'string') {
            return arg.value;
          } else if (arg?.type === 'Identifier' && arg.name) {
            // Try to resolve variable within the enclosing function scope
            if (ancestors) {
              const resolved = this.resolveVariableInScope(arg.name, ancestors);
              if (resolved) {
                return resolved;
              }
            }
            // Fallback to variable name if not resolved
            return arg.name;
          }
        }
      }
    }

    // Fallback: check last argument for template name
    for (let i = node.arguments.length - 1; i >= 0; i--) {
      const arg = node.arguments[i];
      if (arg?.type === 'Literal' && typeof arg.value === 'string') {
        // Skip common non-template strings
        const val = arg.value;
        if (val.length > 2 && !val.includes('/') && !/^(GET|POST|PUT|DELETE)$/i.test(val)) {
          return val;
        }
      }
    }
    return undefined;
  }

  /**
   * Analyze config dependencies (appCache.getMWareConfig, etc.)
   */
  private analyzeConfigDep(
    node: Node,
    lineNumber: number,
    codeSnippet: string,
    component: ComponentAnalysis,
    seen: Set<string>
  ): void {
    const callee = node.callee;
    if (callee?.type !== 'MemberExpression') return;

    const objectName = this.getPropertyName(callee.object);
    if (objectName !== 'appCache') return;

    const methodName = this.getPropertyName(callee.property);
    if (!methodName) return;

    const methodMap: { [key: string]: ConfigDependency['source'] } = {
      'getMWareConfig': 'mWareConfig',
      'getAppConfig': 'appConfig',
      'getSysParameter': 'sysParameter',
      'get': 'appCache'
    };

    const source = methodMap[methodName];
    if (!source) return;

    const firstArg = node.arguments?.[0];
    let key = 'default';
    
    if (firstArg?.type === 'Literal' && typeof firstArg.value === 'string') {
      key = firstArg.value;
    }

    const dedupKey = `${source}:${key}`;
    if (!seen.has(dedupKey)) {
      seen.add(dedupKey);
      component.configDeps.push({
        source,
        key,
        lineNumber,
        codeSnippet
      });
    }
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
            .map((p: Node) => this.getPropertyName(p.key))
            .filter(Boolean)
            .join(', ');
        }
        break;
      }
    }

    const isLocal = modulePath.startsWith('./') || modulePath.startsWith('../');
    const isAglModule = modulePath.startsWith('@opus/agl-');

    let resolvedPath: string | undefined;
    const currentDir = path.dirname(currentFilePath);

    if (isLocal) {
      resolvedPath = this.resolveLocalPath(modulePath, currentDir);
    } else if (isAglModule) {
      resolvedPath = this.resolveAglModulePath(modulePath);
    }

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
    if (this.matchesMemberExpression(left.object, ['module', 'exports'])) {
      const funcName = this.getPropertyName(left.property);
      if (funcName) {
        component.exportedFunctions.push(funcName);
        if (funcName === 'execute' || funcName === 'run') {
          component.mainFunctionLine = lineNumber;
        }
      }
    }

    // exports.xxx = ...
    if (left.object?.type === 'Identifier' && left.object.name === 'exports') {
      const funcName = this.getPropertyName(left.property);
      if (funcName) {
        component.exportedFunctions.push(funcName);
      }
    }

    // module.exports = { ... }
    if (this.matchesMemberExpression(left, ['module', 'exports'])) {
      const right = node.right;
      if (right?.type === 'ObjectExpression' && right.properties) {
        for (const prop of right.properties) {
          const name = this.getPropertyName(prop.key);
          if (name) {
            component.exportedFunctions.push(name);
          }
        }
      }
    }
  }

  // ==================== Helper Methods ====================

  /**
   * Extract property path after a specific prefix (e.g., res.locals.xxx -> xxx)
   */
  private extractPropertyPath(node: Node, objectName: string, propertyName: string): string | null {
    const path: string[] = [];
    let current: Node | undefined = node;

    while (current?.type === 'MemberExpression') {
      const propName = this.getPropertyName(current.property);
      if (propName) {
        path.unshift(propName);
      }
      current = current.object;
    }

    // Check if the path starts with objectName.propertyName
    if (current?.type === 'Identifier' && current.name === objectName) {
      if (path.length >= 1 && path[0] === propertyName) {
        // Return the rest of the path after propertyName
        const restPath = path.slice(1);
        return restPath.length > 0 ? restPath.join('.') : null;
      }
    }

    return null;
  }

  /**
   * Check if a node matches a specific member expression pattern
   */
  private matchesMemberExpression(node: Node | undefined, pattern: string[]): boolean {
    if (!node) return false;

    if (pattern.length === 1) {
      return node.type === 'Identifier' && node.name === pattern[0];
    }

    if (node.type === 'MemberExpression') {
      const propName = this.getPropertyName(node.property);
      if (propName === pattern[pattern.length - 1]) {
        return this.matchesMemberExpression(node.object, pattern.slice(0, -1));
      }
    }

    return false;
  }

  /**
   * Get property name from a node
   */
  private getPropertyName(node: Node | undefined): string | null {
    if (!node) return null;
    if (node.type === 'Identifier') return node.name || null;
    if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
    return null;
  }

  /**
   * Clean property path by removing native methods
   */
  private cleanPropertyPath(property: string): string | null {
    const parts = property.split('.');
    while (parts.length > 0 && NATIVE_METHODS_AND_PROPS.has(parts[parts.length - 1])) {
      parts.pop();
    }
    return parts.length > 0 ? parts.join('.') : null;
  }

  /**
   * Get line number from node
   */
  private getLineNumber(node: Node): number {
    const loc = (node as acorn.Node & { loc?: { start: { line: number } } }).loc;
    return loc?.start?.line || 1;
  }

  /**
   * Get code snippet from lines
   */
  private getCodeSnippet(lines: string[], lineNumber: number): string {
    return lines[lineNumber - 1]?.trim() || '';
  }

  // ==================== Path Resolution (same as regex version) ====================

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

  private getModuleName(filePath: string): string {
    const relativePath = path.relative(this.middlewareRoot, filePath);
    return relativePath.replace(/\\/g, '/').replace(/\.js$/, '');
  }

  private getDisplayName(filePath: string): string {
    const fileName = path.basename(filePath, '.js');
    if (fileName === 'index') {
      return path.basename(path.dirname(filePath));
    }
    return fileName;
  }

  private isLibraryPath(filePath: string): boolean {
    return sharedIsLibraryPath(filePath);
  }

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
}
