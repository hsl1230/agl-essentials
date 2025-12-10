import * as acorn from 'acorn';
import { walk } from 'estree-walker';

/**
 * ESTree node types (acorn uses ESTree format)
 */
export type Node = acorn.Node & {
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
  elements?: (Node | null)[];
};

/**
 * Context for tracking write operations during AST traversal
 */
export interface WriteContext {
  isAssignmentTarget: boolean;
  isDeleteTarget: boolean;
  isMutationCall: boolean;
  isObjectAssignTarget: boolean;
}

/**
 * Array mutation methods used for detecting writes
 */
export const MUTATION_METHODS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin',
  'set', 'add', 'delete', 'clear'
]);

/**
 * Native JavaScript methods/properties to skip when analyzing data usage
 */
export const NATIVE_METHODS_AND_PROPS = new Set([
  'length', 'indexOf', 'find', 'findIndex', 'filter', 'map', 'reduce', 'reduceRight',
  'forEach', 'some', 'every', 'includes', 'slice', 'concat', 'join', 'flat', 'flatMap',
  'keys', 'values', 'entries', 'at', 'toString', 'toLocaleString', 'constructor',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'valueOf'
]);

/**
 * AST utility functions
 */
export class AstUtils {
  /**
   * Get property name from a node
   */
  static getPropertyName(node: Node | undefined): string | null {
    if (!node) return null;
    if (node.type === 'Identifier') return node.name || null;
    if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
    return null;
  }

  /**
   * Get line number from node
   */
  static getLineNumber(node: Node): number {
    const loc = (node as acorn.Node & { loc?: { start: { line: number } } }).loc;
    return loc?.start?.line || 1;
  }

  /**
   * Get code snippet from lines
   */
  static getCodeSnippet(lines: string[], lineNumber: number): string {
    return lines[lineNumber - 1]?.trim() || '';
  }

  /**
   * Check if a node matches a specific member expression pattern
   */
  static matchesMemberExpression(node: Node | undefined, pattern: string[]): boolean {
    if (!node) return false;

    if (pattern.length === 1) {
      return node.type === 'Identifier' && node.name === pattern[0];
    }

    if (node.type === 'MemberExpression') {
      const propName = AstUtils.getPropertyName(node.property);
      if (propName === pattern[pattern.length - 1]) {
        return AstUtils.matchesMemberExpression(node.object, pattern.slice(0, -1));
      }
    }

    return false;
  }

  /**
   * Extract property path after a specific prefix (e.g., res.locals.xxx -> xxx)
   */
  static extractPropertyPath(node: Node, objectName: string, propertyName: string): string | null {
    const path: string[] = [];
    let current: Node | undefined = node;

    while (current?.type === 'MemberExpression') {
      const propName = AstUtils.getPropertyName(current.property);
      if (propName) {
        path.unshift(propName);
      }
      current = current.object;
    }

    if (current?.type === 'Identifier' && current.name === objectName) {
      if (path.length >= 1 && path[0] === propertyName) {
        const restPath = path.slice(1);
        return restPath.length > 0 ? restPath.join('.') : null;
      }
    }

    return null;
  }

  /**
   * Clean property path by removing native methods
   */
  static cleanPropertyPath(property: string): string | null {
    const parts = property.split('.');
    while (parts.length > 0 && NATIVE_METHODS_AND_PROPS.has(parts[parts.length - 1])) {
      parts.pop();
    }
    return parts.length > 0 ? parts.join('.') : null;
  }

  /**
   * Check if a node is a descendant of another node
   */
  static isDescendantOf(node: Node, potentialAncestor: Node | undefined): boolean {
    if (!potentialAncestor) return false;
    if (node === potentialAncestor) return true;
    
    const nodeStart = (node as acorn.Node).start;
    const nodeEnd = (node as acorn.Node).end;
    const ancestorStart = (potentialAncestor as acorn.Node).start;
    const ancestorEnd = (potentialAncestor as acorn.Node).end;
    
    return nodeStart >= ancestorStart && nodeEnd <= ancestorEnd;
  }

