import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { MapperTreeDataProvider } from '../providers/mapper-tree-data-provider';
import { ProviderManager } from './provider-manager';

export class FeatureViewerManager {
    private featurePanelMap: Map<string, vscode.WebviewPanel> = new Map();

    constructor(
        private workspaceFolder: string,
        private defaultMiddlewareName: string,
        private context: vscode.ExtensionContext,
        private providerManager: ProviderManager
    ) {
    }

    public openFeatureViewer(featureName: string, featureArg: any, middlewareName: string) {
        const workspaceFolder = this.workspaceFolder;
        // If the panel already exists, reveal it and return
        const thePanel = this.featurePanelMap.get(`${featureName}-${middlewareName}`);
        const mapperTreeProvider = this.providerManager.getMapperTreeDataProvider(middlewareName);
        if (!mapperTreeProvider) {
            vscode.window.showErrorMessage(`Mapper tree provider not found for middleware: ${middlewareName}`);
            return;
        }

        let fullMiddlewareName = 'agl-custom-middleware';
        if (middlewareName !== this.defaultMiddlewareName) {
            fullMiddlewareName = `agl-${middlewareName}-middleware`;
        }

        if (thePanel) {
            const panel = thePanel;
            panel.reveal(vscode.ViewColumn.One);
            // If a template name is provided, pass it to the Webview
            if (featureName === 'mapper-viewer' && featureArg) {
                const mapperName = featureArg as string;
                const mapConfig = mapperTreeProvider.getMapperConfig(mapperName);
                let filePath = path.join(workspaceFolder, fullMiddlewareName, mapConfig?.file ?? mapperName);
                if (!filePath.endsWith('.json')) {
                    filePath += '.json';
                }    
    
                try {
                    const fileContent = fs.readFileSync(filePath, 'utf8');
                    panel.webview.postMessage({ command: 'fileContent', content: fileContent, mapConfig });
                    vscode.commands.executeCommand('aglEssentials.highlightNode', mapperName, middlewareName);
                } catch (error: any) {
                    panel.webview.postMessage({ command: 'error', message: `Failed to read file: ${filePath}. Error: ${error.message}` });
                }
            } else if (featureName === 'endpoint-viewer') {
                const endpointConfig = featureArg;
                panel.webview.postMessage({ command: 'endpointConfig', content: endpointConfig });
            }
            return;
        }

        // Create the webview panel
        const panel = vscode.window.createWebviewPanel(
            featureName,
            featureName === 'mapper-viewer' ? `Mapper Viewer - ${middlewareName}` : `Endpoint Viewer - ${middlewareName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true, // Retain the webview context when hidden
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'src', 'features', featureName)),
                    vscode.Uri.file(path.join(workspaceFolder, fullMiddlewareName))
                ]
            }
        );

        this.featurePanelMap.set(`${featureName}-${middlewareName}`, panel);

        // Listen for the dispose event
        panel.onDidDispose(() => {
            // Remove the panel from the map
            this.featurePanelMap.delete(`${featureName}-${middlewareName}`);

            // Perform any additional cleanup if necessary
            console.log(`${middlewareName} ${featureName} Webview panel disposed.`);
        });

        // Paths to resources
        const htmlPath = path.join(this.context.extensionPath, 'src', 'features', featureName, 'index.html');
        const cssPath = vscode.Uri.file(path.join(this.context.extensionPath, 'src', 'features', featureName, 'style.css'));
        const jsPath = vscode.Uri.file(path.join(this.context.extensionPath, 'src', 'features', featureName, 'script.js'));

        // Read and update the HTML content
        fs.readFile(htmlPath, 'utf8', (err, data) => {
            if (err) {
                vscode.window.showErrorMessage('Failed to load webview content');
                return;
            }

            // Use asWebviewUri to resolve local resources
            const cssUri = panel.webview.asWebviewUri(cssPath);
            const jsUri = panel.webview.asWebviewUri(jsPath);

            // Replace placeholders in the HTML
            let updatedHtml = data
                .replace(/<link rel="stylesheet" href="style\.css">/, `<link rel="stylesheet" href="${cssUri}">`)
                .replace(/<script src="script\.js"><\/script>/, `<script src="${jsUri}"></script>`);

            // Set the updated HTML to the webview
            panel.webview.html = updatedHtml;
        });

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(this.getMessageHandler(featureName, workspaceFolder, panel, featureArg, middlewareName, mapperTreeProvider, fullMiddlewareName));
    }

    // Helper method to get the appropriate message handler for the feature
    private getMessageHandler(
        featureName: string, 
        workspaceFolder: string, 
        panel: vscode.WebviewPanel, 
        featureArg: any,
        middlewareName: string, 
        mapperTreeProvider: MapperTreeDataProvider, 
        fullMiddlewareName: string
    ) {
        if (featureName === 'mapper-viewer') {
            return async (message: any) => {
                if (message.command === 'webviewLoaded') {
                    const mapperName = featureArg as string;
                    const mapConfig = mapperTreeProvider.getMapperConfig(mapperName);
                    let filePath = path.join(workspaceFolder, fullMiddlewareName, mapConfig?.file ?? mapperName);
                    if (!filePath.endsWith('.json')) {
                        filePath += '.json';
                    }    
    
                    try {
                        const fileContent = fs.readFileSync(filePath, 'utf8');
                        panel.webview.postMessage({ command: 'fileContent', content: fileContent, mapConfig });
                        vscode.commands.executeCommand('aglEssentials.highlightNode', mapperName, middlewareName);
                    } catch (error: any) {
                        panel.webview.postMessage({ command: 'error', message: `Failed to read file: ${filePath}. Error: ${error.message}` });
                    }
                } else if (message.command === 'getFileContent') {
                    const mapConfig = mapperTreeProvider.getMapperConfig(message.mapperName);
                    const filePath = path.join(workspaceFolder, fullMiddlewareName, mapConfig?.file ?? message.mapperName);
                    try {
                        const fileContent = fs.readFileSync(filePath, 'utf8');
                        panel.webview.postMessage({ command: 'fileContent', content: fileContent, mapConfig });
                        vscode.commands.executeCommand('aglEssentials.highlightNode', message.mapperName, middlewareName);
                    } catch (error: any) {
                        panel.webview.postMessage({ command: 'error', message: `Failed to read file: ${filePath}. Error: ${error.message}` });
                    }
                } else if (message.command === 'highlightTreeNode') {
                    vscode.commands.executeCommand('aglEssentials.highlightNode', message.mapperName, middlewareName);
                } else if (message.command === 'openFile') {
                    const filePath = path.join(workspaceFolder, fullMiddlewareName, message.filePath);
                    try {
                        const fileUri = vscode.Uri.file(filePath);
                        await vscode.commands.executeCommand('vscode.open', fileUri);
                    } catch (error: any) {
                        vscode.window.showErrorMessage(`Failed to open file: ${filePath}. Error: ${error.message}`);
                    }
                }
            };
        } else if (featureName === 'endpoint-viewer') {
            return async (message: any) => {
                if (message.command === 'webviewLoaded') {
                    const endpointConfig = featureArg;
                    panel.webview.postMessage({ command: 'endpointConfig', content: endpointConfig });
                } else if (message.command === 'openMiddlewareFile') {
                    try {
                        let fullPath = path.join(workspaceFolder, fullMiddlewareName, `${message.middlewarePath}.js`);
                        if (!fs.existsSync(fullPath)) {
                            fullPath = path.join(workspaceFolder, fullMiddlewareName, `${message.middlewarePath}/index.js`);
                        }
                        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(fullPath));
                    } catch (error: any) {
                        panel.webview.postMessage({ command: 'error', message: `Failed to open the middleware ${message.middlewarePath}: ${error.message}` });
                    }
                } else if (message.command === 'openMapperViewer') {
                    console.log('Open mapper viewer', message.mapperName);
                    this.openFeatureViewer('mapper-viewer', message.mapperName, middlewareName);
                    vscode.commands.executeCommand('aglEssentials.highlightNode', message.mapperName, middlewareName);
                }
            };
        }
        return async () => { }; // Default no-op handler
    }
}
