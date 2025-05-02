import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { activateDefaultMappersAndEndpoints } from './activate-default-mappers-endpoints';
import { activateMiddleware } from './activate-middleware';
import { activateTemplate } from './activate-template';
import { HighlightDecorationProvider } from './providers/highlight-decoration-provider';
import { CommandService } from './services/command-service';
import { ProviderManager } from './services/provider-manager';
import { ViewManager } from './services/view-manager';

export function activate(context: vscode.ExtensionContext) {
    const highlightDecorationProvider = new HighlightDecorationProvider();
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(highlightDecorationProvider)
    );

    const viewManager = new ViewManager(context);
    const providerManager = new ProviderManager();

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder is open.');
        return;
    }

    const middlewareFilePath = path.join(workspaceFolder, '.custom-middleware-name');
    let middlewareName = '';
    try {
        middlewareName = fs.readFileSync(middlewareFilePath, 'utf8').trim();
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to read middleware name: ${error.message}`);
        return;
    }

    const commandService = new CommandService(workspaceFolder, middlewareName, providerManager, context);

    activateDefaultMappersAndEndpoints(viewManager, providerManager, workspaceFolder, middlewareName);    
    activateMiddleware(workspaceFolder, middlewareName);
    activateTemplate('template');

    // Register commands
    commandService.registerCommands(viewManager, providerManager);

    context.subscriptions.push(
        viewManager,
        providerManager,
        commandService
    );
}

export function deactivate() { }