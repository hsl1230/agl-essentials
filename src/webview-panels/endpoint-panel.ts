import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FeatureViewerManager } from '../services/feature-viewer-manager';
import { AbstractPanel } from './abstract-panel';

export class EndpointPanel extends AbstractPanel {
  constructor(
    workspaceFolder: string,
    middlewareName: string,
    isDefaultMiddleware: boolean,
    context: vscode.ExtensionContext,
    private featureViewerManager: FeatureViewerManager
  ) {
    super(workspaceFolder, middlewareName, isDefaultMiddleware, context);
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
          vscode.commands.executeCommand('vscode.open', vscode.Uri.file(fullPath));
        } catch (error: any) {
          this.panel?.webview.postMessage({ command: 'error', message: `Failed to open the middleware ${message.middlewarePath}: ${error.message}` });
        }
      } else if (message.command === 'openMapperViewer') {
        console.log('Open mapper viewer', message.mapperName);
        this.featureViewerManager.openFeatureViewer('mapper-viewer', message.mapperName, this.middlewareName);
        vscode.commands.executeCommand('aglEssentials.highlightNode', message.mapperName, this.middlewareName);
      }
    };

  }
}