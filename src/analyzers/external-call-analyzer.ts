import { walk } from 'estree-walker';
import { ComponentAnalysis } from '../models/flow-analyzer-types';
import { AstUtils, Node } from './ast-utils';

/**
 * External call type derived from require path
 */
export type ExternalCallType = 'dcq' | 'avs' | 'ava' | 'dsf' | 'elasticsearch' | 'external' | 'pinboard' | 'microservice' | 'http' | 'cache';

/**
 * Regex to extract wrapper type from require path
 */
const WRAPPER_PATH_PATTERN = /\/wrapper\/request\/(\w+)(?:\.js)?$/;

/**
 * Map short names to canonical type names
 */
const WRAPPER_TYPE_ALIASES: Record<string, ExternalCallType> = {
  'es': 'elasticsearch'
};

/**
 * Template argument position for specific methods
 */
const TEMPLATE_ARG_INDEX: [RegExp, number][] = [
  [/^callAVSDCQTemplate$/, 4],
  [/^callDCQ$/, 6],
  [/^callAVS$/, 4],
  [/^callAVSB2C(WithFullResponse)?$/, 2],
  [/^callAVSB2B(WithFullResponse)?$/, 3],
  [/^callAVSB2BVersioned(WithFullResponse)?$/, 4],
  [/^callAVSESTemplate$/, 2],
  [/^callDcqDecoupledESTemplate$/, 2],
  [/^call(ES|ESTemplate)$/, 3],
  [/^callExternal$/, 3],
  [/^callDsf$/, 2],
  [/^callAVSDCQSearch$/, -1],
  [/^callAVSESSearch$/, 2],
  [/^callPinboard$/, 3],
  [/^callAVA$/, 3],
  [/^callGet(AggregatedContentDetail|Live(ContentMetadata|ChannelList|Info)|VodContentMetadata|LauncherMetadata|Epg)$/, -1],
  [/^callSearch(Suggestions|VodEvents|Contents)$/, -1],
];

/**
 * ExternalCallAnalyzer - Analyzes external API calls in components
 * 
 * Detects and extracts information about:
 * - Wrapper calls (callAVS, callDCQ, etc.)
 * - HTTP client calls (httpClient, forwardRequest)
 * - Template arguments and URL patterns
 */
export class ExternalCallAnalyzer {
  private wrapperImports = new Map<string, ExternalCallType>();
  private seen = new Set<string>();

  /**
   * Reset state for new file analysis
   */
  reset(): void {
    this.wrapperImports.clear();
    this.seen.clear();
  }

  /**
   * Get wrapper imports map (for external access)
   */
  getWrapperImports(): Map<string, ExternalCallType> {
    return this.wrapperImports;
  }

  /**
   * Detect wrapper type from require path
   */
  detectWrapperType(modulePath: string): ExternalCallType | null {
    const match = WRAPPER_PATH_PATTERN.exec(modulePath);
    if (match) {
      const rawType = match[1];
      return WRAPPER_TYPE_ALIASES[rawType] || rawType as ExternalCallType;
    }
    return null;
  }

