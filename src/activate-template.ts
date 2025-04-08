import * as vscode from 'vscode';

export function activateTemplate(keyword: string) {
    const templateDecorationType = vscode.window.createTextEditorDecorationType({
        textDecoration: 'underline',
        color: 'blue',
        cursor: 'pointer'
    });

    vscode.workspace.onDidOpenTextDocument((document) => {
        let middlewareName: string = '';
        console.log('###open file for template : ', document.fileName);
        if (document.fileName.endsWith('customRoutes.json') || document.fileName.endsWith('autoMapperConfig.json')) {
            const aglApps = ['proxy', 'content', 'main', 'mediaroom', 'page-composition', 'user', 'plus', 'safetynet', 'recording', 'stub'];
            
            for (const app of aglApps) {
                if (document.fileName.includes(`\/agl-config-${app}\/`) || document.fileName.includes(`\\agl-config-${app}\\`)) {
                    middlewareName = app;
                    break;
                }
            }
            console.log('###middleware name : ', middlewareName);
            if (!middlewareName) return;

            vscode.commands.executeCommand('aglEssentials.loadMiddleware', middlewareName);
        }
        
        if (document.fileName.endsWith('customRoutes.json')) {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !middlewareName) return;

            const text = document.getText();
            console.log("#####text: ", text);
            const regex = new RegExp(`"${keyword}":\\s*"([^"]+)"`, 'g');
            const decorations: vscode.DecorationOptions[] = [];

            let match;
            while ((match = regex.exec(text)) !== null) {
                console.log('###match : ', match);
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                decorations.push({
                    range: new vscode.Range(startPos, endPos),
                    hoverMessage: `Click to open the mapper ${match[1]}`
                });
            }

            editor.setDecorations(templateDecorationType, decorations);

            // Add a click handler
            vscode.window.onDidChangeTextEditorSelection((event) => {
                const editor = event.textEditor;
                const selection = editor.selection;
                const text = editor.document.getText(selection);
        
                const regex = new RegExp(`"${keyword}":\\s*"([^"]+)"`, 'g');
                const match = regex.exec(text);
                if (match) {
                    if (keyword === 'template') {
                        vscode.commands.executeCommand('aglEssentials.openMapperViewer', match[1], middlewareName);
                    }
                }
            });
        }
    });
}