import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export abstract class AbstractPanel {
  protected panel: vscode.WebviewPanel | undefined;

  constructor(
    public readonly workspaceFolder: string,
    public readonly middlewareName: string,
    public readonly context: vscode.ExtensionContext
  ) {
  }

  public abstract get title(): string;

  public abstract get featureName(): string;

  public get fullMiddlewareName(): string {
    return `agl-${this.middlewareName}-middleware`;;
  }

  public abstract initAction(featureArg: any): void;

  public createPanel() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return this.panel;
    }

    // If the panel already exists, reveal it and return
    // Create the webview panel
    const panel = vscode.window.createWebviewPanel(
      this.featureName,
      this.title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true, // Retain the webview context when hidden
        localResourceRoots: [
          vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'features', this.featureName)),
          vscode.Uri.file(path.join(this.workspaceFolder, this.fullMiddlewareName))
        ]
      }
    );

    // Paths to resources
    const htmlPath = path.join(this.context.extensionPath, 'resources', 'features', this.featureName, 'index.html');
    const cssPath = vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'features', this.featureName, 'style.css'));
    const jsPath = vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'features', this.featureName, 'script.js'));


    let html = fs.readFileSync(htmlPath, 'utf8');

    html = html
      .replace('{{styleUri}}', panel.webview.asWebviewUri(cssPath).toString())
      .replace('{{scriptUri}}', panel.webview.asWebviewUri(jsPath).toString());

    // Read and update the HTML content
    fs.readFile(htmlPath, 'utf8', (err, data) => {
      if (err) {
        vscode.window.showErrorMessage('Failed to load webview content');
        return;
      }

      panel.webview.html = html;
    });

    this.panel = panel;
    return panel;
  }

  protected abstract getMessageHandler(featureArg: any): (msg: any) => void;

  public registerOnDidReceiveMessage(featureArg: any) {
    // Handle messages from the webview
    this.panel?.webview.onDidReceiveMessage(this.getMessageHandler(featureArg));
  }

  public dispose() {
    if (this.panel) {
      this.panel.dispose();
    }
  }

  public onDidDispose(listener: (e: void) => any, thisArgs?: any, disposables?: vscode.Disposable[]) {
    if (this.panel) {
      this.panel.onDidDispose(listener, thisArgs, disposables);
    }
  }
}