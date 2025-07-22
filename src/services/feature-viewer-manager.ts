import * as vscode from 'vscode';
import { AbstractPanel } from '../webview-panels/abstract-panel';
import { EndpointPanel } from '../webview-panels/endpoint-panel';
import { JsonConfigPanel } from '../webview-panels/json-config-panel';
import { MapperPanel } from '../webview-panels/mapper-panel';
import { ProviderManager } from './provider-manager';

export class FeatureViewerManager {
    private featurePanelMap: Map<string, AbstractPanel> = new Map();

    constructor(
        private workspaceFolder: string,
        private defaultMiddlewareName: string,
        private context: vscode.ExtensionContext,
        private providerManager: ProviderManager
    ) {
    }

    private createPanel(featureName: string, middlewareName: string): AbstractPanel {
        switch (featureName) {
            case 'mapper-viewer':
                return new MapperPanel(this.workspaceFolder, middlewareName, middlewareName === this.defaultMiddlewareName, this.providerManager, this.context);
            case 'endpoint-viewer':
                return new EndpointPanel(this.workspaceFolder, middlewareName, middlewareName === this.defaultMiddlewareName, this.context, this);
            case 'mware-config':
                return new JsonConfigPanel(this.workspaceFolder, middlewareName, middlewareName === this.defaultMiddlewareName, 'mWareConfig', this.context);
            case 'custom-panic-config':
                return new JsonConfigPanel(this.workspaceFolder, middlewareName, middlewareName === this.defaultMiddlewareName, 'customPanicConfig', this.context);
            default:
                throw new Error(`Unknown feature name: ${featureName}`);
        }
    }

    openFeatureViewer(featureName: string, featureArg: any, middlewareName: string) {
        let thePanel = this.featurePanelMap.get(`${featureName}-${middlewareName}`);
        if (thePanel) {
            thePanel.createPanel();
            thePanel.initAction(featureArg);
            return;
        }

        thePanel = this.createPanel(featureName, middlewareName);
        thePanel.createPanel();

        // Listen for the dispose event
        thePanel?.onDidDispose(() => {
            this.featurePanelMap.delete(`${featureName}-${middlewareName}`);
        });

        this.featurePanelMap.set(`${featureName}-${middlewareName}`, thePanel);
        
        thePanel.registerOnDidReceiveMessage(featureArg);
    }

    dispose() {
        this.featurePanelMap.forEach(panel => {
            panel.dispose();
        });
        this.featurePanelMap.clear();
    }
}
