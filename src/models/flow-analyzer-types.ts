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

export interface ResLocalsUsage {
  property: string;
  type: 'read' | 'write';
  lineNumber: number;
  codeSnippet: string;
  fullPath?: string;  // e.g., "seedData.containers" for nested properties
  sourcePath?: string; // Source file path where this usage occurs
}

export interface ExternalCall {
  type: 'dcq' | 'microservice' | 'elasticsearch' | 'cache' | 'http';
  template?: string;
  endpoint?: string;
  method?: string;
  lineNumber: number;
  codeSnippet?: string;
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
  
  // Code analysis results
  resLocalsReads: ResLocalsUsage[];
  resLocalsWrites: ResLocalsUsage[];
  externalCalls: ExternalCall[];
  configDeps: ConfigDependency[];
  
  // Dependencies
  requires: RequireInfo[];
  children: ComponentAnalysis[];  // Sub-components (recursively analyzed)
  
  // Function locations
  exportedFunctions: string[];
  mainFunctionLine?: number;
}

export interface MiddlewareAnalysis {
  name: string;
  filePath: string;
  exists: boolean;
  resLocalsReads: ResLocalsUsage[];
  resLocalsWrites: ResLocalsUsage[];
  externalCalls: ExternalCall[];
  configDeps: ConfigDependency[];
  internalDeps: string[];
  runFunctionLine?: number;
  panicFunctionLine?: number;
  
  // NEW: Component tree
  components: ComponentAnalysis[];
  
  // NEW: Aggregated data from all components
  allResLocalsReads: ResLocalsUsage[];
  allResLocalsWrites: ResLocalsUsage[];
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
  
  // NEW: Detailed component data flow
  componentDataFlow: ComponentDataFlowEdge[];
}
