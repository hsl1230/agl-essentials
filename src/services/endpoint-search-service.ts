import * as path from 'path';
import * as vscode from 'vscode';
import { FlowAnalyzer } from '../analyzers/flow-analyzer';
import { ComponentAnalysis, EndpointConfig, FlowAnalysisResult } from '../models/flow-analyzer-types';

/**
 * Service for searching within endpoint-related files (middleware and components)
 */
export class EndpointSearchService {
  private flowAnalyzer: FlowAnalyzer;
  private workspaceFolder: string;
  private middlewareName: string;
  private fullMiddlewareName: string;

  constructor(workspaceFolder: string, middlewareName: string) {
    this.workspaceFolder = workspaceFolder;
    this.middlewareName = middlewareName;
    this.fullMiddlewareName = `agl-${middlewareName}-middleware`;
    this.flowAnalyzer = new FlowAnalyzer(workspaceFolder, middlewareName);
  }

  /**
   * Get all file paths related to an endpoint (middleware + components)
   */
  public getEndpointFilePaths(endpoint: EndpointConfig): string[] {
    const result = this.flowAnalyzer.analyze(endpoint);
    return this.collectAllFilePaths(result);
  }

  /**
   * Collect all file paths from the analysis result
   */
  private collectAllFilePaths(result: FlowAnalysisResult): string[] {
    const filePaths = new Set<string>();

    // Collect middleware file paths
    for (const middleware of result.middlewares) {
      if (middleware.exists && middleware.filePath) {
        filePaths.add(middleware.filePath);
      }
      // Collect component file paths
      this.collectComponentFilePaths(middleware.components, filePaths);
    }

    return Array.from(filePaths);
  }

  /**
   * Recursively collect component file paths
   */
  private collectComponentFilePaths(components: ComponentAnalysis[], filePaths: Set<string>): void {
    for (const component of components) {
      if (component.exists && component.filePath && !component.isShallowReference) {
        filePaths.add(component.filePath);
      }
      if (component.children && component.children.length > 0) {
        this.collectComponentFilePaths(component.children, filePaths);
      }
    }
  }

  /**
   * Convert file paths to glob pattern for VS Code search
   */
  public createSearchGlobPattern(filePaths: string[]): string {
    if (filePaths.length === 0) {
      return '';
    }

    // Convert absolute paths to workspace-relative paths
    const relativePaths = filePaths.map(fp => {
      const rel = path.relative(this.workspaceFolder, fp);
      return rel.replace(/\\/g, '/');  // Normalize to forward slashes
    });

    // Create a glob pattern using brace expansion
    if (relativePaths.length === 1) {
      return relativePaths[0];
    }

    return `{${relativePaths.join(',')}}`;
  }

  /**
   * Search within endpoint-related files using VS Code's search functionality
   */
  public async searchInEndpoint(endpoint: EndpointConfig, searchQuery?: string): Promise<void> {
    const filePaths = this.getEndpointFilePaths(endpoint);
    
    if (filePaths.length === 0) {
      vscode.window.showWarningMessage('No files found for this endpoint.');
      return;
    }

    // If no search query provided, prompt the user
    const query = searchQuery || await vscode.window.showInputBox({
      prompt: 'Enter search string',
      placeHolder: 'Search in endpoint files...',
      title: `Search in ${endpoint.endpointUri}`
    });

    if (!query) {
      return; // User cancelled
    }

    // Create the files to include pattern
    const includePattern = this.createSearchGlobPattern(filePaths);

    // Use VS Code's search command with the file filter
    await vscode.commands.executeCommand('workbench.action.findInFiles', {
      query: query,
      filesToInclude: includePattern,
      triggerSearch: true,
      isRegex: false,
      isCaseSensitive: false,
      matchWholeWord: false
    });
  }

  /**
   * Alternative: Open search with pre-filled file patterns (for manual search)
   */
  public async openSearchWithFileFilter(endpoint: EndpointConfig): Promise<void> {
    const filePaths = this.getEndpointFilePaths(endpoint);
    
    if (filePaths.length === 0) {
      vscode.window.showWarningMessage('No files found for this endpoint.');
      return;
    }

    const includePattern = this.createSearchGlobPattern(filePaths);

    // Open the search view with the file pattern pre-filled
    await vscode.commands.executeCommand('workbench.action.findInFiles', {
      filesToInclude: includePattern,
      triggerSearch: false
    });
  }

  /**
   * Get a summary of files that will be searched
   */
  public getSearchSummary(endpoint: EndpointConfig): { middlewareCount: number; componentCount: number; totalFiles: number; files: string[] } {
    const result = this.flowAnalyzer.analyze(endpoint);
    
    let middlewareCount = 0;
    let componentCount = 0;
    const files: string[] = [];

    for (const middleware of result.middlewares) {
      if (middleware.exists && middleware.filePath) {
        middlewareCount++;
        files.push(middleware.filePath);
      }
      componentCount += this.countComponents(middleware.components, files);
    }

    return {
      middlewareCount,
      componentCount,
      totalFiles: files.length,
      files
    };
  }

  private countComponents(components: ComponentAnalysis[], files: string[]): number {
    let count = 0;
    for (const component of components) {
      if (component.exists && component.filePath && !component.isShallowReference) {
        count++;
        files.push(component.filePath);
      }
      if (component.children && component.children.length > 0) {
        count += this.countComponents(component.children, files);
      }
    }
    return count;
  }
}
