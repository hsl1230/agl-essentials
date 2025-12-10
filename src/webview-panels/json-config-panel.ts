import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CONFIG_PREFIX } from '../shared/constants';
import { AbstractPanel } from './abstract-panel';

export class JsonConfigPanel extends AbstractPanel {
  private configMap: Map<string, object> = new Map();
  constructor(
    workspaceFolder: string,
    middlewareName: string,
    private readonly configFileName: string,
    context: vscode.ExtensionContext
  ) {
    super(workspaceFolder, middlewareName, context);
  }

  public get title(): string {
    return `${this.configFileName} - ${this.middlewareName}`;
  }

  public get featureName(): string {
    return 'mapper-viewer';
  }

  private getConfig() {
    const configKey = `${this.middlewareName}-${this.configFileName}`;
    if (this.configMap.has(configKey)) {
      return this.configMap.get(configKey);
    }

    const filePath = path.join(this.workspaceFolder, `${CONFIG_PREFIX}${this.middlewareName}/files/${this.configFileName}.json`);
    try {
      const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      this.configMap.set(configKey, config);
      return config;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to load config file ${configKey}: ${error.message}`);
    }
  }

  public initAction(featureArg: any) {
    const configName = featureArg as string;

    const config = this.getConfig();
    if (!config) {
      return;
    }

    const filePath = `${CONFIG_PREFIX}${this.middlewareName}/files/${this.configFileName}.json`;

    this.panel?.reveal(vscode.ViewColumn.One);
    const fileContent = JSON.stringify(config[configName]);

    const mapConfig = { file: filePath };
    this.panel?.webview.postMessage({ command: 'fileContent', content: fileContent, mapConfig });
  }

  protected getMessageHandler(featureArg: any) {
    return async (message: any) => {
      if (message.command === 'webviewLoaded') {
        this.initAction(featureArg);
      } else if (message.command === 'openFile') {
        const filePath = path.join(this.workspaceFolder, message.filePath);
        try {
          const fileUri = vscode.Uri.file(filePath);
          const doc = await vscode.workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: true });
        } catch (error: any) {
          vscode.window.showErrorMessage(`Failed to open file: ${filePath}. Error: ${error.message}`);
        }
      }
    };
  }
}