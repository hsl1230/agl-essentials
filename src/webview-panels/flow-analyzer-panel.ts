import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FlowAnalyzer } from '../analyzers/flow-analyzer';
import { EndpointConfig, FlowAnalysisResult } from '../models/flow-analyzer-types';
import { EndpointSearchService } from '../services/endpoint-search-service';
import { AbstractPanel } from './abstract-panel';

export class FlowAnalyzerPanel extends AbstractPanel {
  private flowAnalyzer: FlowAnalyzer;
  private currentResult: FlowAnalysisResult | null = null;
  private currentEndpoint: EndpointConfig | null = null;  // Store current endpoint
  private webviewReady: boolean = false;  // Track if webview has loaded
  private expandedNodes: Set<string> = new Set();  // Track expanded component nodes
  private static outputChannel: vscode.OutputChannel;

  constructor(
    workspaceFolder: string,
    middlewareName: string,
    context: vscode.ExtensionContext
  ) {
    super(workspaceFolder, middlewareName, context);
    
    // Create output channel for logging
    if (!FlowAnalyzerPanel.outputChannel) {
      FlowAnalyzerPanel.outputChannel = vscode.window.createOutputChannel('AGL Flow Analyzer');
    }
    this.log(`Constructor called with workspaceFolder: ${workspaceFolder}`);
    
    this.flowAnalyzer = new FlowAnalyzer(workspaceFolder, middlewareName);
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    FlowAnalyzerPanel.outputChannel.appendLine(`[${timestamp}] ${message}`);
    // FlowAnalyzerPanel.outputChannel.show(true); // Show the output channel
  }

  public get title(): string {
    return `Flow Analyzer - ${this.middlewareName}`;
  }

  public get featureName(): string {
    return 'flow-analyzer';
  }

  public initAction(featureArg: any): void {
    this.log('initAction called');
    const endpoint: EndpointConfig = featureArg;
    this.currentEndpoint = endpoint;
    this.expandedNodes.clear();  // Reset expansion state for new endpoint
    
    // If webview is already ready, start analysis immediately
    if (this.webviewReady) {
      this.log('Webview already ready, starting analysis...');
      this.analyzeAndDisplay(endpoint);
    } else {
      this.log('Waiting for webviewLoaded message...');
    }
  }

  private analyzeAndDisplay(endpoint: EndpointConfig): void {
    this.log(`analyzeAndDisplay called for endpoint: ${endpoint.endpointUri}`);
    this.log(`Middleware chain: ${JSON.stringify(endpoint.middleware)}`);
    
    // Perform analysis
    this.log('Starting flow analysis...');
    this.currentResult = this.flowAnalyzer.analyze(endpoint);
    this.log('Flow analysis complete');

    // Generate Mermaid diagram with current expansion state
    this.log('Generating Mermaid diagram...');
    const { diagram: mermaidDiagram, externalCallsMap } = this.flowAnalyzer.generateMermaidDiagram(this.currentResult, this.expandedNodes);
    const dataFlowSummary = this.flowAnalyzer.generateDataFlowSummary(this.currentResult);
    const componentTree = this.flowAnalyzer.generateComponentTree(this.currentResult.middlewares);
    this.log('Mermaid diagram generated');

    // Convert externalCallsMap to array for JSON serialization
    const externalCallsMapArray = Array.from(externalCallsMap.entries());

    // Send to webview
    this.log('Sending results to webview...');
    this.log(`Panel exists: ${!!this.panel}, webview exists: ${!!this.panel?.webview}`);
    const result = this.panel?.webview.postMessage({
      command: 'analysisResult',
      content: {
        endpoint,
        middlewares: this.serializeMiddlewares(this.currentResult.middlewares),
        mermaidDiagram,
        dataFlowSummary,
        componentTree,
        componentDataFlow: this.currentResult.componentDataFlow,
        expandedNodes: Array.from(this.expandedNodes),  // Send expansion state to webview
        externalCallsMap: externalCallsMapArray,  // Send extId -> call mapping for click navigation
        allProperties: Array.from(this.currentResult.allResLocalsProperties.entries()).map(([key, value]) => ({
          property: key,
          ...value
        })),
        allReqTransactionProperties: Array.from(this.currentResult.allReqTransactionProperties.entries()).map(([key, value]) => ({
          property: key,
          ...value
        }))
      }
    });
    this.log(`postMessage result: ${result}`);
  }

