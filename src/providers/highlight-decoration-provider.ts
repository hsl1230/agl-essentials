import * as vscode from 'vscode';

export class HighlightDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
    readonly onDidChangeFileDecorations = this._onDidChange.event;

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme === 'aglEssentials-highlighted') {
            return {
                badge: '★',
                tooltip: 'Highlighted Node',
                color: new vscode.ThemeColor('aglEssentials.treeHighlightForeground'),
                propagate: false
            };
        }
        return undefined;
    }

    refresh(uri?: vscode.Uri) {
        this._onDidChange.fire(uri || []);
    }
}