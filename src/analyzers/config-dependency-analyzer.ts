import { ComponentAnalysis, ConfigDependency } from '../models/flow-analyzer-types';
import { AstUtils, Node } from './ast-utils';

/**
 * ConfigDependencyAnalyzer - Analyzes configuration dependencies
 * 
 * Detects calls to:
 * - appCache.getMWareConfig()
 * - appCache.getAppConfig()
 * - appCache.getSysParameter()
 * - appCache.get()
 */
export class ConfigDependencyAnalyzer {
  private seen = new Set<string>();

  /**
   * Reset state for new file analysis
   */
  reset(): void {
    this.seen.clear();
  }

  /**
   * Analyze a CallExpression for config dependencies
   */
  analyze(
    node: Node,
    lineNumber: number,
    codeSnippet: string,
    component: ComponentAnalysis
  ): void {
    const callee = node.callee;
    if (callee?.type !== 'MemberExpression') return;

    const objectName = AstUtils.getPropertyName(callee.object);
    if (objectName !== 'appCache') return;

    const methodName = AstUtils.getPropertyName(callee.property);
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
    if (!this.seen.has(dedupKey)) {
      this.seen.add(dedupKey);
      component.configDeps.push({
        source,
        key,
        lineNumber,
        codeSnippet
      });
    }
  }
}