  /**
   * Regenerate only the Mermaid diagram with current expansion state
   */
  private regenerateDiagram(): void {
    if (!this.currentResult) return;
    
    const { diagram: mermaidDiagram, externalCallsMap } = this.flowAnalyzer.generateMermaidDiagram(this.currentResult, this.expandedNodes);
    
    // Convert externalCallsMap to array for JSON serialization
    const externalCallsMapArray = Array.from(externalCallsMap.entries());
    
    this.panel?.webview.postMessage({
      command: 'diagramUpdate',
      content: {
        mermaidDiagram,
        expandedNodes: Array.from(this.expandedNodes),
        externalCallsMap: externalCallsMapArray
      }
    });
  }

  /**
   * Serialize middlewares for webview (components included)
   */
  private serializeMiddlewares(middlewares: any[]): any[] {
    return middlewares.map(mw => ({
      name: mw.name,
      filePath: mw.filePath,
      exists: mw.exists,
      resLocalsReads: mw.resLocalsReads,
      resLocalsWrites: mw.resLocalsWrites,
      reqTransactionReads: mw.reqTransactionReads,
      reqTransactionWrites: mw.reqTransactionWrites,
      dataUsages: mw.dataUsages || [],
      externalCalls: mw.externalCalls,
      configDeps: mw.configDeps,
      internalDeps: mw.internalDeps,
      runFunctionLine: mw.runFunctionLine,
      panicFunctionLine: mw.panicFunctionLine,
      components: this.serializeComponents(mw.components),
      allResLocalsReads: mw.allResLocalsReads,
      allResLocalsWrites: mw.allResLocalsWrites,
      allReqTransactionReads: mw.allReqTransactionReads,
      allReqTransactionWrites: mw.allReqTransactionWrites,
      allDataUsages: mw.allDataUsages || [],
      allExternalCalls: mw.allExternalCalls,
      allConfigDeps: mw.allConfigDeps
    }));
  }

  /**
   * Serialize components recursively
   */
  private serializeComponents(components: any[], depth: number = 0): any[] {
    return components.map(comp => {
      return {
        name: comp.name,
        displayName: comp.displayName,
        filePath: comp.filePath,
        exists: comp.exists,
        depth: comp.depth,
        parentPath: comp.parentPath,
        resLocalsReads: comp.resLocalsReads,
        resLocalsWrites: comp.resLocalsWrites,
        reqTransactionReads: comp.reqTransactionReads,
        reqTransactionWrites: comp.reqTransactionWrites,
        dataUsages: comp.dataUsages || [],
        externalCalls: comp.externalCalls,
        configDeps: comp.configDeps,
        exportedFunctions: comp.exportedFunctions,
        mainFunctionLine: comp.mainFunctionLine,
        children: this.serializeComponents(comp.children, depth + 1)
      };
    });
  }