  /**
   * Register wrapper imports from require statement
   */
  registerWrapperImports(ancestors: Node[], wrapperType: ExternalCallType): void {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancestor = ancestors[i];
      if (ancestor.type === 'VariableDeclarator' && ancestor.id) {
        if (ancestor.id.type === 'Identifier' && ancestor.id.name) {
          this.wrapperImports.set(ancestor.id.name, wrapperType);
        } else if (ancestor.id.type === 'ObjectPattern' && ancestor.id.properties) {
          for (const prop of ancestor.id.properties) {
            const propNode = prop as { key?: Node; value?: Node };
            const localName = AstUtils.getPropertyName(propNode.value) || AstUtils.getPropertyName(propNode.key);
            if (localName) {
              this.wrapperImports.set(localName, wrapperType);
            }
          }
        }
        break;
      }
    }
  }

  /**
   * Track local variable assignments that reference wrapper methods
   */
  trackWrapperMethodAssignment(node: Node): void {
    if (!node.id || node.id.type !== 'Identifier' || !node.id.name || !node.init) return;

    const varName = node.id.name;
    const wrapperType = this.extractWrapperTypeFromExpression(node.init);
    
    if (wrapperType) {
      this.wrapperImports.set(varName, wrapperType);
    }
  }

  /**
   * Analyze a CallExpression for external calls
   */
  analyze(
    node: Node,
    ancestors: Node[],
    lineNumber: number,
    codeSnippet: string,
    component: ComponentAnalysis,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    const callee = node.callee;
    let methodName: string | null = null;
    let objectName: string | null = null;

    if (callee?.type === 'Identifier') {
      methodName = callee.name ?? null;
    } else if (callee?.type === 'MemberExpression') {
      methodName = AstUtils.getPropertyName(callee.property) ?? null;
      objectName = AstUtils.getPropertyName(callee.object) ?? null;
    }

    if (!methodName) return;

    // Check for httpClient/forwardRequest calls
    if (methodName === 'httpClient' || methodName === 'forwardRequest') {
      const urlTemplate = this.extractHttpClientUrl(node, ancestors);
      this.addExternalCall(component, 'http', urlTemplate || methodName, lineNumber, codeSnippet, sourcePath, isLibrary);
      return;
    }

    // Check for v2.httpClient() pattern
    if (callee?.type === 'MemberExpression' && callee.object?.type === 'MemberExpression') {
      const nestedProp = AstUtils.getPropertyName(callee.object.property);
      const topMethod = AstUtils.getPropertyName(callee.property);
      if (nestedProp === 'v2' && topMethod === 'httpClient') {
        const urlTemplate = this.extractHttpClientUrl(node, ancestors);
        this.addExternalCall(component, 'http', urlTemplate || 'httpClient', lineNumber, codeSnippet, sourcePath, isLibrary);
        return;
      }
    }

    // wrapper.callXxx() - infer type from wrapper variable
    if (objectName && this.wrapperImports.has(objectName)) {
      const inferredType = this.wrapperImports.get(objectName)!;
      const template = this.extractTemplateArg(node, methodName, ancestors) || methodName.replace(/^call/, '');
      this.addExternalCall(component, inferredType, template, lineNumber, codeSnippet, sourcePath, isLibrary);
      return;
    }

    // callXxx() directly - infer type from function name
    if (this.wrapperImports.has(methodName)) {
      const inferredType = this.wrapperImports.get(methodName)!;
      const template = this.extractTemplateArg(node, methodName, ancestors) || methodName.replace(/^call/, '');
      this.addExternalCall(component, inferredType, template, lineNumber, codeSnippet, sourcePath, isLibrary);
      return;
    }
  }

  // Private methods

  private addExternalCall(
    component: ComponentAnalysis,
    type: ExternalCallType,
    template: string,
    lineNumber: number,
    codeSnippet: string,
    sourcePath: string,
    isLibrary: boolean
  ): void {
    const key = `${type}:${template}:${lineNumber}:${sourcePath}`;
    if (!this.seen.has(key)) {
      this.seen.add(key);
      component.externalCalls.push({ type, lineNumber, template, codeSnippet, sourcePath, isLibrary });
    }
  }

  private extractWrapperTypeFromExpression(node: Node): ExternalCallType | null {
    if (node.type === 'MemberExpression') {
      const objectName = AstUtils.getPropertyName(node.object);
      if (objectName && this.wrapperImports.has(objectName)) {
        return this.wrapperImports.get(objectName)!;
      }
    }

    if (node.type === 'ConditionalExpression') {
      const fromConsequent = node.consequent ? this.extractWrapperTypeFromExpression(node.consequent) : null;
      if (fromConsequent) return fromConsequent;
      
      const fromAlternate = node.alternate ? this.extractWrapperTypeFromExpression(node.alternate) : null;
      if (fromAlternate) return fromAlternate;
    }

    if (node.type === 'LogicalExpression') {
      const fromLeft = node.left ? this.extractWrapperTypeFromExpression(node.left) : null;
      if (fromLeft) return fromLeft;
      
      const fromRight = node.right ? this.extractWrapperTypeFromExpression(node.right) : null;
      if (fromRight) return fromRight;
    }

    return null;
  }

  private extractTemplateArg(node: Node, methodName?: string, ancestors?: Node[]): string | undefined {
    if (!node.arguments) return undefined;

    if (methodName) {
      for (const [pattern, argIndex] of TEMPLATE_ARG_INDEX) {
        if (argIndex >= 0 && argIndex < node.arguments.length && node.arguments[argIndex] && pattern.test(methodName)) {
          const arg = node.arguments[argIndex];
          const values = AstUtils.extractPossibleStringValues(arg);
          if (values.length > 0) {
            return values.join(' | ');
          }
          if (arg?.type === 'Identifier' && arg.name) {
            if (ancestors) {
              const resolved = AstUtils.resolveVariableInScope(arg.name, ancestors);
              if (resolved) return resolved;
            }
            return arg.name;
          }
        }
      }
    }

    // Fallback: check last argument
    for (let i = node.arguments.length - 1; i >= 0; i--) {
      const arg = node.arguments[i];
      if (arg?.type === 'Literal' && typeof arg.value === 'string') {
        const val = arg.value;
        if (val.length > 2 && !val.includes('/') && !/^(GET|POST|PUT|DELETE)$/i.test(val)) {
          return val;
        }
      }
    }
    return undefined;
  }

  private extractHttpClientUrl(node: Node, ancestors: Node[]): string | null {
    const args = node.arguments;
    if (!args || args.length < 2) return null;

    for (let i = 1; i < Math.min(args.length, 3); i++) {
      const configArg = args[i];
      
      if (configArg?.type === 'ObjectExpression' && configArg.properties) {
        for (const prop of configArg.properties) {
          const keyName = AstUtils.getPropertyName(prop.key);
          if (keyName === 'url') {
            const propValue = (prop as { value?: Node }).value;
            if (propValue) {
              if (propValue.type === 'Literal' && typeof propValue.value === 'string') {
                return propValue.value;
              }
              if (propValue.type === 'Identifier' && propValue.name) {
                return propValue.name;
              }
              if (propValue.type === 'TemplateLiteral' || propValue.type === 'BinaryExpression') {
                return this.extractUrlFromExpression(propValue);
              }
            }
          }
        }
      }
      
      if (configArg?.type === 'Identifier' && configArg.name) {
        const urlFromVar = this.findUrlInConfigVariable(configArg.name, ancestors);
        if (urlFromVar) return urlFromVar;
      }
    }

    return null;
  }

  private extractUrlFromExpression(node: Node): string | null {
    if (node.type === 'Identifier' && node.name) {
      return node.name;
    }
    if (node.type === 'Literal' && typeof node.value === 'string') {
      return node.value;
    }
    if (node.type === 'BinaryExpression' && node.operator === '+') {
      const leftResult = node.left ? this.extractUrlFromExpression(node.left) : null;
      const rightResult = node.right ? this.extractUrlFromExpression(node.right) : null;
      if (rightResult && !rightResult.startsWith('/') && !rightResult.startsWith('http')) {
        return rightResult;
      }
      return leftResult || rightResult;
    }
    return null;
  }

  private findUrlInConfigVariable(varName: string, ancestors: Node[]): string | null {
    const scopes = AstUtils.findEnclosingScopes(ancestors);
    
    for (const scopeNode of scopes) {
      let found: string | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      walk(scopeNode as any, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        enter: (n: any, parent: any) => {
          const node = n as Node;
          const parentNode = parent as Node | undefined;
          
          if (parentNode && 
              (node.type === 'FunctionDeclaration' || 
               node.type === 'FunctionExpression' || 
               node.type === 'ArrowFunctionExpression') &&
              node !== scopeNode) {
            return false;
          }

          if (node.type === 'VariableDeclarator' && 
              node.id?.type === 'Identifier' && 
              node.id.name === varName && 
              node.init?.type === 'ObjectExpression' &&
              node.init.properties) {
            for (const prop of node.init.properties) {
              const keyName = AstUtils.getPropertyName(prop.key);
              if (keyName === 'url') {
                const propValue = (prop as { value?: Node }).value;
                if (propValue?.type === 'Literal' && typeof propValue.value === 'string') {
                  found = propValue.value;
                } else if (propValue?.type === 'Identifier' && propValue.name) {
                  found = propValue.name;
                } else if (propValue) {
                  found = this.extractUrlFromExpression(propValue);
                }
              }
            }
          }
        }
      });
      
      if (found) return found;
    }
    
    return null;
  }
}
