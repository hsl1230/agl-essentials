import * as vscode from 'vscode';
import { FeatureNode } from '../models/feature-node';

export abstract class TreeDataProvider implements vscode.TreeDataProvider<FeatureNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<FeatureNode | undefined | void> = new vscode.EventEmitter<FeatureNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<FeatureNode | undefined | void> = this._onDidChangeTreeData.event;
    protected treeData: FeatureNode = { name: 'Root', children: [] }; // Initialize with an empty tree

    abstract get middlewareName(): string;
    abstract get providerName(): string;

    getTreeItem(element: FeatureNode): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(
            element.name,
            element.children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );

        if (element.command) {
            treeItem.command = {
                command: element.command,
                title: element.name,
                arguments: element.arguments
            };
        }

        // Set a custom context value for highlighted nodes
        treeItem.contextValue = element.isHighlighted ? "highlightedNode" : "normalNode";

        return treeItem;
    }

    getChildren(element?: FeatureNode): FeatureNode[] | Thenable<FeatureNode[]> {
        if (element) {
            return element.children;
        } else {
            return this.treeData.children;
        }
    }

    fire(node?: FeatureNode) {
        this._onDidChangeTreeData.fire(node);
    }

    dispose() {
        this._onDidChangeTreeData.dispose();
    }
}