  protected getMessageHandler(featureArg: any): (msg: any) => void {
    return async (message: any) => {
      this.log(`Received message: ${message.command}`);
      switch (message.command) {
        case 'webviewLoaded':
          this.log('webviewLoaded received');
          this.webviewReady = true;
          // Use currentEndpoint if available, otherwise fall back to featureArg
          const endpoint = this.currentEndpoint || featureArg;
          if (endpoint) {
            this.log('Starting analysis...');
            this.analyzeAndDisplay(endpoint);
          }
          break;

        case 'openMiddlewareFile':
          await this.openMiddlewareFile(message.middlewarePath, message.lineNumber);
          break;

        case 'openMiddlewareAtLine':
          await this.openMiddlewareFile(message.middlewarePath, message.lineNumber);
          break;

        case 'openComponentFile':
          await this.openFile(message.filePath, message.lineNumber);
          break;

        case 'refreshAnalysis':
          if (this.currentEndpoint) {
            this.expandedNodes.clear();  // Reset expansion state on refresh
            this.analyzeAndDisplay(this.currentEndpoint);
          }
          break;

        case 'toggleComponentExpansion':
          // Toggle expansion state for a component node
          const nodeId = message.nodeId;
          this.log(`toggleComponentExpansion: nodeId=${nodeId}`);
          if (this.expandedNodes.has(nodeId)) {
            this.expandedNodes.delete(nodeId);
            this.log(`Collapsed node: ${nodeId}`);
          } else {
            this.expandedNodes.add(nodeId);
            this.log(`Expanded node: ${nodeId}`);
          }
          this.log(`Current expanded nodes: ${Array.from(this.expandedNodes).join(', ')}`);
          this.regenerateDiagram();
          break;

        case 'toggleMiddlewareExpansion':
          // Toggle expansion state for a middleware node
          // We use MW{n}_collapsed to track collapsed state (default is expanded)
          const mwNodeId = message.nodeId;
          const collapsedId = `${mwNodeId}_collapsed`;
          this.log(`toggleMiddlewareExpansion: nodeId=${mwNodeId}`);
          if (this.expandedNodes.has(collapsedId)) {
            this.expandedNodes.delete(collapsedId);
            this.log(`Expanded middleware: ${mwNodeId}`);
          } else {
            this.expandedNodes.add(collapsedId);
            this.log(`Collapsed middleware: ${mwNodeId}`);
          }
          this.log(`Current expanded nodes: ${Array.from(this.expandedNodes).join(', ')}`);
          this.regenerateDiagram();
          break;

        case 'showMiddlewareDetail':
          this.showMiddlewareDetail(message.middlewareName);
          break;

        case 'showComponentDetail':
          this.showComponentDetail(message.componentPath);
          break;

        case 'trackProperty':
          this.trackProperty(message.property);
          break;

        case 'trackReqTransaction':
          this.trackReqTransaction(message.property);
          break;

        case 'openConfigFile':
          await this.openConfigFile(message.configType, message.configKey);
          break;

        case 'searchInEndpoint':
          await this.searchInEndpoint(message.searchQuery);
          break;
      }
    };
  }

  /**
   * Search within endpoint-related files
   */
  private async searchInEndpoint(searchQuery?: string): Promise<void> {
    if (!this.currentEndpoint) {
      vscode.window.showErrorMessage('No endpoint selected for search.');
      return;
    }

    const searchService = new EndpointSearchService(this.workspaceFolder, this.middlewareName);
    await searchService.searchInEndpoint(this.currentEndpoint, searchQuery);
  }