  /**
   * Determine if a node is in a write context
   */
  static getWriteContext(node: Node, ancestors: Node[]): WriteContext {
    const context: WriteContext = {
      isAssignmentTarget: false,
      isDeleteTarget: false,
      isMutationCall: false,
      isObjectAssignTarget: false
    };

    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancestor = ancestors[i];

      if (ancestor.type === 'AssignmentExpression' && ancestor.left === ancestors[i + 1]) {
        context.isAssignmentTarget = true;
        break;
      }

      if (ancestor.type === 'UpdateExpression') {
        context.isAssignmentTarget = true;
        break;
      }

      if (ancestor.type === 'UnaryExpression' && ancestor.operator === 'delete') {
        context.isDeleteTarget = true;
        break;
      }

      if (ancestor.type === 'CallExpression' && ancestor.callee?.type === 'MemberExpression') {
        const methodName = AstUtils.getPropertyName(ancestor.callee.property);
        if (methodName && MUTATION_METHODS.has(methodName)) {
          if (AstUtils.isDescendantOf(node, ancestor.callee.object)) {
            context.isMutationCall = true;
            break;
          }
        }
      }

      if (ancestor.type === 'CallExpression') {
        const callee = ancestor.callee;
        if (callee?.type === 'MemberExpression' &&
            AstUtils.getPropertyName(callee.object) === 'Object' &&
            AstUtils.getPropertyName(callee.property) === 'assign') {
          const firstArg = ancestor.arguments?.[0];
          if (firstArg && AstUtils.isDescendantOf(node, firstArg)) {
            context.isObjectAssignTarget = true;
            break;
          }
        }
      }
    }

    return context;
  }

  /**
   * Check if node is a write operation based on context
   */
  static isWriteOperation(writeContext: WriteContext): boolean {
    return writeContext.isAssignmentTarget || writeContext.isDeleteTarget || 
           writeContext.isMutationCall || writeContext.isObjectAssignTarget;
  }

  /**
   * Find all enclosing scopes from ancestors (function scopes + global)
   */
  static findEnclosingScopes(ancestors: Node[]): Node[] {
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
   * Extract possible string values from an expression
   * Handles: Literal, ConditionalExpression, LogicalExpression, ArrayExpression
   */
  static extractPossibleStringValues(node: Node): string[] {
    const values: string[] = [];
    
    switch (node.type) {
      case 'Literal':
        if (typeof node.value === 'string') {
          values.push(node.value);
        }
        break;
      
      case 'ConditionalExpression':
        if (node.consequent) {
          values.push(...AstUtils.extractPossibleStringValues(node.consequent));
        }
        if (node.alternate) {
          values.push(...AstUtils.extractPossibleStringValues(node.alternate));
        }
        break;
      
      case 'LogicalExpression':
        if (node.left) {
          values.push(...AstUtils.extractPossibleStringValues(node.left));
        }
        if (node.right) {
          values.push(...AstUtils.extractPossibleStringValues(node.right));
        }
        break;
      
      case 'ArrayExpression':
        if (node.elements) {
          const stringElements = node.elements
            .filter((el): el is Node => el !== null && el.type === 'Literal' && typeof el.value === 'string')
            .map(el => el.value as string);
          if (stringElements.length > 0) {
            values.push(stringElements.join(','));
          }
        }
        break;
    }
    
    return values;
  }

  /**
   * Search for variable declaration within a specific scope
   */
  static findVariableInScope(variableName: string, scopeNode: Node): string[] {
    const values: string[] = [];

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
            node.id.name === variableName && 
            node.init) {
          values.push(...AstUtils.extractPossibleStringValues(node.init));
        }
      }
    });

    return values;
  }

  /**
   * Resolve variable value by searching from current scope up to global scope
   */
  static resolveVariableInScope(variableName: string, ancestors: Node[]): string | undefined {
    const scopes = AstUtils.findEnclosingScopes(ancestors);
    
    for (const scopeNode of scopes) {
      const values = AstUtils.findVariableInScope(variableName, scopeNode);
      if (values.length > 0) {
        return values.join(' | ');
      }
    }
    
    return undefined;
  }
}
