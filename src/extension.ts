import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { activateMiddleware } from './activate-middleware';
import { activateTemplate } from './activate-template';
import { CommandService } from './services/command-service';
import { ProviderManager } from './services/provider-manager';
import { ViewManager } from './services/view-manager';

export function activate(context: vscode.ExtensionContext) {
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

    // Register Mapper Tree
    const defaultMapperTreeDataProvider = providerManager.createMapperTreeDataProvider(workspaceFolder, middlewareName, true);
    viewManager.createView(`aglMappers-${middlewareName}`, defaultMapperTreeDataProvider);

    // Register Endpoint Tree
    const defaultEndpointTreeDataProvider = providerManager.createEndpointTreeDataProvider(workspaceFolder, middlewareName);
    viewManager.createView(`aglEndpoints-${middlewareName}`, defaultEndpointTreeDataProvider);
    
    // Register the tree data provider

    // Register commands
    commandService.registerCommands(viewManager, providerManager);

    context.subscriptions.push(
        viewManager,
        providerManager,
        commandService
    );

    activateMiddleware(workspaceFolder, middlewareName);
    activateTemplate('template');
}

export function deactivate() { }