  private async openMiddlewareFile(middlewarePath: string, lineNumber?: number): Promise<void> {
    try {
      let fullPath = path.join(this.workspaceFolder, this.fullMiddlewareName, `${middlewarePath}.js`);
      if (!fs.existsSync(fullPath)) {
        fullPath = path.join(this.workspaceFolder, this.fullMiddlewareName, `${middlewarePath}/index.js`);
      }

      if (!fs.existsSync(fullPath)) {
        vscode.window.showErrorMessage(`Middleware file not found: ${middlewarePath}`);
        return;
      }

      await this.openFile(fullPath, lineNumber);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open middleware: ${error.message}`);
    }
  }

  private async openFile(filePath: string, lineNumber?: number): Promise<void> {
    try {
      if (!fs.existsSync(filePath)) {
        vscode.window.showErrorMessage(`File not found: ${filePath}`);
        return;
      }

      const doc = await vscode.workspace.openTextDocument(filePath);
      // Open code in ViewColumn.One (left side), webview stays in ViewColumn.Two (right side)
      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false,
        preview: true
      });

      if (lineNumber && lineNumber > 0) {
        const position = new vscode.Position(lineNumber - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open file: ${error.message}`);
    }
  }

  private showMiddlewareDetail(middlewareName: string): void {
    if (!this.currentResult) return;

    const middleware = this.currentResult.middlewares.find(m => m.name === middlewareName);
    if (!middleware) return;

    this.panel?.webview.postMessage({
      command: 'middlewareDetail',
      content: {
        ...middleware,
        components: this.serializeComponents(middleware.components)
      }
    });
  }

  private showComponentDetail(componentPath: string): void {
    if (!this.currentResult) return;

    // Find the component in the tree
    const findComponent = (components: any[]): any | null => {
      for (const comp of components) {
        if (comp.filePath === componentPath) {
          return comp;
        }
        const found = findComponent(comp.children);
        if (found) return found;
      }
      return null;
    };

    for (const mw of this.currentResult.middlewares) {
      const component = findComponent(mw.components);
      if (component) {
        this.panel?.webview.postMessage({
          command: 'componentDetail',
          content: {
            ...component,
            children: this.serializeComponents(component.children)
          }
        });
        return;
      }
    }
  }

  private trackProperty(property: string): void {
    if (!this.currentResult) return;

    const info = this.currentResult.allResLocalsProperties.get(property);
    if (!info) return;

    const usages = this.collectPropertyUsages(
      property, 
      'resLocalsWrites', 
      'resLocalsReads'
    );

    this.panel?.webview.postMessage({
      command: 'propertyUsages',
      content: {
        property,
        producers: info.producers,
        consumers: info.consumers,
        usages
      }
    });
  }

  private trackReqTransaction(property: string): void {
    if (!this.currentResult) return;

    const info = this.currentResult.allReqTransactionProperties.get(property);
    if (!info) return;

    const usages = this.collectPropertyUsages(
      property, 
      'reqTransactionWrites', 
      'reqTransactionReads'
    );

    this.panel?.webview.postMessage({
      command: 'reqTransactionUsages',
      content: {
        property,
        producers: info.producers,
        consumers: info.consumers,
        usages
      }
    });
  }

  /**
   * Collect property usages across middlewares and components
   * Used by both trackProperty and trackReqTransaction
   */
  private collectPropertyUsages(
    property: string,
    writesKey: string,
    readsKey: string
  ): any[] {
    if (!this.currentResult) return [];

    const usages: any[] = [];
    const seenKeys = new Set<string>();
    const seenFilePaths = new Set<string>();
    
    const collectUsages = (source: any, sourceName: string, isComponent: boolean) => {
      if (isComponent && seenFilePaths.has(source.filePath)) {
        return;
      }
      if (isComponent) {
        seenFilePaths.add(source.filePath);
      }

      const writes = source[writesKey]?.filter((w: any) => w.property === property) || [];
      const reads = source[readsKey]?.filter((r: any) => r.property === property) || [];

      writes.forEach((w: any) => {
        const key = `${source.filePath}:${w.lineNumber}:write`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        
        usages.push({
          source: sourceName,
          filePath: source.filePath,
          isComponent,
          isLibrary: w.isLibrary,
          type: 'write',
          lineNumber: w.lineNumber,
          codeSnippet: w.codeSnippet
        });
      });

      reads.forEach((r: any) => {
        const key = `${source.filePath}:${r.lineNumber}:read`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        
        usages.push({
          source: sourceName,
          filePath: source.filePath,
          isComponent,
          isLibrary: r.isLibrary,
          type: 'read',
          lineNumber: r.lineNumber,
          codeSnippet: r.codeSnippet
        });
      });
    };

    const collectFromComponents = (components: any[], parentName: string) => {
      for (const comp of components) {
        collectUsages(comp, `${parentName} → ${comp.displayName}`, true);
        collectFromComponents(comp.children, `${parentName} → ${comp.displayName}`);
      }
    };

    this.currentResult.middlewares.forEach(mw => {
      collectUsages(mw, mw.name, false);
      collectFromComponents(mw.components, mw.name);
    });

    return usages;
  }

  private async openConfigFile(configType: string, configKey?: string): Promise<void> {
    const configPath = path.join(
      this.workspaceFolder,
      `agl-config-${this.middlewareName}`,
      'files',
      `${configType}.json`
    );

    if (!fs.existsSync(configPath)) {
      vscode.window.showErrorMessage(`Config file not found: ${configType}.json`);
      return;
    }

    const doc = await vscode.workspace.openTextDocument(configPath);
    // Open config in ViewColumn.One (left side)
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false,
      preview: true
    });

    // If a specific key is provided, try to find and highlight it
    if (configKey) {
      const text = doc.getText();
      const keyPattern = new RegExp(`"${configKey}"\\s*:`);
      const match = text.match(keyPattern);
      if (match && match.index !== undefined) {
        const position = doc.positionAt(match.index);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
      }
    }
  }
}
