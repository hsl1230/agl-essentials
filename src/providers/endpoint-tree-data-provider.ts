import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FeatureNode } from '../models/feature-node';
import { CONFIG_PREFIX } from '../shared';
import { TreeDataProvider } from './tree-data-provider';

// HTTP method icon paths
const METHOD_ICONS: Record<string, string> = {
    'GET': 'method-get.svg',
    'POST': 'method-post.svg',
    'PUT': 'method-put.svg',
    'DELETE': 'method-delete.svg',
    'PATCH': 'method-patch.svg'
};

export class EndpointTreeDataProvider extends TreeDataProvider {
    private extensionPath: string;

    constructor(
        private workspaceFolder: string, 
        public readonly middlewareName: string,
        extensionContext: vscode.ExtensionContext
    ) {
        super();
        this.extensionPath = extensionContext.extensionPath;
        this.loadData();
    }

    /**
     * Override getTreeItem to add method icons for endpoint nodes
     */
    getTreeItem(element: FeatureNode): vscode.TreeItem {
        const treeItem = super.getTreeItem(element);
        
        // Add method icon for endpoint nodes
        if (element.contextValue === 'endpointNode' && element.endpointData) {
            const method = element.endpointData.method?.toUpperCase() || '';
            const iconFile = METHOD_ICONS[method] || 'method-other.svg';
            const iconPath = path.join(this.extensionPath, 'resources', 'icons', iconFile);
            treeItem.iconPath = vscode.Uri.file(iconPath);
        }
        
        return treeItem;
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
        
        // Build endpoint nodes with parsed version info
        const endpointNodes: { node: FeatureNode; maxVersion: number; shortUri: string; method: string }[] = [];
        
        for (const endpoint of endpoints) {
            const { shortUri, versionLabel, maxVersion } = this.parseEndpointUri(endpoint.endpointUri);
            const method = endpoint.method.toUpperCase();
            
            const endpointNode: FeatureNode = {
                name: versionLabel,
                description: shortUri,
                children: [],
                command: 'aglEssentials.openEndpointDetails',
                arguments: [endpoint, this.middlewareName],
                contextValue: 'endpointNode',
                endpointData: endpoint
            };
            endpointNodes.push({ node: endpointNode, maxVersion, shortUri, method });
        }
        
        // Sort by method (GET, POST, PUT, DELETE, others), then by maxVersion descending, then by shortUri
        endpointNodes.sort((a, b) => {
            // First: sort by maxVersion descending
            if (b.maxVersion !== a.maxVersion) {
                return b.maxVersion - a.maxVersion;
            }

            // Second: sort by method priority
            const methodPriority = (method: string): number => {
                switch (method) {
                    case 'GET': return 1;
                    case 'POST': return 2;
                    case 'PUT': return 3;
                    case 'DELETE': return 4;
                    default: return 5;
                }
            };
            const methodDiff = methodPriority(a.method) - methodPriority(b.method);
            if (methodDiff !== 0) {
                return methodDiff;
            }
                        
            // Third: sort by shortUri
            return a.shortUri.localeCompare(b.shortUri);
        });
        
        this.treeData.children = endpointNodes.map(e => e.node);
    }



    /**
     * Parse endpoint URI to extract short URI, version label, and max version number
     */
    private parseEndpointUri(endpointUri: string): { shortUri: string; versionLabel: string; maxVersion: number } {
        // Extract version pattern
        const versionMatch = endpointUri.match(/:appversion\(([^)]+)\)/);
        const versionPattern = versionMatch ? versionMatch[1] : '';
        
        // Parse version to get label and max version number
        const { versionLabel, maxVersion } = this.parseVersionPattern(versionPattern);
        
