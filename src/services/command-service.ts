import * as fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { FeatureViewerManager } from './feature-viewer-manager';
import { ProviderManager } from './provider-manager';
import { ViewManager } from './view-manager';

export class CommandService {
    private featureViewerManager: FeatureViewerManager;

    private disposables: vscode.Disposable[] = [];

    constructor(private workspaceFolder: string, defaultMiddlewareName: string, providerManager: ProviderManager, context: vscode.ExtensionContext) {
        this.featureViewerManager = new FeatureViewerManager(workspaceFolder, defaultMiddlewareName, context, providerManager);
    }

    registerCommands(viewManager: ViewManager, providerManager: ProviderManager) {
        this.disposables.push(
            vscode.commands.registerCommand('aglEssentials.loadMiddleware', (middlewareName) => {
                if (viewManager.exists(`aglMappers-${middlewareName}`)) {
                    vscode.window.showInformationMessage(`${middlewareName} Mappers is already loaded.`);
                    return;
                }
                // Register Mapper Tree
                const mapperTreeDataProvider = providerManager.createMapperTreeDataProvider(this.workspaceFolder, middlewareName, false);
                viewManager.createView(`aglMappers-${middlewareName}`, mapperTreeDataProvider);

                if (viewManager.exists(`aglEndpoints-${middlewareName}`)) {
                    vscode.window.showInformationMessage(`${middlewareName} Endpoints is already loaded.`);
                    return;
                }
                // Register Endpoint Tree
                const endpointTreeDataProvider = providerManager.createEndpointTreeDataProvider(this.workspaceFolder, middlewareName);
                viewManager.createView(`aglEndpoints-${middlewareName}`, endpointTreeDataProvider);
            }),
            vscode.commands.registerCommand('aglEssentials.openMapperViewer', (mapperName, middlewareName) => {
                this.featureViewerManager.openFeatureViewer('mapper-viewer', mapperName, middlewareName);
            }),
            vscode.commands.registerCommand('aglEssentials.openEndpointDetails', (endpoint, middlewareName) => {
                this.featureViewerManager.openFeatureViewer('endpoint-viewer', endpoint, middlewareName);
            }),
            vscode.commands.registerCommand('aglEssentials.highlightNode', (mapperName: string, middlewareName) => {
                const mapperTreeDataProvider = providerManager.getMapperTreeDataProvider(middlewareName);
                mapperTreeDataProvider?.highlightTreeNodes(mapperName, viewManager.getView(`aglMappers-${middlewareName}`));
            }),
            vscode.commands.registerCommand('aglEssentials.goToUnitTestFile', async (uri: vscode.Uri) => {
                console.log('#### uri:', uri);
                if (!uri) {
                    vscode.window.showErrorMessage('No file selected.');
                    return;
                }

                // Get the current file path
                const currentFilePath = uri.fsPath;

                // Derive the unit test file path
                const testFilePath = deriveTestFilePath(currentFilePath);
                console.log('#### testFilePath:', testFilePath);
                if (!testFilePath) {
                    vscode.window.showErrorMessage('Failed to derive test file path.');
                    return;
                }

                // Check if the test file exists
                if (fs.existsSync(testFilePath)) {
                    // Open the test file in the editor
                    const fileUri = vscode.Uri.file(testFilePath);
                    await vscode.commands.executeCommand('vscode.open', fileUri);
                } else {
                    vscode.window.showErrorMessage(`Test file not found: ${testFilePath}`);
                }
            })
        );
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}

// Helper function to derive the unit test file path
function deriveTestFilePath(filePath: string): string {
    const dirName = path.dirname(filePath);
    const baseName = path.basename(filePath, '.js'); // Remove ".js" extension
    let testDir = '';

    const aglApps = ['proxy', 'content', 'main', 'mediaroom', 'page-composition', 'user', 'plus', 'safetynet', 'recording', 'stub', 'custom'];
    const aglLibs = ['agl-core', 'agl-logger', 'agl-utils', 'agl-gulp', 'agl-cache'];
    aglApps.forEach(app => {
        if (dirName.includes(`\/agl-${app}-middleware\/`)) {
            testDir = dirName.replace(`\/agl-${app}-middleware\/`, `\/agl-${app}-middleware\/test\/`);
        } else if (dirName.includes(`\\agl-${app}-middleware\\`)) {
            testDir = dirName.replace(`\\agl-${app}-middleware\\`, `\\agl-${app}-middleware\\test\\`);
        }
    });

    aglLibs.forEach(lib => {
        if (dirName.includes(`\/${lib}\/`)) {
            testDir = dirName.replace(`\/${lib}\/`, `\/${lib}\/test\/`);
        } else if (dirName.includes(`\\${lib}\\`)) {
            testDir = dirName.replace(`\\${lib}\\`, `\\${lib}\\test\\`);
        }
    });

    if (!testDir) {
        return '';
    }

    // Append ".test.js" to the file name
    return path.join(testDir, `${baseName}.test.js`);
}
