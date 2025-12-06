/**
 * Flow Analyzer Types
 * Data models for analyzing AGL middleware flow
 */

export interface EndpointConfig {
  endpointUri: string;
  method: string;
  middleware: string[];
  panic: boolean | string;
  template: string;
  nanoConfigKey?: string;
  panicConfigKey?: string;
}

/**
 * Data usage types - tracks various input/output data sources
 */
export type DataSourceType = 
  | 'res.locals'
  | 'req.transaction'
  | 'req.query'
  | 'req.body'
  | 'req.params'
  | 'req.headers'
  | 'req.cookies'
  | 'res.cookie'
  | 'res.header'
  | 'return'
  | 'function-param';

export interface DataUsage {
  sourceType: DataSourceType;
  property: string;
  type: 'read' | 'write';
  lineNumber: number;
  codeSnippet: string;
  fullPath?: string;  // e.g., "seedData.containers" for nested properties
  sourcePath?: string; // Source file path where this usage occurs
}

// Keep ResLocalsUsage for backward compatibility
export interface ResLocalsUsage {
  property: string;
  type: 'read' | 'write';
  lineNumber: number;
  codeSnippet: string;
  fullPath?: string;  // e.g., "seedData.containers" for nested properties
  sourcePath?: string; // Source file path where this usage occurs
  isLibrary?: boolean; // Whether this usage is in a library file (agl-core, agl-utils, etc.)
}

export interface ExternalCall {
  type: 'dcq' | 'avs' | 'pinboard' | 'elasticsearch' | 'external' | 'ava' | 'dsf' | 'microservice' | 'cache' | 'http';
  template?: string;
  endpoint?: string;
  method?: string;
  lineNumber: number;
  codeSnippet?: string;
  sourcePath?: string; // Source file path where this call occurs
  isLibrary?: boolean; // Whether this call is in a library file (agl-core, agl-utils, etc.)
}

export interface ConfigDependency {
  source: 'mWareConfig' | 'appConfig' | 'sysParameter' | 'appCache';
  key: string;
  lineNumber: number;
  codeSnippet?: string;
}

export interface RequireInfo {
  modulePath: string;      // Original require path (e.g., './bo/getPageDetails')
  variableName: string;    // Variable name used in code (e.g., 'getPageDetails')
  resolvedPath?: string;   // Absolute path to the file
  lineNumber: number;
  isLocal: boolean;        // Whether it's a local file (starts with . or ..)
  isAglModule: boolean;    // Whether it's an @opus/agl-* module
}

/**
 * Component analysis - represents a file/module that is called by middleware
 * Components can have their own sub-components, creating a tree structure
 */
export interface ComponentAnalysis {
  name: string;
  displayName: string;     // Short name for display
  filePath: string;
  exists: boolean;
  depth: number;           // Depth in the call tree (0 = direct import from middleware)
  parentPath?: string;     // Path of the parent component
  
  // Code analysis results - res.locals (primary)
  resLocalsReads: ResLocalsUsage[];
  resLocalsWrites: ResLocalsUsage[];
  
  // Code analysis results - req.transaction (similar to res.locals)
  reqTransactionReads: ResLocalsUsage[];
  reqTransactionWrites: ResLocalsUsage[];
  
  // Extended data usage tracking
  dataUsages: DataUsage[];
  
  externalCalls: ExternalCall[];
  configDeps: ConfigDependency[];
  
  // Dependencies
  requires: RequireInfo[];
  children: ComponentAnalysis[];  // Sub-components (recursively analyzed)
  
  // Function locations
  exportedFunctions: string[];
  mainFunctionLine?: number;
  
  // Indicates this is a shallow reference (already analyzed elsewhere)
  isShallowReference?: boolean;
}

export interface MiddlewareAnalysis {
  name: string;
  filePath: string;
  exists: boolean;
  resLocalsReads: ResLocalsUsage[];
  resLocalsWrites: ResLocalsUsage[];
  
  // req.transaction tracking (similar to res.locals)
  reqTransactionReads: ResLocalsUsage[];
  reqTransactionWrites: ResLocalsUsage[];
  
  // Extended data usage tracking
  dataUsages: DataUsage[];
  
  externalCalls: ExternalCall[];
  configDeps: ConfigDependency[];
  internalDeps: string[];
  runFunctionLine?: number;
  panicFunctionLine?: number;
  
  // Component tree
  components: ComponentAnalysis[];
  
  // Aggregated data from all components
  allResLocalsReads: ResLocalsUsage[];
  allResLocalsWrites: ResLocalsUsage[];
  allReqTransactionReads: ResLocalsUsage[];
  allReqTransactionWrites: ResLocalsUsage[];
  allDataUsages: DataUsage[];
  allExternalCalls: ExternalCall[];
  allConfigDeps: ConfigDependency[];
}

export interface DataFlowEdge {
  from: string;  // middleware name
  to: string;    // middleware name
  properties: string[];  // res.locals properties passed
}

export interface ComponentDataFlowEdge {
  from: string;  // component path
  to: string;    // component path
  property: string;
  type: 'write-read' | 'write-write' | 'read-write';
}

export interface FlowAnalysisResult {
  endpoint: EndpointConfig;
  middlewares: MiddlewareAnalysis[];
  dataFlow: DataFlowEdge[];
  allResLocalsProperties: Map<string, {
    producers: string[];
    consumers: string[];
  }>;
  allReqTransactionProperties: Map<string, {
    producers: string[];
    consumers: string[];
  }>;
  
  // NEW: Detailed component data flow
  componentDataFlow: ComponentDataFlowEdge[];
}
