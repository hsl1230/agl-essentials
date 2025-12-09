/**
 * Middleware Link Activation
 * Provides clickable middleware links in customRoutes.json files
 */
import * as vscode from 'vscode';
import { DecorationMatch, TextDecorationService } from './services/text-decoration-service';
import { getMiddlewareNameFromPath, resolveMiddlewareFilePath } from './shared';

/**
 * Activates middleware link functionality for customRoutes.json files
 * Provides clickable links to middleware source files
 */
export function activateMiddleware(
  workspaceFolder: string, 
  _defaultMiddlewareName: string
): vscode.Disposable {
  
  const service = new TextDecorationService({
    filePattern: 'customRoutes.json',
    
    getMatches(document: vscode.TextDocument): DecorationMatch[] {
      const text = document.getText();
      const middlewareRegex = /"middleware": \[([\s\S]*?)\]/g;
      const matches: DecorationMatch[] = [];
      
      let arrayMatch;
      while ((arrayMatch = middlewareRegex.exec(text)) !== null) {
        const matchStart = arrayMatch.index || 0;
        const middlewareList = arrayMatch[1]
          .split(',')
          .map(item => item.trim().replace(/"/g, ''));
        
        for (const middleware of middlewareList) {
          if (!middleware) continue;
          
          const startIndex = text.indexOf(`"${middleware}"`, matchStart);
          if (startIndex === -1) continue;
          
          const startPos = document.positionAt(startIndex + 1);
          const endPos = document.positionAt(startIndex + 1 + middleware.length);
          
          matches.push({
            range: new vscode.Range(startPos, endPos),
            value: middleware,
            hoverMessage: `Click to open middleware: ${middleware}`
          });
        }
      }
      
      return matches;
    },
    
    onClick(middlewarePath: string, document: vscode.TextDocument): void {
      const middlewareName = getMiddlewareNameFromPath(document.fileName);
      if (!middlewareName) {
        vscode.window.showErrorMessage('Could not determine the middleware name.');
        return;
      }
      
      const fullPath = resolveMiddlewareFilePath(workspaceFolder, middlewareName, middlewarePath);
      
      if (fullPath) {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(fullPath));
      } else {
        vscode.window.showWarningMessage(`Middleware file not found: ${middlewarePath}`);
      }
    }
  });
  
  return service;
}