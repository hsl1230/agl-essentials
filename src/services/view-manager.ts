import * as vscode from 'vscode';
import { FeatureNode } from '../models/feature-node';
import { TreeDataProvider } from '../providers/tree-data-provider';

export class ViewManager implements vscode.Disposable {
    private activeViews = new Map<string, vscode.TreeView<FeatureNode>>();

    constructor(private context: vscode.ExtensionContext) {}

    toggleView(viewId: string, provider: TreeDataProvider): void {
        if (this.activeViews.has(viewId)) {
            this.removeView(viewId);
        } else {
            this.createView(viewId, provider);
        }
    }

    createView(viewId: string, provider: TreeDataProvider): void {
        if (!this.activeViews.has(viewId)) {
            vscode.commands.executeCommand('setContext', `${viewId}-view-visible`, true);

            const treeView = vscode.window.createTreeView(viewId, {
                treeDataProvider: provider
            });
            treeView.title = `${provider.providerName} (${provider.middlewareName})`;
            this.activeViews.set(viewId, treeView);
            this.saveViewState();
        }
    }

    getView(viewId: string): vscode.TreeView<FeatureNode> | undefined {
        return this.activeViews.get(viewId);
    }

    exists(viewId: string): boolean {
        return this.activeViews.has(viewId);
    }

    removeView(viewId: string): void {
        vscode.commands.executeCommand('setContext', `${viewId}-view-visible`, false);

        const view = this.activeViews.get(viewId);
        if (view) {
            view.dispose();
            this.activeViews.delete(viewId);
            this.saveViewState();
        }
    }

    restoreViews(providerFactory: (viewId: string) => TreeDataProvider): void {
        const storedViews = this.context.globalState.get<string[]>('activeViews', []);
        storedViews.forEach(viewId => {
            try {
                const provider = providerFactory(viewId);
                this.createView(viewId, provider);
            } catch (error) {
                console.error(`Failed to restore view ${viewId}:`, error);
            }
        });
    }

    private saveViewState(): void {
        const activeViews = Array.from(this.activeViews.keys());
        this.context.globalState.update('activeViews', activeViews);
    }

    dispose() {
        this.activeViews.forEach(view => view.dispose());
        this.activeViews.clear();
    }
}
