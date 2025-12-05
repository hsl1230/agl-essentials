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
}

export interface ExternalCall {
  type: 'dcq' | 'microservice' | 'elasticsearch' | 'cache' | 'http';
  template?: string;
  endpoint?: string;
  method?: string;
  lineNumber: number;
}

export interface ConfigDependency {
  source: 'mWareConfig' | 'appConfig' | 'sysParameter' | 'appCache';
  key: string;
  lineNumber: number;
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
}

export interface DataFlowEdge {
  from: string;  // middleware name
  to: string;    // middleware name
  properties: string[];  // res.locals properties passed
}

export interface FlowAnalysisResult {
  endpoint: EndpointConfig;
  middlewares: MiddlewareAnalysis[];
  dataFlow: DataFlowEdge[];
  allResLocalsProperties: Map<string, {
    producers: string[];
    consumers: string[];
  }>;
}
