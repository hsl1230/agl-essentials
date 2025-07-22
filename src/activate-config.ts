import * as vscode from 'vscode';

// Helper function to get middleware name from a file path
function getMiddlewareNameFromPath(fileName: string): string | undefined {
    const aglApps = ['proxy', 'content', 'main', 'mediaroom', 'page-composition', 'user', 'plus', 'safetynet', 'recording', 'stub'];
    for (const app of aglApps) {
        if (fileName.includes(`\/agl-config-${app}\/`) || fileName.includes(`\\agl-config-${app}\\`)) {
            return app;
        }
    }
    return undefined;
}

export function activateConfig(configName: string) {
    const templateDecorationType = vscode.window.createTextEditorDecorationType({
        textDecoration: 'underline',
        color: 'blue',
        cursor: 'pointer'
    });

    // --- State Management ---
    const decoratedRanges = new Map<string, vscode.Range[]>();
    let currentLoadedMiddleware: string | undefined;

    // --- Core Functions ---

    const applyDecorations = (editor: vscode.TextEditor) => {
        if (!editor.document.fileName.endsWith('customRoutes.json')) {
            // If the file is not our target, clear any existing decorations for it
            editor.setDecorations(templateDecorationType, []);
            decoratedRanges.delete(editor.document.uri.toString());
            return;
        };

        const text = editor.document.getText();
        const regex = new RegExp(`"${configName}":\\s*"([^"]+)"`, 'g');
        const decorations: vscode.DecorationOptions[] = [];
        const ranges: vscode.Range[] = [];

        let match;
        while ((match = regex.exec(text)) !== null) {
            const value = match[1];
            const valueIndex = match[0].lastIndexOf(value);
            const startPos = editor.document.positionAt(match.index + valueIndex);
            const endPos = editor.document.positionAt(match.index + valueIndex + value.length);
            const range = new vscode.Range(startPos, endPos);
            
            decorations.push({ range, hoverMessage: `Click to open the ${configName}: ${value}` });
            ranges.push(range);
        }

        decoratedRanges.set(editor.document.uri.toString(), ranges);
        editor.setDecorations(templateDecorationType, decorations);
    };

    const processActiveEditor = (editor: vscode.TextEditor | undefined) => {
        if (!editor) return;

        const fileName = editor.document.fileName;
        
        if (fileName.endsWith('customRoutes.json') || fileName.endsWith('autoMapperConfig.json')) {
            const middlewareName = getMiddlewareNameFromPath(fileName);
            if (middlewareName && middlewareName !== currentLoadedMiddleware) {
                vscode.commands.executeCommand('aglEssentials.loadMiddleware', middlewareName);
                currentLoadedMiddleware = middlewareName;
            }
        }

        applyDecorations(editor);
    };

    // --- Event Listeners (Registered Once) ---

    vscode.window.onDidChangeActiveTextEditor(processActiveEditor);

    // Re-apply decorations when the text changes in the active editor
    vscode.workspace.onDidChangeTextDocument(event => {
        if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document === event.document) {
            applyDecorations(vscode.window.activeTextEditor);
        }
    });

    vscode.workspace.onDidCloseTextDocument(document => {
        decoratedRanges.delete(document.uri.toString());
    });

    vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.kind !== vscode.TextEditorSelectionChangeKind.Mouse) return;
        if (event.selections.length !== 1 || !event.selections[0].isEmpty) return;
        if (!event.textEditor.document.fileName.endsWith('customRoutes.json')) return;

        const ranges = decoratedRanges.get(event.textEditor.document.uri.toString());
        if (!ranges) return;

        const clickedRange = ranges.find(range => range.contains(event.selections[0].anchor));
        if (!clickedRange) return;

        const configValue = event.textEditor.document.getText(clickedRange);
        const middlewareName = getMiddlewareNameFromPath(event.textEditor.document.fileName);

        if (configValue && middlewareName) {
            switch (configName) {
                case 'template':
                    vscode.commands.executeCommand('aglEssentials.openMapperViewer', configValue, middlewareName);
                    break;
                case 'nanoConfigKey':
                    vscode.commands.executeCommand('aglEssentials.openMWareConfig', configValue, middlewareName);
                    break;
                case 'panicConfigKey': 
                    vscode.commands.executeCommand('aglEssentials.openCustomPanicConfig', configValue, middlewareName);
                    break;

            }            
        } 
    });

    processActiveEditor(vscode.window.activeTextEditor);
}