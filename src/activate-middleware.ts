import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export function activateMiddleware(workspaceFolder: string, defaultMiddlewareName: string) {
    const middlewareDecorationType = vscode.window.createTextEditorDecorationType({
        textDecoration: 'underline',
        color: 'blue',
        cursor: 'pointer'
    });

    // A Map to store the specific ranges we have decorated for click detection
    const decoratedRanges = new Map<string, vscode.Range[]>();

    const applyDecorations = (editor: vscode.TextEditor | undefined) => {
        if (!editor || !editor.document.fileName.endsWith('customRoutes.json')) {
            editor?.setDecorations(middlewareDecorationType, []);
            if (editor) {
                decoratedRanges.delete(editor?.document.uri.toString());
            }
            return;
        }

        const documentUri = editor.document.uri.toString();

        const text = editor.document.getText();
        const middlewareRegex = /"middleware": \[([\s\S]*?)\]/g;
        const matches = [...text.matchAll(middlewareRegex)];

        const decorations: vscode.DecorationOptions[] = [];
        matches.forEach((match) => {
            const matchStart = match.index || 0;
            const middlewareList = match[1].split(',').map((item) => item.trim().replace(/"/g, ''));
            
            middlewareList.forEach((middleware) => {
                if (!middleware) return;
                const startIndex = text.indexOf(`"${middleware}"`, matchStart);
                if (startIndex === -1) return;

                const startPos = editor.document.positionAt(startIndex + 1);
                const endPos = editor.document.positionAt(startIndex + 1 + middleware.length);

                decorations.push({
                    range: new vscode.Range(startPos, endPos),
                    hoverMessage: `Click to open middleware: ${middleware}`
                });
            });
        });

        // Store the specific ranges we are about to apply for this document
        const ranges = decorations.map(d => d.range);
        decoratedRanges.set(documentUri, ranges);

        editor.setDecorations(middlewareDecorationType, decorations);
    };

    const clearDecorationsState = (document: vscode.TextDocument) => {
        const documentUri = document.uri.toString();
        decoratedRanges.delete(documentUri);
    };

    // When a document's text changes, clear its state so it can be re-decorated.
    vscode.workspace.onDidChangeTextDocument(event => {
        clearDecorationsState(event.document);
        // Re-apply decorations if the changed document is still the active one
        if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.toString() === event.document.uri.toString()) {
            applyDecorations(vscode.window.activeTextEditor);
        }
    });

    // When a document is closed, clear its state.
    vscode.workspace.onDidCloseTextDocument(document => {
        clearDecorationsState(document);
    });

    // When the active editor changes, try to apply decorations.
    vscode.window.onDidChangeActiveTextEditor(editor => {
        applyDecorations(editor);
    });

    // Apply decorations to the editor that is active when the extension loads.
    if (vscode.window.activeTextEditor) {
        applyDecorations(vscode.window.activeTextEditor);
    }

    // Register a single click handler for all editors.
    vscode.window.onDidChangeTextEditorSelection((event) => {
        // This is the key to fixing the loop:
        // Only proceed if the selection was changed by a mouse click.
        // This ignores selection changes caused by keyboard or editor focus restoration.
        if (event.kind !== vscode.TextEditorSelectionChangeKind.Mouse) {
            return;
        }

        // 1. We only care about single-cursor selections (clicks), not multi-selections.
        //    And the selection must be empty (a click, not a drag).
        if (event.selections.length !== 1 || !event.selections[0].isEmpty) {
            return;
        }

        // 2. Basic filter for the correct file type.
        if (!event.textEditor.document.fileName.endsWith('customRoutes.json')) {
            return;
        }

        const documentUri = event.textEditor.document.uri.toString();
        const ranges = decoratedRanges.get(documentUri);
        if (!ranges) {
            return;
        }

        // 3. Find which of OUR decorated ranges contains the click position.
        const clickPosition = event.selections[0].anchor;
        const clickedRange = ranges.find(range => range.contains(clickPosition));

        if (!clickedRange) {
            // The click was not on one of our decorated texts.
            return;
        }

        // 4. Get the text from the clicked range and proceed.
        const middlewarePath = event.textEditor.document.getText(clickedRange);
        if (!middlewarePath) return;

        try {
            const fullMiddlewareName = getFullMiddlewareName(event.textEditor.document.fileName, defaultMiddlewareName);
            if (!fullMiddlewareName) {
                vscode.window.showErrorMessage('Could not determine the full middleware name.');
                return;
            }
            let fullPath = path.join(workspaceFolder, fullMiddlewareName, `${middlewarePath}.js`);
            if (!fs.existsSync(fullPath)) {
                fullPath = path.join(workspaceFolder, fullMiddlewareName, `${middlewarePath}/index.js`);
            }

            if (fs.existsSync(fullPath)) {
                vscode.commands.executeCommand('vscode.open', vscode.Uri.file(fullPath));
            } else {
                vscode.window.showWarningMessage(`Middleware file not found: ${fullPath}`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to open middleware file: ${error.message}`);
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

    return middlewareName;
}