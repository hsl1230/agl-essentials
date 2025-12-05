import * as fs from 'fs';
import * as path from 'path';
import {
    ComponentAnalysis,
    ConfigDependency,
    ExternalCall,
    MiddlewareAnalysis,
    RequireInfo,
    ResLocalsUsage
} from '../models/flow-analyzer-types';

/**
 * Analyzes middleware source code to extract:
 * - res.locals reads/writes
 * - External service calls
 * - Configuration dependencies
 * - Internal module dependencies (components)
 * - Recursively analyzes all components
 */
export class MiddlewareAnalyzer {
  private analyzedPaths = new Set<string>();
  private readonly MAX_DEPTH = 10;

  constructor(
    private workspaceFolder: string,
    private middlewareName: string
  ) {}

  private get middlewareRoot(): string {
    return path.join(this.workspaceFolder, `agl-${this.middlewareName}-middleware`);
  }

  private get aglCoreRoot(): string {
    return path.join(this.workspaceFolder, 'agl-core');
  }

  private get aglUtilsRoot(): string {
    return path.join(this.workspaceFolder, 'agl-utils');
  }

  private get aglCacheRoot(): string {
    return path.join(this.workspaceFolder, 'agl-cache');
  }

  private get aglLoggerRoot(): string {
    return path.join(this.workspaceFolder, 'agl-logger');
  }

  /**
   * Analyze a single middleware file with deep component analysis
   */
  public analyzeMiddleware(middlewarePath: string): MiddlewareAnalysis {
    this.analyzedPaths.clear();

    const result: MiddlewareAnalysis = {
      name: middlewarePath,
      filePath: '',
      exists: false,
      resLocalsReads: [],
      resLocalsWrites: [],
      externalCalls: [],
      configDeps: [],
      internalDeps: [],
      components: [],
      allResLocalsReads: [],
      allResLocalsWrites: [],
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

      this.analyzeResLocals(lines, result.resLocalsReads, result.resLocalsWrites, fullPath);
      this.analyzeExternalCalls(lines, result.externalCalls);
      this.analyzeConfigDeps(lines, result.configDeps);
      const requires = this.analyzeRequires(lines, fullPath);
      result.internalDeps = requires.map(r => r.modulePath);
      this.findFunctionLocations(lines, result);

      result.components = this.analyzeComponents(requires, fullPath, 0);
      this.aggregateComponentData(result);

    } catch (error) {
      console.error(`Error analyzing ${middlewarePath}:`, error);
    }

    return result;
  }

