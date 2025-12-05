import * as fs from 'fs';
import * as path from 'path';
import {
    ConfigDependency,
    ExternalCall,
    MiddlewareAnalysis,
    ResLocalsUsage
} from '../models/flow-analyzer-types';

/**
 * Analyzes middleware source code to extract:
 * - res.locals reads/writes
 * - External service calls
 * - Configuration dependencies
 * - Internal module dependencies
 */
export class MiddlewareAnalyzer {
  constructor(
    private workspaceFolder: string,
    private middlewareName: string
  ) {}

  private get middlewareRoot(): string {
    return path.join(this.workspaceFolder, `agl-${this.middlewareName}-middleware`);
  }

  /**
   * Analyze a single middleware file
   */
  public analyzeMiddleware(middlewarePath: string): MiddlewareAnalysis {
    const result: MiddlewareAnalysis = {
      name: middlewarePath,
      filePath: '',
      exists: false,
      resLocalsReads: [],
      resLocalsWrites: [],
      externalCalls: [],
      configDeps: [],
      internalDeps: []
    };

    // Resolve file path
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

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      this.analyzeResLocals(lines, result);
      this.analyzeExternalCalls(lines, result);
      this.analyzeConfigDeps(lines, result);
      this.analyzeInternalDeps(lines, result);
      this.findFunctionLocations(lines, result);

    } catch (error) {
      console.error(`Error analyzing ${middlewarePath}:`, error);
    }

    return result;
  }

  /**
   * Analyze res.locals usage patterns
   */
  private analyzeResLocals(lines: string[], result: MiddlewareAnalysis): void {
    const resLocalsPattern = /res\.locals\.(\w+(?:\.\w+)*)/g;
    const assignmentPatterns = [
      // Direct assignment: res.locals.xxx = ...
      /res\.locals\.(\w+(?:\.\w+)*)\s*=/,
      // Object destructuring assignment won't produce writes
    ];

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      let match;

      // Find all res.locals references
      while ((match = resLocalsPattern.exec(line)) !== null) {
        const property = match[1];
        const codeSnippet = line.trim();

        // Check if this is a write operation
        const isWrite = assignmentPatterns.some(pattern => {
          const writeMatch = line.match(pattern);
          return writeMatch && writeMatch[1] === property;
        });

        const usage: ResLocalsUsage = {
          property,
          type: isWrite ? 'write' : 'read',
          lineNumber,
          codeSnippet,
          fullPath: property
        };

        if (isWrite) {
          // Avoid duplicates
          if (!result.resLocalsWrites.find(w => w.property === property && w.lineNumber === lineNumber)) {
            result.resLocalsWrites.push(usage);
          }
        } else {
          if (!result.resLocalsReads.find(r => r.property === property && r.lineNumber === lineNumber)) {
            result.resLocalsReads.push(usage);
          }
        }
      }
    });

    // Deduplicate by property name (keep first occurrence)
    result.resLocalsReads = this.deduplicateByProperty(result.resLocalsReads);
    result.resLocalsWrites = this.deduplicateByProperty(result.resLocalsWrites);
  }

  private deduplicateByProperty(usages: ResLocalsUsage[]): ResLocalsUsage[] {
    const seen = new Set<string>();
    return usages.filter(u => {
      if (seen.has(u.property)) return false;
      seen.add(u.property);
      return true;
    });
  }

  /**
   * Analyze external service calls
   */
  private analyzeExternalCalls(lines: string[], result: MiddlewareAnalysis): void {
    const patterns = [
      // DCQ calls
      { pattern: /wrapper\.callAVS\w*\([^,]+,[^,]+,[^,]+,[^,]+,\s*['"](\w+)['"]/g, type: 'dcq' as const },
      { pattern: /callAVSDCQTemplate\([^,]+,[^,]+,[^,]+,[^,]+,\s*['"](\w+)['"]/g, type: 'dcq' as const },
      // HTTP client calls
      { pattern: /httpClient\.(get|post|put|delete)\s*\(/g, type: 'http' as const },
      { pattern: /request\.(get|post|put|delete)\s*\(/g, type: 'http' as const },
      { pattern: /request-promise/g, type: 'http' as const },
      // Elasticsearch
      { pattern: /elasticSearchUrl/g, type: 'elasticsearch' as const },
      { pattern: /avs-es-service/g, type: 'elasticsearch' as const },
    ];

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      patterns.forEach(({ pattern, type }) => {
        let match;
        const regex = new RegExp(pattern.source, pattern.flags);
        while ((match = regex.exec(line)) !== null) {
          const call: ExternalCall = {
            type,
            lineNumber,
            template: type === 'dcq' ? match[1] : undefined,
            method: type === 'http' ? match[1] : undefined
          };
          
          // Avoid duplicates
          if (!result.externalCalls.find(e => 
            e.type === call.type && 
            e.template === call.template && 
            e.lineNumber === call.lineNumber
          )) {
            result.externalCalls.push(call);
          }
        }
      });
    });
  }

  /**
   * Analyze configuration dependencies
   */
  private analyzeConfigDeps(lines: string[], result: MiddlewareAnalysis): void {
    const patterns = [
      { pattern: /appCache\.getMWareConfig\s*\(\s*['"](\w+)['"]/g, source: 'mWareConfig' as const },
      { pattern: /appCache\.getAppConfig\s*\(\s*['"]?(\w+)?['"]?\s*\)/g, source: 'appConfig' as const },
      { pattern: /appCache\.getSysParameter\s*\(\s*['"](\w+)['"]/g, source: 'sysParameter' as const },
      { pattern: /appCache\.get\s*\(\s*['"](\w+)['"]/g, source: 'appCache' as const },
    ];

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      patterns.forEach(({ pattern, source }) => {
        let match;
        const regex = new RegExp(pattern.source, pattern.flags);
        while ((match = regex.exec(line)) !== null) {
          const key = match[1] || 'default';
          const dep: ConfigDependency = {
            source,
            key,
            lineNumber
          };

          if (!result.configDeps.find(d => d.source === source && d.key === key)) {
            result.configDeps.push(dep);
          }
        }
      });
    });
  }

  /**
   * Analyze internal module dependencies
   */
  private analyzeInternalDeps(lines: string[], result: MiddlewareAnalysis): void {
    const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    const importPattern = /import\s+.*\s+from\s+['"]([^'"]+)['"]/g;

    const deps = new Set<string>();

    lines.forEach((line) => {
      let match;

      while ((match = requirePattern.exec(line)) !== null) {
        const dep = match[1];
        if (!dep.startsWith('.') && !dep.startsWith('@opus/')) {
          continue; // Skip local and opus packages for now
        }
        deps.add(dep);
      }

      while ((match = importPattern.exec(line)) !== null) {
        const dep = match[1];
        deps.add(dep);
      }
    });

    result.internalDeps = Array.from(deps);
  }

  /**
   * Find run and panic function locations
   */
  private findFunctionLocations(lines: string[], result: MiddlewareAnalysis): void {
    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      // Match various patterns for run function
      if (/(?:module\.exports\.run|exports\.run|const run|function run)\s*=?\s*(?:\(|async)/.test(line)) {
        result.runFunctionLine = lineNumber;
      }

      // Match panic function
      if (/(?:module\.exports\.panic|exports\.panic)\s*=/.test(line)) {
        result.panicFunctionLine = lineNumber;
      }
    });
  }
}
