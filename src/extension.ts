import * as fs from 'fs';
import * as vscode from 'vscode';
import { activateConfig } from './activate-config';
import { activateDefaultMappersAndEndpoints } from './activate-default-mappers-endpoints';
import { activateMiddleware } from './activate-middleware';
import { HighlightDecorationProvider } from './providers/highlight-decoration-provider';
import { CommandService } from './services/command-service';
import { ProviderManager } from './services/provider-manager';
import { ViewManager } from './services/view-manager';

const CONFIG_PREFIX = 'agl-config-';

function discoverMiddlewares(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(CONFIG_PREFIX))
      .map((entry) => entry.name.slice(CONFIG_PREFIX.length))
      .filter((name) => name.length > 0 && name !== 'common');
  } catch (error) {
    console.error('Failed to read middleware directories', error);
    return [];
  }
}

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

    const middlewareNames = discoverMiddlewares(workspaceFolder);
    // middlewareNames now contains ['proxy', 'content', ...] for every agl-config-<middleware> dir
    // Middlewares loaded for quick pick

    if (middlewareNames.length === 0) {
        vscode.window.showWarningMessage('No AGL middleware configurations found in the workspace.');
        return;
    }
    
    const middlewareOrder = ['page-composition', 'content', 'recording', 'proxy', 'plus', 'stub', 'mediaroom', 'user', 'proxy', 'main', 'safetynet'];

    const sortedMiddlewareNames = middlewareOrder.filter(name => middlewareNames.includes(name));

    let middlewareName = sortedMiddlewareNames[0]

    const commandService = new CommandService(workspaceFolder, providerManager, context);

    activateDefaultMappersAndEndpoints(viewManager, providerManager, workspaceFolder, middlewareName);    
    activateMiddleware(workspaceFolder, middlewareName);
    activateConfig('template');
    activateConfig('nanoConfigKey');
    activateConfig('panicConfigKey');

    // Register commands
    commandService.registerCommands(viewManager, providerManager);

    context.subscriptions.push(
        viewManager,
        providerManager,
        commandService
    );
}

export function deactivate() { }