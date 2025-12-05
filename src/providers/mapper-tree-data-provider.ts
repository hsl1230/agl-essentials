import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FeatureNode } from '../models/feature-node';
import { MapperConfig } from '../models/mapper-config';
import { TreeDataProvider } from './tree-data-provider';

export class MapperTreeDataProvider extends TreeDataProvider {
    private mapperMap: Map<string, MapperConfig> = new Map();

    constructor(private workspaceFolder: string, public readonly middlewareName: string) {
        super();
        this.loadData();
    }

    public get providerName(): string {
        return 'Mappers';
    }

    protected loadData() {
        const autoMapperConfigPath = path.join(this.workspaceFolder, `agl-config-${this.middlewareName}/files/autoMapperConfig.json`);
        try {
            const config = JSON.parse(fs.readFileSync(autoMapperConfigPath, 'utf-8'));
            this.buildMapperMap(config.mapConfigs); // Populate mapperMap with mapper data
            this.buildMapperTree(config.mapConfigs); // Build the tree structure
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load mapper tree: ${error.message}`);
        }
    }

    public getMapperConfig(mapperName: string): MapperConfig | undefined {
        return this.mapperMap.get(mapperName);
    }

    private buildMapperMap(mapConfigs: any[]) {
        let fullMiddlewareName = `agl-${this.middlewareName}-middleware`;
        for (const mapConfig of mapConfigs) {
            let mapConfigFilePath = path.join(this.workspaceFolder, fullMiddlewareName, mapConfig.file);
            if (!mapConfigFilePath.endsWith('.json')) {
                mapConfigFilePath += '.json';
            }    

            try {
                const mapper = JSON.parse(fs.readFileSync(mapConfigFilePath, 'utf-8'));
                this.mapperMap.set(mapConfig.name, { ...mapConfig, mapper });
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to load mapper file: ${mapConfig.file}. Error: ${error.message}`);
            }
        }
    }

    private buildMapperTree(mapConfigs: any[]) {
        const findNestedMappers = (mapper: any): string[] => {
            const nestedMappers: string[] = [];
            const findItems = (obj: any) => {
                for (const key in obj) {
                    if (obj.hasOwnProperty(key)) {
                        if (key === 'items' && typeof obj[key] === 'string' && obj[key] !== '$original') {
                            nestedMappers.push(obj[key]);
                        } else if (typeof obj[key] === 'object') {
                            findItems(obj[key]);
                        }
                    }
                }
            };
            findItems(mapper);
            return nestedMappers;
        };

        const buildTree = (mapConfig: any): FeatureNode => {
            const treeNode: FeatureNode = {
                name: mapConfig.name,
                filePath: mapConfig.file,
                command: 'aglEssentials.openMapperViewer',
                arguments: [mapConfig.name, this.middlewareName],
                children: []
            };
            const mapperConfig = this.mapperMap.get(mapConfig.name);
            if (!mapperConfig || !mapperConfig.mapper) {
                return treeNode;
            }
            const nestedMappers = findNestedMappers(mapperConfig.mapper);
            for (const nestedMapperName of nestedMappers) {
                if (this.mapperMap.has(nestedMapperName)) {
                    treeNode.children.push(buildTree(this.mapperMap.get(nestedMapperName)!));
                }
            }
            return treeNode;
        };

        this.treeData = { name: 'Root', children: [] };
        for (const mapConfig of mapConfigs) {
            if (!this.treeData.children.some(child => child.name === mapConfig.name)) {
                this.treeData.children.push(buildTree(mapConfig));
            }
        }

        function foundInTreeNode(mapperName: string, treeNode: FeatureNode): boolean {
            if (treeNode.name === mapperName) {
                return true;
            }
            for (const child of treeNode.children) {
                if (foundInTreeNode(mapperName, child)) {
                    return true;
                }
            }
            return false;
        }

        const rootMappers: FeatureNode[] = [];
        this.treeData.children.forEach((mapper, index) => {
            const parentMappers = this.treeData.children.filter((child, i) => i !== index && foundInTreeNode(mapper.name, child));
            if (!parentMappers || parentMappers.length === 0) {
                rootMappers.push(mapper);
            }
        });

        this.treeData.children = rootMappers;
    }

    private async expandParentNodes(treeView: vscode.TreeView<FeatureNode>, targetNode: FeatureNode): Promise<void> {
        try {
            await treeView.reveal(targetNode, { expand: 3, select: false, focus: false });
        } catch (error: any) {
            console.error(`Failed to expand parent nodes for ${targetNode.name}: ${error.message}`);
        }
    }

    // New method to highlight all tree nodes related to a mapperName
    public async highlightTreeNodes(mapperName: string, treeView?: vscode.TreeView<FeatureNode>) {
        if (!treeView) {
            console.error('TreeView is not defined.');
            return;
        }

        // Clear previous highlights
        const matchingNodes: FeatureNode[] = [];
        this.findAllTreeNodes(this.treeData, mapperName, matchingNodes);

        // Trigger a refresh for all matching nodes
        for (const node of matchingNodes) {
            node.isHighlighted = true; 
            await this.expandParentNodes(treeView, node);
        }
        this.fire();
    }

    // Helper method to find all tree nodes by name
    private findAllTreeNodes(tree: FeatureNode, name: string, result: FeatureNode[]) {
        if (tree.name === name) {
            result.push(tree);
        } else {
            tree.isHighlighted = false;
        }
        for (const child of tree.children) {
            this.findAllTreeNodes(child, name, result);
        }
    }
}

