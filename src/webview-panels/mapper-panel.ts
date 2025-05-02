import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProviderManager } from '../services/provider-manager';
import { AbstractPanel } from './abstract-panel';

export class MapperPanel extends AbstractPanel {
  constructor(
    workspaceFolder: string,
    middlewareName: string,
    isDefaultMiddleware: boolean,
    providerManager: ProviderManager,
    context: vscode.ExtensionContext
  ) {
    super(workspaceFolder, middlewareName, isDefaultMiddleware, providerManager, context);
  }

  public get title(): string {
    return `Mapper Viewer - ${this.middlewareName}`;
  }

  public get featureName(): string {
    return 'mapper-viewer';
  }

  public initAction(featureArg: any) {
    const mapperName = featureArg as string;
    const mapperTreeProvider = this.providerManager.getMapperTreeDataProvider(this.middlewareName);
    const mapConfig = mapperTreeProvider?.getMapperConfig(mapperName);
    let filePath = path.join(this.workspaceFolder, this.fullMiddlewareName, mapConfig?.file ?? mapperName);
    if (!filePath.endsWith('.json')) {
      filePath += '.json';
    }

    try {
      this.panel?.reveal(vscode.ViewColumn.One);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      this.panel?.webview.postMessage({ command: 'fileContent', content: fileContent, mapConfig });
      vscode.commands.executeCommand('aglEssentials.highlightNode', mapperName, this.middlewareName);
    } catch (error: any) {
      this.panel?.webview.postMessage({ command: 'error', message: `Failed to read file: ${filePath}. Error: ${error.message}` });
    }
  }

  protected getMessageHandler(featureArg: any) {
    return async (message: any) => {
      if (message.command === 'webviewLoaded') {
        this.initAction(featureArg);
      } else if (message.command === 'getFileContent') {
        const mapperTreeProvider = this.providerManager.getMapperTreeDataProvider(this.middlewareName);
        const mapConfig = mapperTreeProvider?.getMapperConfig(message.mapperName);
        const filePath = path.join(this.workspaceFolder, this.fullMiddlewareName, mapConfig?.file ?? message.mapperName);
        try {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          this.panel?.webview.postMessage({ command: 'fileContent', content: fileContent, mapConfig });
          vscode.commands.executeCommand('aglEssentials.highlightNode', message.mapperName, this.middlewareName);
        } catch (error: any) {
          this.panel?.webview.postMessage({ command: 'error', message: `Failed to read file: ${filePath}. Error: ${error.message}` });
        }
      } else if (message.command === 'highlightTreeNode') {
        vscode.commands.executeCommand('aglEssentials.highlightNode', message.mapperName, this.middlewareName);
      } else if (message.command === 'openFile') {
        const filePath = path.join(this.workspaceFolder, this.fullMiddlewareName, message.filePath);
        try {
          const fileUri = vscode.Uri.file(filePath);
          await vscode.commands.executeCommand('vscode.open', fileUri);
        } catch (error: any) {
          vscode.window.showErrorMessage(`Failed to open file: ${filePath}. Error: ${error.message}`);
        }
      }
    };

  }
}