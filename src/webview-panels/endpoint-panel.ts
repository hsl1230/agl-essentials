import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FeatureViewerManager } from '../services/feature-viewer-manager';
import { AbstractPanel } from './abstract-panel';

export class EndpointPanel extends AbstractPanel {
  constructor(
    workspaceFolder: string,
    middlewareName: string,
    context: vscode.ExtensionContext,
    private featureViewerManager: FeatureViewerManager
  ) {
    super(workspaceFolder, middlewareName, context);
  }

  public get title(): string {
    return `Endpoint Viewer - ${this.middlewareName}`;
  }
  public get featureName(): string {
    return 'endpoint-viewer';
  }

  public initAction(featureArg: any): void {
    const endpointConfig = featureArg;
    this.panel?.webview.postMessage({ command: 'endpointConfig', content: endpointConfig });
  }

  protected getMessageHandler(featureArg: any): (msg: any) => void {
    return async (message: any) => {
      if (message.command === 'webviewLoaded') {
        const endpointConfig = featureArg;
        this.panel?.webview.postMessage({ command: 'endpointConfig', content: endpointConfig });
      } else if (message.command === 'openMiddlewareFile') {
        try {
          let fullPath = path.join(this.workspaceFolder, this.fullMiddlewareName, `${message.middlewarePath}.js`);
          if (!fs.existsSync(fullPath)) {
            fullPath = path.join(this.workspaceFolder, this.fullMiddlewareName, `${message.middlewarePath}/index.js`);
          }
          const doc = await vscode.workspace.openTextDocument(fullPath);
          await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: true });
        } catch (error: any) {
          this.panel?.webview.postMessage({ command: 'error', message: `Failed to open the middleware ${message.middlewarePath}: ${error.message}` });
        }
      } else if (message.command === 'openMapperViewer') {
        this.featureViewerManager.openFeatureViewer('mapper-viewer', message.mapperName, this.middlewareName);
        vscode.commands.executeCommand('aglEssentials.highlightNode', message.mapperName, this.middlewareName);
      } else if (message.command === 'analyzeFlow') {
        // Open Flow Analyzer for this endpoint
        this.featureViewerManager.openFeatureViewer('flow-analyzer', message.endpoint, this.middlewareName);
      }
    };

  }
}