import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FeatureNode } from '../models/feature-node';
import { CONFIG_PREFIX } from '../shared';
import { TreeDataProvider } from './tree-data-provider';

export class EndpointTreeDataProvider extends TreeDataProvider {
    constructor(
        private workspaceFolder: string, 
        public readonly middlewareName: string
    ) {
        super();
        this.loadData();
    }

    public get providerName(): string { 
        return 'Endpoints';
    }

    protected loadData(): void {
        const customRoutesPath = path.join(
            this.workspaceFolder, 
            `${CONFIG_PREFIX}${this.middlewareName}`,
            'files',
            'customRoutes.json'
        );
        
        try {
            const config = JSON.parse(fs.readFileSync(customRoutesPath, 'utf-8'));
            this.buildEndpointTree(config);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load endpoint tree: ${error.message}`);
        }
    }

    private buildEndpointTree(endpoints: any[]): void {
        this.treeData = { name: 'Root', children: [] };
        
        for (const endpoint of endpoints) {
            const shortUri = this.formatEndpointUri(endpoint.endpointUri);
            
            const endpointNode: FeatureNode = {
                name: `${endpoint.method.toUpperCase()} ${shortUri}`,
                children: [],
                command: 'aglEssentials.openEndpointDetails',
                arguments: [endpoint, this.middlewareName],
                contextValue: 'endpointNode',
                endpointData: endpoint
            };
            this.treeData.children.push(endpointNode);
        }
    }

    /**
     * Format endpoint URI for display
     * Extracts app version and creates a shorter display name
     */
    private formatEndpointUri(endpointUri: string): string {
        const uriParts = endpointUri.split('/:propertyName');
        const appVersionMatch = uriParts[0].match(/:appversion\(([^)]+)\)/);
        const appVersionValue = appVersionMatch ? appVersionMatch[1] : null;

        let shortUri = uriParts[1];
        if (!shortUri) {
            shortUri = endpointUri.split(/\/:appversion\([^)]+\)/)[1];
        }

        if (appVersionValue) {
            return `/(${appVersionValue})${shortUri}`;
        }
        return endpointUri;
    }
}