        // Extract short URI (remove common prefix parts)
        let shortUri = endpointUri
            // Remove tenant parameter
            .replace(/^\/:?tenant(\([^)]*\))?/, '')
            .replace(/^\/TELUS/, '')
            // Remove appversion parameter
            .replace(/\/:appversion\([^)]+\)/, '')
            // Remove common path parameters
            .replace(/\/:cluster/, '')
            .replace(/\/:locale/, '')
            .replace(/\/:channel/, '')
            .replace(/\/:propertyName/, '')
            // Remove /CONTENT prefix
            // .replace(/^\/CONTENT/, '')
            // Clean up leading slashes
            .replace(/^\/+/, '');
        
        // Simplify contentType patterns
        shortUri = shortUri
            .replace(/:contentType\(([^)]+)\)/, (_, types) => {
                const typeList = types.split('|');
                if (typeList.length === 1) {
                    return typeList[0];
                } else if (typeList.length <= 3) {
                    return `{${typeList.join(',')}}`;
                } else {
                    return '{media}';
                }
            })
            .replace(/:contentType/, ':type')
            .replace(/:contentId/, ':id')
            .replace(/:assetId/, ':asset')
            .replace(/:bookmarkSetId/, ':setId')
            .replace(/:uaSeriesId/, ':id');
        
        return { shortUri, versionLabel, maxVersion };
    }

    /**
     * Parse version pattern to extract display label and numeric max version
     * Supports any express.js route pattern, extracts versions in format:
     * - "T{major}.{minor}" (e.g., T7.2, T2.0)
     * - "{major}.{minor}" (e.g., 1.5, 2.0)
     * 
     * Version priority calculation: major * 10 + minor
     * e.g., T7.2 = 72, T2.0 = 20, 1.5 = 15
     */
    private parseVersionPattern(pattern: string): { versionLabel: string; maxVersion: number } {
        if (!pattern) {
            return { versionLabel: 'all', maxVersion: 100 };
        }
        
        const versions: { label: string; priority: number }[] = [];
        
        // Match version range patterns like [0-9], [2-9], \d and convert to representative versions
        // T7.[0-9] or T7.\d means T7.0 to T7.9, we use highest (T7.9 for sorting, display as T7)
        // T7.[2-9] means T7.2 to T7.9, display as T7.2+
        const rangePattern = /T(\d+)\.\[(\d)-(\d)\]/g;
        let rangeMatch;
        while ((rangeMatch = rangePattern.exec(pattern)) !== null) {
            const major = parseInt(rangeMatch[1]);
            const minDigit = parseInt(rangeMatch[2]);
            const maxDigit = parseInt(rangeMatch[3]);
            const priority = major * 10 + maxDigit;
            
            if (minDigit === 0) {
                versions.push({ label: `T${major}`, priority });
            } else {
                versions.push({ label: `T${major}.${minDigit}+`, priority });
            }
        }
        
        // Match \d pattern (e.g., T2.\d means T2.0-T2.9)
        const digitPattern = /T(\d+)\.\\d/g;
        let digitMatch;
        while ((digitMatch = digitPattern.exec(pattern)) !== null) {
            const major = parseInt(digitMatch[1]);
            const priority = major * 10 + 9; // Assume highest minor version
            // Avoid duplicates
            if (!versions.some(v => v.label === `T${major}`)) {
                versions.push({ label: `T${major}`, priority });
            }
        }
        
        // Match specific versions like T7.2, T2.0, 1.5
        // Format: T{major}.{minor} or {major}.{minor}
        const specificPattern = /(T)?(\d+)\.(\d+)/g;
        let specificMatch;
        while ((specificMatch = specificPattern.exec(pattern)) !== null) {
            const hasT = !!specificMatch[1];
            const major = parseInt(specificMatch[2]);
            const minor = parseInt(specificMatch[3]);
            
            // Skip if this is part of a range pattern we already processed
            const matchStart = specificMatch.index;
            const beforeChar = pattern[matchStart - 1];
            if (beforeChar === '[' || beforeChar === '\\') {
                continue;
            }
            
            const label = hasT ? `T${major}.${minor}` : `${major}.${minor}`;
            const priority = hasT ? major * 10 + minor : major * 10 + minor;
            
            // Avoid duplicates and skip if we already have a range that covers this
            const existingRange = versions.find(v => 
                v.label === `T${major}` || v.label.startsWith(`T${major}.`) && v.label.endsWith('+')
            );
            if (!existingRange && !versions.some(v => v.label === label)) {
                versions.push({ label, priority });
            }
        }
        
        // Sort versions by priority descending (highest version first)
        versions.sort((a, b) => b.priority - a.priority);
        
        // If no versions detected, return 'all' with highest priority
        if (versions.length === 0) {
            return { versionLabel: 'all', maxVersion: 100 };
        }
        
        return { 
            versionLabel: versions.map(v => v.label).join(','),
            maxVersion: versions[0].priority
        };
    }
}