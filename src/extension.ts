import * as fs from 'fs';
import * as vscode from 'vscode';
import { activateConfig } from './activate-config';
import { activateDefaultMappersAndEndpoints } from './activate-default-mappers-endpoints';
import { activateMiddleware } from './activate-middleware';
import { HighlightDecorationProvider } from './providers/highlight-decoration-provider';
import { CommandService } from './services/command-service';
import { ProviderManager } from './services/provider-manager';
import { ViewManager } from './services/view-manager';
import { CONFIG_PREFIX, MIDDLEWARE_ORDER } from './shared';

/**
 * Discover middleware configurations in the workspace
 * @param root - The workspace root folder
 * @returns Array of middleware names (without the agl-config- prefix)
 */
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
    providerManager.setExtensionContext(context);

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
    
    // Sort middlewares by preferred order
    const sortedMiddlewareNames = MIDDLEWARE_ORDER.filter(name => middlewareNames.includes(name));
    const middlewareName = sortedMiddlewareNames[0] || middlewareNames[0];

    const commandService = new CommandService(workspaceFolder, providerManager, context);

    // Activate features
    const middlewareService = activateMiddleware(workspaceFolder, middlewareName);
    const templateService = activateConfig('template');
    const nanoConfigService = activateConfig('nanoConfigKey');
    const panicConfigService = activateConfig('panicConfigKey');

    activateDefaultMappersAndEndpoints(viewManager, providerManager, workspaceFolder, middlewareName);

    // Register commands
    commandService.registerCommands(viewManager, providerManager);

    context.subscriptions.push(
        viewManager,
        providerManager,
        commandService,
        middlewareService,
        templateService,
        nanoConfigService,
        panicConfigService
    );
}

export function deactivate() { }