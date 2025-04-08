import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export function activateMiddleware(workspaceFolder: string, defaultMiddlewareName: string) {
    const middlewareDecorationType = vscode.window.createTextEditorDecorationType({
        textDecoration: 'underline',
        color: 'blue',
        cursor: 'pointer'
    });

    vscode.workspace.onDidOpenTextDocument((document) => {
        console.log('###open file: ', document.fileName);
        if (document.fileName.endsWith('customRoutes.json')) {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const text = document.getText();
            const middlewareRegex = /"middleware": \[(.*?)\]/g;
            const matches = [...text.matchAll(middlewareRegex)];

            const decorations: vscode.DecorationOptions[] = [];
            matches.forEach((match) => {
                const middlewareList = match[1].split(',').map((item) => item.trim().replace(/"/g, ''));
                console.log('###middleware list: ', middlewareList);
                middlewareList.forEach((middleware) => {
                    const startIndex = text.indexOf(middleware);
                    const startPos = document.positionAt(startIndex);
                    const endPos = document.positionAt(startIndex + middleware.length);

                    decorations.push({
                        range: new vscode.Range(startPos, endPos),
                        hoverMessage: `Click to open ${middleware}.js`,
                        renderOptions: {
                            after: {
                                contentText: '',
                                color: 'blue',
                                textDecoration: 'underline'
                            }
                        }
                    });
                });
            });

            editor.setDecorations(middlewareDecorationType, decorations);

            // Add a click handler
            vscode.window.onDidChangeTextEditorSelection((event) => {
                const middlewarePath = event.textEditor.document.getText(event.selections[0]);                

                try {
                    const fullMiddlewareName = getFullMiddlewareName(document.fileName, defaultMiddlewareName);
                    if (!fullMiddlewareName) {
                        vscode.window.showErrorMessage('Could not determine the full middleware name.');
                        return;
                    }
                    let fullPath = path.join(workspaceFolder, fullMiddlewareName, `${middlewarePath}.js`);
                    if (!fs.existsSync(fullPath)) {
                        fullPath = path.join(workspaceFolder, fullMiddlewareName, `${middlewarePath}/index.js`);
                    }
                    vscode.commands.executeCommand('vscode.open', vscode.Uri.file(fullPath));
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to open middleware file: ${error.message}`);
                }
            });
        }
    });
}

function getFullMiddlewareName(configFileName: string, defaultMiddlewareName: string): string {
    const aglApps = ['proxy', 'content', 'main', 'mediaroom', 'page-composition', 'user', 'plus', 'safetynet', 'recording', 'stub'];
    let middlewareName = '';
    for (const app of aglApps) {
        if (configFileName.includes(`\/agl-config-${app}\/`) || configFileName.includes(`\\agl-config-${app}\\`)) {
            middlewareName = `agl-${app}-middleware`;
            break;
        }
    }

    if (!middlewareName) {
        return '';
    }    

    let fullMiddlewareName = `agl-${middlewareName}-middleware`;
    if (middlewareName === defaultMiddlewareName) {
        fullMiddlewareName = 'agl-custom-middleware';
    }
    return fullMiddlewareName;
}
