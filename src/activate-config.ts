/**
 * Config Link Activation
 * Provides clickable config links (template, nanoConfigKey, panicConfigKey) in customRoutes.json files
 */
import * as vscode from 'vscode';
import { DecorationMatch, TextDecorationService } from './services/text-decoration-service';
import { getMiddlewareNameFromPath } from './shared';

/** Config types that can be activated */
type ConfigType = 'template' | 'nanoConfigKey' | 'panicConfigKey';

/** Mapping of config types to VS Code commands */
const CONFIG_COMMANDS: Record<ConfigType, string> = {
  template: 'aglEssentials.openMapperViewer',
  nanoConfigKey: 'aglEssentials.openMWareConfig',
  panicConfigKey: 'aglEssentials.openCustomPanicConfig'
};

/** State tracker for middleware loading */
let currentLoadedMiddleware: string | undefined;

/**
 * Activates config link functionality for a specific config type
 * @param configName - The config property name to create links for
 * @returns A disposable service
 */
export function activateConfig(configName: ConfigType): vscode.Disposable {
  const service = new TextDecorationService({
    filePattern: 'customRoutes.json',
    
    getMatches(document: vscode.TextDocument): DecorationMatch[] {
      const text = document.getText();
      const regex = new RegExp(`"${configName}":\\s*"([^"]+)"`, 'g');
      const matches: DecorationMatch[] = [];
      
      let match;
      while ((match = regex.exec(text)) !== null) {
        const value = match[1];
        const valueIndex = match[0].lastIndexOf(value);
        const startPos = document.positionAt(match.index + valueIndex);
        const endPos = document.positionAt(match.index + valueIndex + value.length);
        
        matches.push({
          range: new vscode.Range(startPos, endPos),
          value,
          hoverMessage: `Click to open the ${configName}: ${value}`
        });
      }
      
      // Auto-load middleware when opening config files
      const fileName = document.fileName;
      if (fileName.endsWith('customRoutes.json') || fileName.endsWith('autoMapperConfig.json')) {
        const middlewareName = getMiddlewareNameFromPath(fileName);
        if (middlewareName && middlewareName !== currentLoadedMiddleware) {
          vscode.commands.executeCommand('aglEssentials.loadMiddleware', middlewareName);
          currentLoadedMiddleware = middlewareName;
        }
      }
      
      return matches;
    },
    
    onClick(configValue: string, document: vscode.TextDocument): void {
      const middlewareName = getMiddlewareNameFromPath(document.fileName);
      if (!configValue || !middlewareName) {
        return;
      }
      
      const command = CONFIG_COMMANDS[configName];
      if (command) {
        vscode.commands.executeCommand(command, configValue, middlewareName);
      }
    }
  });
  
  return service;
}