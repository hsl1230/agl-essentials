import { ComponentAnalysis, DataSourceType } from '../models/flow-analyzer-types';
import { AstUtils, Node, WriteContext } from './ast-utils';

/**
 * DataUsageAnalyzer - Analyzes data access patterns in components
 * 
 * Detects and extracts information about:
 * - res.locals reads/writes
 * - req.transaction reads/writes
 * - req.query, req.body, req.params, req.headers, req.cookies usage
 * - res.cookie, res.header writes
 * - req.header() method calls
 */
export class DataUsageAnalyzer {
  private seen = {
    resLocalsReads: new Set<string>(),
    resLocalsWrites: new Set<string>(),
    reqTransactionReads: new Set<string>(),
    reqTransactionWrites: new Set<string>(),
    dataUsages: new Set<string>()
  };

  /**
   * Reset state for new file analysis
   */
  reset(): void {
    this.seen.resLocalsReads.clear();
    this.seen.resLocalsWrites.clear();
    this.seen.reqTransactionReads.clear();
    this.seen.reqTransactionWrites.clear();
    this.seen.dataUsages.clear();
  }

  /**
   * Analyze a MemberExpression for data usage
   */
  analyzeMemberExpression(
    node: Node,
    ancestors: Node[],
    lineNumber: number,
    codeSnippet: string,
    component: ComponentAnalysis,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    // Skip if this node is the object of a parent MemberExpression
    const parent = ancestors[ancestors.length - 1];
    if (parent?.type === 'MemberExpression' && parent.object === node) {
      return;
    }

    const writeContext = AstUtils.getWriteContext(node, ancestors);
    this.analyzeResLocals(node, lineNumber, codeSnippet, writeContext, component, sourcePath, isLibrary);
    this.analyzeReqTransaction(node, lineNumber, codeSnippet, writeContext, component, sourcePath, isLibrary);
    this.analyzeDataUsage(node, lineNumber, codeSnippet, writeContext, component, sourcePath, isLibrary);
  }

  /**
   * Analyze a delete expression for data writes
   */
  analyzeDeleteExpression(
    node: Node,
    lineNumber: number,
    codeSnippet: string,
    component: ComponentAnalysis,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    const arg = node.argument!;

    const patterns: Array<{
      prefixes: [string, string][];
      seenSet: Set<string>;
      writesArray: ComponentAnalysis['resLocalsWrites'];
    }> = [
      { prefixes: [['res', 'locals'], ['response', 'locals']], seenSet: this.seen.resLocalsWrites, writesArray: component.resLocalsWrites },
      { prefixes: [['req', 'transaction'], ['request', 'transaction']], seenSet: this.seen.reqTransactionWrites, writesArray: component.reqTransactionWrites }
    ];

    for (const { prefixes, seenSet, writesArray } of patterns) {
      const propPath = prefixes.map(([obj, prop]) => AstUtils.extractPropertyPath(arg, obj, prop)).find(p => p);
      if (propPath) {
        const key = `${propPath}:${lineNumber}:${sourcePath}`;
        if (!seenSet.has(key)) {
          seenSet.add(key);
          writesArray.push({ property: propPath, type: 'write', lineNumber, codeSnippet, fullPath: propPath, sourcePath, isLibrary });
        }
      }
    }
  }

  /**
   * Analyze response methods (res.cookie, res.setHeader, etc.)
   */
  analyzeResponseMethods(
    node: Node,
    lineNumber: number,
    codeSnippet: string,
    component: ComponentAnalysis,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    const callee = node.callee;
    if (callee?.type !== 'MemberExpression') return;

    const objectName = AstUtils.getPropertyName(callee.object);
    if (objectName !== 'res' && objectName !== 'response') return;

    const methodName = AstUtils.getPropertyName(callee.property);
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
      if (!this.seen.dataUsages.has(key)) {
        this.seen.dataUsages.add(key);
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
  analyzeRequestHeaderMethod(
    node: Node,
    lineNumber: number,
    codeSnippet: string,
    component: ComponentAnalysis,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    const callee = node.callee;
    if (callee?.type !== 'MemberExpression') return;

    const objectName = AstUtils.getPropertyName(callee.object);
    if (objectName !== 'req' && objectName !== 'request') return;

    const methodName = AstUtils.getPropertyName(callee.property);
    if (methodName !== 'header') return;

    const firstArg = node.arguments?.[0];
    if (!firstArg || firstArg.type !== 'Literal' || typeof firstArg.value !== 'string') return;

    const property = firstArg.value;
    const key = `req.headers:${property}:${lineNumber}:read`;

    if (!this.seen.dataUsages.has(key)) {
      this.seen.dataUsages.add(key);
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

  // Private methods

  private analyzeResLocals(
    node: Node,
    lineNumber: number,
    codeSnippet: string,
    writeContext: WriteContext,
    component: ComponentAnalysis,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    this.analyzePropertyAccess(
      node, lineNumber, codeSnippet, writeContext,
      [['res', 'locals'], ['response', 'locals']],
      component.resLocalsReads, component.resLocalsWrites,
      this.seen.resLocalsReads, this.seen.resLocalsWrites,
      sourcePath, isLibrary, false
    );
  }

  private analyzeReqTransaction(
    node: Node,
    lineNumber: number,
    codeSnippet: string,
    writeContext: WriteContext,
    component: ComponentAnalysis,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    this.analyzePropertyAccess(
      node, lineNumber, codeSnippet, writeContext,
      [['req', 'transaction'], ['request', 'transaction']],
      component.reqTransactionReads, component.reqTransactionWrites,
      this.seen.reqTransactionReads, this.seen.reqTransactionWrites,
      sourcePath, isLibrary, true
    );
  }

  private analyzeDataUsage(
    node: Node,
    lineNumber: number,
    codeSnippet: string,
    writeContext: WriteContext,
    component: ComponentAnalysis,
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
      const property = AstUtils.extractPropertyPath(node, obj, prop);
      if (property) {
        const usageType: 'write' | 'read' = AstUtils.isWriteOperation(writeContext) ? 'write' : 'read';
        const key = `${sourceType}:${property}:${lineNumber}:${usageType}`;
        if (!this.seen.dataUsages.has(key)) {
          this.seen.dataUsages.add(key);
          component.dataUsages.push({ sourceType, property, type: usageType, lineNumber, codeSnippet, fullPath: property, sourcePath, isLibrary });
        }
        return;
      }
    }
  }

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
      property = AstUtils.extractPropertyPath(node, obj, prop);
      if (property) break;
    }

    if (!property && checkDirectAccess) {
      for (const [obj, prop] of prefixes) {
        if (AstUtils.matchesMemberExpression(node, [obj, prop])) {
          property = '(direct)';
          break;
        }
      }
    }

    if (!property) return;

    if (!checkDirectAccess) {
      property = AstUtils.cleanPropertyPath(property);
      if (!property) return;
    }

    const isWrite = AstUtils.isWriteOperation(writeContext);
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
}
