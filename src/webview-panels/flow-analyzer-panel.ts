import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FlowAnalyzer } from '../analyzers/flow-analyzer';
import { EndpointConfig, FlowAnalysisResult } from '../models/flow-analyzer-types';
import { AbstractPanel } from './abstract-panel';

export class FlowAnalyzerPanel extends AbstractPanel {
  private flowAnalyzer: FlowAnalyzer;
  private currentResult: FlowAnalysisResult | null = null;

  constructor(
    workspaceFolder: string,
    middlewareName: string,
    context: vscode.ExtensionContext
  ) {
    super(workspaceFolder, middlewareName, context);
    this.flowAnalyzer = new FlowAnalyzer(workspaceFolder, middlewareName);
  }

  public get title(): string {
    return `Flow Analyzer - ${this.middlewareName}`;
  }

  public get featureName(): string {
    return 'flow-analyzer';
  }

  public initAction(featureArg: any): void {
    const endpoint: EndpointConfig = featureArg;
    this.analyzeAndDisplay(endpoint);
  }

  private analyzeAndDisplay(endpoint: EndpointConfig): void {
    // Perform analysis
    this.currentResult = this.flowAnalyzer.analyze(endpoint);

    // Generate Mermaid diagram
    const mermaidDiagram = this.flowAnalyzer.generateMermaidDiagram(this.currentResult);
    const dataFlowSummary = this.flowAnalyzer.generateDataFlowSummary(this.currentResult);

    // Send to webview
    this.panel?.webview.postMessage({
      command: 'analysisResult',
      content: {
        endpoint,
        middlewares: this.currentResult.middlewares,
        mermaidDiagram,
        dataFlowSummary,
        allProperties: Array.from(this.currentResult.allResLocalsProperties.entries()).map(([key, value]) => ({
          property: key,
          ...value
        }))
      }
    });
  }

  protected getMessageHandler(featureArg: any): (msg: any) => void {
    return async (message: any) => {
      switch (message.command) {
        case 'webviewLoaded':
          this.analyzeAndDisplay(featureArg);
          break;

        case 'openMiddlewareFile':
          await this.openMiddlewareFile(message.middlewarePath, message.lineNumber);
          break;

        case 'openMiddlewareAtLine':
          await this.openMiddlewareFile(message.middlewarePath, message.lineNumber);
          break;

        case 'refreshAnalysis':
          if (this.currentResult) {
            this.analyzeAndDisplay(this.currentResult.endpoint);
          }
          break;

        case 'showMiddlewareDetail':
          this.showMiddlewareDetail(message.middlewareName);
          break;

        case 'trackProperty':
          this.trackProperty(message.property);
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

      const doc = await vscode.workspace.openTextDocument(fullPath);
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

      if (lineNumber && lineNumber > 0) {
        const position = new vscode.Position(lineNumber - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open middleware: ${error.message}`);
    }
  }

  private showMiddlewareDetail(middlewareName: string): void {
    if (!this.currentResult) return;

    const middleware = this.currentResult.middlewares.find(m => m.name === middlewareName);
    if (!middleware) return;

    this.panel?.webview.postMessage({
      command: 'middlewareDetail',
      content: middleware
    });
  }

  private trackProperty(property: string): void {
    if (!this.currentResult) return;

    const info = this.currentResult.allResLocalsProperties.get(property);
    if (!info) return;

    // Find all usages across middlewares
    const usages: any[] = [];
    this.currentResult.middlewares.forEach(mw => {
      const writes = mw.resLocalsWrites.filter(w => w.property === property);
      const reads = mw.resLocalsReads.filter(r => r.property === property);

      writes.forEach(w => {
        usages.push({
          middleware: mw.name,
          type: 'write',
          lineNumber: w.lineNumber,
          codeSnippet: w.codeSnippet
        });
      });

      reads.forEach(r => {
        usages.push({
          middleware: mw.name,
          type: 'read',
          lineNumber: r.lineNumber,
          codeSnippet: r.codeSnippet
        });
      });
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
