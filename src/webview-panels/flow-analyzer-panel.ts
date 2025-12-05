import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FlowAnalyzer } from '../analyzers/flow-analyzer';
import { EndpointConfig, FlowAnalysisResult } from '../models/flow-analyzer-types';
import { AbstractPanel } from './abstract-panel';

export class FlowAnalyzerPanel extends AbstractPanel {
  private flowAnalyzer: FlowAnalyzer;
  private currentResult: FlowAnalysisResult | null = null;
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
    FlowAnalyzerPanel.outputChannel.show(true); // Show the output channel
  }

  public get title(): string {
    return `Flow Analyzer - ${this.middlewareName}`;
  }

  public get featureName(): string {
    return 'flow-analyzer';
  }

  public initAction(featureArg: any): void {
    this.log('initAction called - waiting for webviewLoaded message');
    // Don't call analyzeAndDisplay here - wait for webviewLoaded message from the webview
    // The webview will send webviewLoaded once DOM is ready, then we can safely send data
  }

  private analyzeAndDisplay(endpoint: EndpointConfig): void {
    this.log(`analyzeAndDisplay called for endpoint: ${endpoint.endpointUri}`);
    this.log(`Middleware chain: ${JSON.stringify(endpoint.middleware)}`);
    
    // Perform analysis
    this.log('Starting flow analysis...');
    this.currentResult = this.flowAnalyzer.analyze(endpoint);
    this.log('Flow analysis complete');

    // Generate Mermaid diagram
    this.log('Generating Mermaid diagram...');
    const mermaidDiagram = this.flowAnalyzer.generateMermaidDiagram(this.currentResult);
    const dataFlowSummary = this.flowAnalyzer.generateDataFlowSummary(this.currentResult);
    const componentTree = this.flowAnalyzer.generateComponentTree(this.currentResult.middlewares);
    this.log('Mermaid diagram generated');

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
  private serializeComponents(components: any[]): any[] {
    return components.map(comp => ({
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
      children: this.serializeComponents(comp.children)
    }));
  }

  protected getMessageHandler(featureArg: any): (msg: any) => void {
    return async (message: any) => {
      this.log(`Received message: ${message.command}`);
      switch (message.command) {
        case 'webviewLoaded':
          this.log('webviewLoaded received, starting analysis...');
          this.analyzeAndDisplay(featureArg);
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
          if (this.currentResult) {
            this.analyzeAndDisplay(this.currentResult.endpoint);
          }
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
      }
    };
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
      // Use ViewColumn.Beside to open next to webview, preserving webview focus
      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false, // Focus the editor but don't close webview
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

    // Find all usages across middlewares and their components
    const usages: any[] = [];
    
    const collectUsages = (source: any, sourceName: string, isComponent: boolean) => {
      const writes = source.resLocalsWrites?.filter((w: any) => w.property === property) || [];
      const reads = source.resLocalsReads?.filter((r: any) => r.property === property) || [];

      writes.forEach((w: any) => {
        usages.push({
          source: sourceName,
          filePath: source.filePath,
          isComponent,
          type: 'write',
          lineNumber: w.lineNumber,
          codeSnippet: w.codeSnippet
        });
      });

      reads.forEach((r: any) => {
        usages.push({
          source: sourceName,
          filePath: source.filePath,
          isComponent,
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

    // Find all usages across middlewares and their components
    const usages: any[] = [];
    
    const collectUsages = (source: any, sourceName: string, isComponent: boolean) => {
      const writes = source.reqTransactionWrites?.filter((w: any) => w.property === property) || [];
      const reads = source.reqTransactionReads?.filter((r: any) => r.property === property) || [];

      writes.forEach((w: any) => {
        usages.push({
          source: sourceName,
          filePath: source.filePath,
          isComponent,
          type: 'write',
          lineNumber: w.lineNumber,
          codeSnippet: w.codeSnippet
        });
      });

      reads.forEach((r: any) => {
        usages.push({
          source: sourceName,
          filePath: source.filePath,
          isComponent,
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
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

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
