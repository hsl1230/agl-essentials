import * as fs from 'fs';
import * as path from 'path';
import {
  ComponentAnalysis,
  MiddlewareAnalysis
} from '../models/flow-analyzer-types';
import { normalizePath } from '../shared';
import { ComponentAnalyzer } from './component-analyzer';

/**
 * MiddlewareAnalyzer - Wrapper around ComponentAnalyzer for middleware entry points
 * 
 * This class:
 * 1. Uses ComponentAnalyzer for the actual file analysis
 * 2. Converts ComponentAnalysis to MiddlewareAnalysis format
 * 3. Computes aggregated data (all*) from the component tree
 * 
 * The aggregation is done here because MiddlewareAnalysis needs the all* fields
 * for backward compatibility and display purposes.
 */
export class MiddlewareAnalyzer {
  private componentAnalyzer: ComponentAnalyzer;
  private normalizedWorkspaceFolder: string;

  constructor(
    private workspaceFolder: string,
    private middlewareName: string
  ) {
    this.normalizedWorkspaceFolder = normalizePath(workspaceFolder);
    this.componentAnalyzer = new ComponentAnalyzer(workspaceFolder, middlewareName);
  }

  private get middlewareRoot(): string {
    return path.join(this.normalizedWorkspaceFolder, `agl-${this.middlewareName}-middleware`);
  }

  /**
   * Clear the component cache
   */
  public clearCache(): void {
    this.componentAnalyzer.clearCache();
  }

  /**
   * Get cache statistics
   */
  public getCacheStats() {
    return this.componentAnalyzer.getCacheStats();
  }

  /**
   * Analyze a middleware and return MiddlewareAnalysis
   * This method uses ComponentAnalyzer for the actual analysis,
   * then aggregates the results into the MiddlewareAnalysis format.
   */
  public analyzeMiddleware(middlewarePath: string): MiddlewareAnalysis {
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

    // Resolve the middleware file path
    let fullPath = path.join(this.middlewareRoot, `${middlewarePath}.js`);
    if (!fs.existsSync(fullPath)) {
      fullPath = path.join(this.middlewareRoot, `${middlewarePath}/index.js`);
    }

    if (!fs.existsSync(fullPath)) {
      result.filePath = fullPath;
      return result;
    }

    // Use ComponentAnalyzer to analyze the middleware entry point
    const componentResult = this.componentAnalyzer.analyze(fullPath, 0);
    
    if (!componentResult) {
      result.filePath = fullPath;
      return result;
    }

    // Convert ComponentAnalysis to MiddlewareAnalysis
    result.filePath = componentResult.filePath;
    result.exists = componentResult.exists;
    result.resLocalsReads = componentResult.resLocalsReads;
    result.resLocalsWrites = componentResult.resLocalsWrites;
    result.reqTransactionReads = componentResult.reqTransactionReads;
    result.reqTransactionWrites = componentResult.reqTransactionWrites;
    result.dataUsages = componentResult.dataUsages;
    result.externalCalls = componentResult.externalCalls;
    result.configDeps = componentResult.configDeps;
    result.internalDeps = componentResult.requires.map(r => r.modulePath);
    result.components = componentResult.children;

    // Find function locations in the middleware
    this.findFunctionLocations(fullPath, result);

    // Aggregate data from all components
    this.aggregateComponentData(result, componentResult);

    return result;
  }

  /**
   * Find run and panic function locations
   */
  private findFunctionLocations(filePath: string, result: MiddlewareAnalysis): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        const lineNumber = index + 1;
        if (/(?:module\.exports\.run|exports\.run|const run|function run)\s*=?\s*(?:\(|async)/.test(line)) {
          result.runFunctionLine = lineNumber;
        }
        if (/(?:module\.exports\.panic|exports\.panic)\s*=/.test(line)) {
          result.panicFunctionLine = lineNumber;
        }
      });
    } catch (error) {
      console.error(`Error finding function locations in ${filePath}:`, error);
    }
  }

  /**
   * Aggregate data from all components in the tree
   * This populates the all* fields in MiddlewareAnalysis
   */
  private aggregateComponentData(result: MiddlewareAnalysis, rootComponent: ComponentAnalysis): void {
    const collectedPaths = new Set<string>();

    // Helper to collect data from a component
    const collectFromComponent = (component: ComponentAnalysis) => {
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

    // Collect from root and all descendants
    collectFromComponent(rootComponent);

    // Deduplicate all aggregated data
    result.allResLocalsReads = this.deduplicateUsages(result.allResLocalsReads);
    result.allResLocalsWrites = this.deduplicateUsages(result.allResLocalsWrites);
    result.allReqTransactionReads = this.deduplicateUsages(result.allReqTransactionReads);
    result.allReqTransactionWrites = this.deduplicateUsages(result.allReqTransactionWrites);
    result.allDataUsages = this.deduplicateDataUsages(result.allDataUsages);
    result.allExternalCalls = this.deduplicateExternalCalls(result.allExternalCalls);
    result.allConfigDeps = this.deduplicateConfigDeps(result.allConfigDeps);
  }

  /**
   * Generic deduplication helper
   * @param items - Array of items to deduplicate
   * @param keyFn - Function to generate unique key for each item
   * @param filterFn - Optional filter to exclude items (return false to exclude)
   */
  private deduplicate<T>(items: T[], keyFn: (item: T) => string, filterFn?: (item: T) => boolean): T[] {
    const seen = new Map<string, T>();
    for (const item of items) {
      if (filterFn && !filterFn(item)) {
        continue;
      }
      const key = keyFn(item);
      if (!seen.has(key)) {
        seen.set(key, item);
      }
    }
    return Array.from(seen.values());
  }

  private deduplicateUsages<T extends { property: string; sourcePath?: string }>(usages: T[]): T[] {
    return this.deduplicate(usages, u => `${u.property}:${u.sourcePath}`);
  }

  private deduplicateDataUsages<T extends { sourceType: string; property: string; type: string; sourcePath?: string }>(usages: T[]): T[] {
    return this.deduplicate(usages, u => `${u.sourceType}:${u.property}:${u.type}:${u.sourcePath}`);
  }

  private deduplicateExternalCalls<T extends { type: string; template?: string; sourcePath?: string; isLibrary?: boolean }>(calls: T[]): T[] {
    return this.deduplicate(calls, c => `${c.type}:${c.template || ''}:${c.sourcePath}`, c => !c.isLibrary);
  }

  private deduplicateConfigDeps<T extends { source: string; key: string }>(deps: T[]): T[] {
    return this.deduplicate(deps, d => `${d.source}:${d.key}`);
  }
}
