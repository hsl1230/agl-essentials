import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getFullMiddlewareName } from '../shared';

/**
 * Abstract base class for webview panels
 * Provides common functionality for creating and managing webview panels
 */
export abstract class AbstractPanel implements vscode.Disposable {
  protected panel: vscode.WebviewPanel | undefined;

  constructor(
    public readonly workspaceFolder: string,
    public readonly middlewareName: string,
    public readonly context: vscode.ExtensionContext
  ) {}

  /** Panel title displayed in the tab */
  public abstract get title(): string;

  /** Feature name used for resource paths */
  public abstract get featureName(): string;

  /** Full middleware directory name */
  public get fullMiddlewareName(): string {
    return getFullMiddlewareName(this.middlewareName);
  }

  /** Initialize the panel with feature-specific data */
  public abstract initAction(featureArg: any): void;

  /**
   * Create or reveal the webview panel
   */
  public createPanel(): vscode.WebviewPanel {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
      return this.panel;
    }

    const resourcePath = path.join(this.context.extensionPath, 'resources', 'features', this.featureName);
    const middlewarePath = path.join(this.workspaceFolder, this.fullMiddlewareName);

    const panel = vscode.window.createWebviewPanel(
      this.featureName,
      this.title,
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(resourcePath),
          vscode.Uri.file(middlewarePath)
        ]
      }
    );

    panel.webview.html = this.getWebviewContent(panel, resourcePath);
    this.panel = panel;
    return panel;
  }

  /**
   * Generate the webview HTML content
   */
  private getWebviewContent(panel: vscode.WebviewPanel, resourcePath: string): string {
    const htmlPath = path.join(resourcePath, 'index.html');
    const cssPath = vscode.Uri.file(path.join(resourcePath, 'style.css'));
    const jsPath = vscode.Uri.file(path.join(resourcePath, 'script.js'));

    let html = fs.readFileSync(htmlPath, 'utf8');
    return html
      .replace('{{styleUri}}', panel.webview.asWebviewUri(cssPath).toString())
      .replace('{{scriptUri}}', panel.webview.asWebviewUri(jsPath).toString());
  }

  /** Get the message handler for webview messages */
  protected abstract getMessageHandler(featureArg: any): (msg: any) => void;

  /**
   * Register the message handler for webview communication
   */
  public registerOnDidReceiveMessage(featureArg: any): void {
    this.panel?.webview.onDidReceiveMessage(this.getMessageHandler(featureArg));
  }

  public dispose(): void {
    this.panel?.dispose();
  }

  public onDidDispose(
    listener: (e: void) => any, 
    thisArgs?: any, 
    disposables?: vscode.Disposable[]
  ): void {
    this.panel?.onDidDispose(listener, thisArgs, disposables);
  }
}