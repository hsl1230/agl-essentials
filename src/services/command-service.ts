import * as fs from 'fs';
import * as vscode from 'vscode';
import { deriveTestFilePath } from '../shared';
import { FeatureViewerManager } from './feature-viewer-manager';
import { ProviderManager } from './provider-manager';
import { ViewManager } from './view-manager';

export class CommandService implements vscode.Disposable {
    private featureViewerManager: FeatureViewerManager;
    private disposables: vscode.Disposable[] = [];

    constructor(
        private workspaceFolder: string, 
        providerManager: ProviderManager, 
        context: vscode.ExtensionContext
    ) {
        this.featureViewerManager = new FeatureViewerManager(workspaceFolder, context, providerManager);
    }

    registerCommands(viewManager: ViewManager, providerManager: ProviderManager) {
        this.disposables.push(
            this.registerLoadMiddlewareCommand(viewManager, providerManager),
            this.registerOpenMapperViewerCommand(),
            this.registerOpenMWareConfigCommand(),
            this.registerOpenCustomPanicConfigCommand(),
            this.registerOpenEndpointDetailsCommand(),
            this.registerAnalyzeEndpointFlowCommand(),
            this.registerHighlightNodeCommand(viewManager, providerManager),
            this.registerGoToUnitTestFileCommand()
        );
    }

    private registerLoadMiddlewareCommand(viewManager: ViewManager, providerManager: ProviderManager): vscode.Disposable {
        return vscode.commands.registerCommand('aglEssentials.loadMiddleware', (middlewareName) => {
            // Register Mapper Tree if not exists
            if (!viewManager.exists(`aglMappers-${middlewareName}`)) {
                const mapperTreeDataProvider = providerManager.createMapperTreeDataProvider(this.workspaceFolder, middlewareName);
                viewManager.createView(`aglMappers-${middlewareName}`, mapperTreeDataProvider);
            }

            // Register Endpoint Tree if not exists
            if (!viewManager.exists(`aglEndpoints-${middlewareName}`)) {
                const endpointTreeDataProvider = providerManager.createEndpointTreeDataProvider(this.workspaceFolder, middlewareName);
                viewManager.createView(`aglEndpoints-${middlewareName}`, endpointTreeDataProvider);
            }
        });
    }

    private registerOpenMapperViewerCommand(): vscode.Disposable {
        return vscode.commands.registerCommand('aglEssentials.openMapperViewer', (mapperName, middlewareName) => {
            this.featureViewerManager.openFeatureViewer('mapper-viewer', mapperName, middlewareName);
        });
    }

    private registerOpenMWareConfigCommand(): vscode.Disposable {
        return vscode.commands.registerCommand('aglEssentials.openMWareConfig', (configName, middlewareName) => {
            this.featureViewerManager.openFeatureViewer('mware-config', configName, middlewareName);
        });
    }

    private registerOpenCustomPanicConfigCommand(): vscode.Disposable {
        return vscode.commands.registerCommand('aglEssentials.openCustomPanicConfig', (configName, middlewareName) => {
            this.featureViewerManager.openFeatureViewer('custom-panic-config', configName, middlewareName);
        });
    }

    private registerOpenEndpointDetailsCommand(): vscode.Disposable {
        return vscode.commands.registerCommand('aglEssentials.openEndpointDetails', (endpoint, middlewareName) => {
            this.featureViewerManager.openFeatureViewer('endpoint-viewer', endpoint, middlewareName);
        });
    }

    private registerAnalyzeEndpointFlowCommand(): vscode.Disposable {
        return vscode.commands.registerCommand('aglEssentials.analyzeEndpointFlow', (arg1, arg2) => {
            // Support two calling patterns:
            // 1. From context menu: arg1 = FeatureNode with endpointData
            // 2. From webview/direct: arg1 = endpoint, arg2 = middlewareName
            let endpoint: any;
            let middlewareName: string;
            
            if (arg1?.endpointData) {
                // Called from context menu - arg1 is FeatureNode
                endpoint = arg1.endpointData;
                middlewareName = arg1.arguments?.[1] || arg2;
            } else {
                // Called directly with endpoint object
                endpoint = arg1;
                middlewareName = arg2;
            }
            
            if (!endpoint || !middlewareName) {
                vscode.window.showErrorMessage('Missing endpoint or middleware information');
                return;
            }
            
            this.featureViewerManager.openFeatureViewer('flow-analyzer', endpoint, middlewareName);
        });
    }

    private registerHighlightNodeCommand(viewManager: ViewManager, providerManager: ProviderManager): vscode.Disposable {
        return vscode.commands.registerCommand('aglEssentials.highlightNode', (mapperName: string, middlewareName: string) => {
            const mapperTreeDataProvider = providerManager.getMapperTreeDataProvider(middlewareName);
            mapperTreeDataProvider?.highlightTreeNodes(mapperName, viewManager.getView(`aglMappers-${middlewareName}`));
        });
    }

    private registerGoToUnitTestFileCommand(): vscode.Disposable {
        return vscode.commands.registerCommand('aglEssentials.goToUnitTestFile', async (uri: vscode.Uri) => {
            if (!uri) {
                vscode.window.showErrorMessage('No file selected.');
                return;
            }

            const testFilePath = deriveTestFilePath(uri.fsPath);
            if (!testFilePath) {
                vscode.window.showErrorMessage('Failed to derive test file path.');
                return;
            }

            if (fs.existsSync(testFilePath)) {
                await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(testFilePath));
            } else {
                vscode.window.showErrorMessage(`Test file not found: ${testFilePath}`);
            }
        });
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