  private analyzeRequires(lines: string[], currentFilePath: string): RequireInfo[] {
    const requires: RequireInfo[] = [];
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

          if (!requires.find(r => r.modulePath === modulePath)) {
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
    const moduleMap: { [key: string]: string } = {
      '@opus/agl-core': this.aglCoreRoot,
      '@opus/agl-utils': this.aglUtilsRoot,
      '@opus/agl-cache': this.aglCacheRoot,
      '@opus/agl-logger': this.aglLoggerRoot
    };

    const root = moduleMap[modulePath];
    if (root) {
      const indexPath = path.join(root, 'index.js');
      if (fs.existsSync(indexPath)) {
        return indexPath;
      }
    }
    return undefined;
  }

  private analyzeComponents(requires: RequireInfo[], parentPath: string, depth: number): ComponentAnalysis[] {
    if (depth >= this.MAX_DEPTH) {
      return [];
    }

    const components: ComponentAnalysis[] = [];

    for (const req of requires) {
      if (!req.resolvedPath || this.analyzedPaths.has(req.resolvedPath)) {
        continue;
      }
      if (!req.isLocal && !req.isAglModule) {
        continue;
      }

      this.analyzedPaths.add(req.resolvedPath);
      const component = this.analyzeComponent(req, parentPath, depth);
      if (component && component.exists) {
        components.push(component);
      }
    }

    return components;
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
      this.analyzeExternalCalls(lines, component.externalCalls);
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
    result.allExternalCalls = [...result.externalCalls];
    result.allConfigDeps = [...result.configDeps];

    const collectFromComponent = (component: ComponentAnalysis) => {
      result.allResLocalsReads.push(...component.resLocalsReads);
      result.allResLocalsWrites.push(...component.resLocalsWrites);
      result.allExternalCalls.push(...component.externalCalls);
      result.allConfigDeps.push(...component.configDeps);

      for (const child of component.children) {
        collectFromComponent(child);
      }
    };

    for (const component of result.components) {
      collectFromComponent(component);
    }

    result.allResLocalsReads = this.deduplicateByPropertyAndSource(result.allResLocalsReads);
    result.allResLocalsWrites = this.deduplicateByPropertyAndSource(result.allResLocalsWrites);
  }

  private analyzeResLocals(lines: string[], reads: ResLocalsUsage[], writes: ResLocalsUsage[], sourcePath: string): void {
    const resLocalsPattern = /res\.locals\.(\w+(?:\.\w+)*)/g;
    const assignmentPatterns = [/res\.locals\.(\w+(?:\.\w+)*)\s*=/];

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      let match;
      resLocalsPattern.lastIndex = 0;

      while ((match = resLocalsPattern.exec(line)) !== null) {
        const property = match[1];
        const codeSnippet = line.trim();

        const isWrite = assignmentPatterns.some(pattern => {
          const writeMatch = line.match(pattern);
          return writeMatch && writeMatch[1] === property;
        });

        const usage: ResLocalsUsage = {
          property,
          type: isWrite ? 'write' : 'read',
          lineNumber,
          codeSnippet,
          fullPath: property,
          sourcePath
        };

        if (isWrite) {
          if (!writes.find(w => w.property === property && w.lineNumber === lineNumber && w.sourcePath === sourcePath)) {
            writes.push(usage);
          }
        } else {
          if (!reads.find(r => r.property === property && r.lineNumber === lineNumber && r.sourcePath === sourcePath)) {
            reads.push(usage);
          }
        }
      }
    });
  }

  private deduplicateByPropertyAndSource(usages: ResLocalsUsage[]): ResLocalsUsage[] {
    const seen = new Map<string, ResLocalsUsage>();
    for (const u of usages) {
      const key = `${u.property}:${u.sourcePath}`;
      if (!seen.has(key)) {
        seen.set(key, u);
      }
    }
    return Array.from(seen.values());
  }

  private analyzeExternalCalls(lines: string[], results: ExternalCall[]): void {
    const patterns = [
      { pattern: /wrapper\.callAVS\w*\([^,]+,[^,]+,[^,]+,[^,]+,\s*['"](\w+)['"]/g, type: 'dcq' as const },
      { pattern: /callAVSDCQTemplate\([^,]+,[^,]+,[^,]+,[^,]+,\s*['"](\w+)['"]/g, type: 'dcq' as const },
      { pattern: /httpClient\.(get|post|put|delete)\s*\(/g, type: 'http' as const },
      { pattern: /request\.(get|post|put|delete)\s*\(/g, type: 'http' as const },
      { pattern: /axios\.(get|post|put|delete)\s*\(/g, type: 'http' as const },
      { pattern: /elasticSearchUrl/g, type: 'elasticsearch' as const },
      { pattern: /avs-es-service/g, type: 'elasticsearch' as const },
      { pattern: /wrapper\.callAVSMicroservice\s*\(/g, type: 'microservice' as const },
      { pattern: /callAVSMicroservice\s*\(/g, type: 'microservice' as const },
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
            method: type === 'http' ? match[1] : undefined,
            codeSnippet: line.trim()
          };
          
          if (!results.find(e => e.type === call.type && e.template === call.template && e.lineNumber === call.lineNumber)) {
            results.push(call);
          }
        }
      });
    });
  }

  private analyzeConfigDeps(lines: string[], results: ConfigDependency[]): void {
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
          const dep: ConfigDependency = { source, key, lineNumber, codeSnippet: line.trim() };

          if (!results.find(d => d.source === source && d.key === key)) {
            results.push(dep);
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
