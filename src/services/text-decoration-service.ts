/**
 * Text Decoration Service
 * Provides reusable text decoration and click handling functionality
 * for JSON configuration files (customRoutes.json, etc.)
 */
import * as vscode from 'vscode';

export interface DecorationConfig {
  /** CSS text decoration style */
  textDecoration?: string;
  /** Text color */
  color?: string;
  /** Cursor style */
  cursor?: string;
}

export interface DecorationMatch {
  /** The range of text to decorate */
  range: vscode.Range;
  /** The matched text value */
  value: string;
  /** Hover message to display */
  hoverMessage?: string;
}

export interface DecorationHandler {
  /** Function to extract decoration matches from document text */
  getMatches: (document: vscode.TextDocument) => DecorationMatch[];
  /** Function to handle click on a decorated range */
  onClick: (value: string, document: vscode.TextDocument) => void;
  /** File name pattern to match (e.g., 'customRoutes.json') */
  filePattern: string;
}

const DEFAULT_DECORATION_CONFIG: DecorationConfig = {
  textDecoration: 'underline',
  color: 'blue',
  cursor: 'pointer'
};

/**
 * Creates and manages text decorations with click handling
 */
export class TextDecorationService implements vscode.Disposable {
  private decorationType: vscode.TextEditorDecorationType;
  private decoratedRanges = new Map<string, DecorationMatch[]>();
  private disposables: vscode.Disposable[] = [];
  private handler: DecorationHandler;

  constructor(handler: DecorationHandler, config: DecorationConfig = {}) {
    this.handler = handler;
    const mergedConfig = { ...DEFAULT_DECORATION_CONFIG, ...config };
    
    this.decorationType = vscode.window.createTextEditorDecorationType({
      textDecoration: mergedConfig.textDecoration,
      color: mergedConfig.color,
      cursor: mergedConfig.cursor
    });

    this.registerEventHandlers();
    
    // Apply decorations to the currently active editor
    if (vscode.window.activeTextEditor) {
      this.applyDecorations(vscode.window.activeTextEditor);
    }
  }

  private registerEventHandlers(): void {
    // When active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
          this.applyDecorations(editor);
        }
      })
    );

    // When document text changes
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        this.clearDecorationsState(event.document);
        if (vscode.window.activeTextEditor?.document === event.document) {
          this.applyDecorations(vscode.window.activeTextEditor);
        }
      })
    );

    // When document is closed
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument(document => {
        this.clearDecorationsState(document);
      })
    );

    // Handle clicks on decorated text
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection(event => {
        this.handleSelection(event);
      })
    );
  }

  private applyDecorations(editor: vscode.TextEditor): void {
    const fileName = editor.document.fileName;
    
    if (!fileName.endsWith(this.handler.filePattern)) {
      editor.setDecorations(this.decorationType, []);
      this.decoratedRanges.delete(editor.document.uri.toString());
      return;
    }

    const matches = this.handler.getMatches(editor.document);
    const decorations: vscode.DecorationOptions[] = matches.map(match => ({
      range: match.range,
      hoverMessage: match.hoverMessage
    }));

    this.decoratedRanges.set(editor.document.uri.toString(), matches);
    editor.setDecorations(this.decorationType, decorations);
  }

  private clearDecorationsState(document: vscode.TextDocument): void {
    this.decoratedRanges.delete(document.uri.toString());
  }

  private handleSelection(event: vscode.TextEditorSelectionChangeEvent): void {
    // Only handle mouse clicks
    if (event.kind !== vscode.TextEditorSelectionChangeKind.Mouse) {
      return;
    }

    // Only handle single cursor selections (clicks, not drags)
    if (event.selections.length !== 1 || !event.selections[0].isEmpty) {
      return;
    }

    // Check if file matches pattern
    if (!event.textEditor.document.fileName.endsWith(this.handler.filePattern)) {
      return;
    }

    const documentUri = event.textEditor.document.uri.toString();
    const matches = this.decoratedRanges.get(documentUri);
    if (!matches) {
      return;
    }

    // Find if click is within a decorated range
    const clickPosition = event.selections[0].anchor;
    const clickedMatch = matches.find(match => match.range.contains(clickPosition));

    if (clickedMatch) {
      this.handler.onClick(clickedMatch.value, event.textEditor.document);
    }
  }

  dispose(): void {
    this.decorationType.dispose();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this.decoratedRanges.clear();
  }
}
