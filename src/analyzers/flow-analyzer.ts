import {
    ComponentAnalysis,
    ComponentDataFlowEdge,
    DataFlowEdge,
    EndpointConfig,
    FlowAnalysisResult,
    MiddlewareAnalysis
} from '../models/flow-analyzer-types';
import { MiddlewareAnalyzer } from './middleware-analyzer';

/**
 * Orchestrates the complete flow analysis for an endpoint
 */
export class FlowAnalyzer {
  private middlewareAnalyzer: MiddlewareAnalyzer;

  constructor(
    private workspaceFolder: string,
    private middlewareName: string
  ) {
    this.middlewareAnalyzer = new MiddlewareAnalyzer(workspaceFolder, middlewareName);
  }

  /**
   * Perform complete flow analysis for an endpoint
   */
  public analyze(endpoint: EndpointConfig): FlowAnalysisResult {
    const middlewares: MiddlewareAnalysis[] = [];
    const allResLocalsProperties = new Map<string, { producers: string[]; consumers: string[] }>();

    // Analyze each middleware in the chain
    for (const middlewarePath of endpoint.middleware) {
      const analysis = this.middlewareAnalyzer.analyzeMiddleware(middlewarePath);
      middlewares.push(analysis);

      // Track producers (writers) - now using aggregated data from all components
      for (const write of analysis.allResLocalsWrites) {
        if (!allResLocalsProperties.has(write.property)) {
          allResLocalsProperties.set(write.property, { producers: [], consumers: [] });
        }
        const sourceInfo = write.sourcePath ? `${middlewarePath}::${this.getShortPath(write.sourcePath)}` : middlewarePath;
        const entry = allResLocalsProperties.get(write.property)!;
        if (!entry.producers.includes(sourceInfo)) {
          entry.producers.push(sourceInfo);
        }
      }

      // Track consumers (readers) - now using aggregated data from all components
      for (const read of analysis.allResLocalsReads) {
        if (!allResLocalsProperties.has(read.property)) {
          allResLocalsProperties.set(read.property, { producers: [], consumers: [] });
        }
        const sourceInfo = read.sourcePath ? `${middlewarePath}::${this.getShortPath(read.sourcePath)}` : middlewarePath;
        const entry = allResLocalsProperties.get(read.property)!;
        if (!entry.consumers.includes(sourceInfo)) {
          entry.consumers.push(sourceInfo);
        }
      }
    }

    // Build data flow edges
    const dataFlow = this.buildDataFlowEdges(middlewares, endpoint.middleware);
    const componentDataFlow = this.buildComponentDataFlowEdges(middlewares);

    return {
      endpoint,
      middlewares,
      dataFlow,
      allResLocalsProperties,
      componentDataFlow
    };
  }

  /**
   * Get short path from full path
   */
  private getShortPath(fullPath: string): string {
    const parts = fullPath.replace(/\\/g, '/').split('/');
    // Get last 2-3 parts
    return parts.slice(-3).join('/');
  }

  /**
   * Build edges showing data flow between middlewares
   */
  private buildDataFlowEdges(
    middlewares: MiddlewareAnalysis[],
    middlewareOrder: string[]
  ): DataFlowEdge[] {
    const edges: DataFlowEdge[] = [];

    for (let i = 0; i < middlewares.length - 1; i++) {
      const current = middlewares[i];
      const next = middlewares[i + 1];

      // Find properties written by current (including components) and read by next
      const currentWrites = new Set(current.allResLocalsWrites.map(w => w.property));
      const nextReads = new Set(next.allResLocalsReads.map(r => r.property));

      const sharedProperties: string[] = [];
      currentWrites.forEach(prop => {
        if (nextReads.has(prop)) {
          sharedProperties.push(prop);
        }
      });

      if (sharedProperties.length > 0 || i < middlewares.length - 1) {
        edges.push({
          from: current.name,
          to: next.name,
          properties: sharedProperties
        });
      }
    }

    return edges;
  }

  /**
   * Build detailed component-level data flow edges
   */
  private buildComponentDataFlowEdges(middlewares: MiddlewareAnalysis[]): ComponentDataFlowEdge[] {
    const edges: ComponentDataFlowEdge[] = [];
    
    // Collect all writes and reads with their source paths
    const allWrites: { property: string; source: string; middlewareIndex: number }[] = [];
    const allReads: { property: string; source: string; middlewareIndex: number }[] = [];

    middlewares.forEach((mw, mwIndex) => {
      // Middleware's own writes/reads
      mw.resLocalsWrites.forEach(w => {
        allWrites.push({ property: w.property, source: mw.filePath, middlewareIndex: mwIndex });
      });
      mw.resLocalsReads.forEach(r => {
        allReads.push({ property: r.property, source: mw.filePath, middlewareIndex: mwIndex });
      });

      // Component writes/reads (recursively)
      const collectFromComponents = (components: ComponentAnalysis[]) => {
        for (const comp of components) {
          comp.resLocalsWrites.forEach(w => {
            allWrites.push({ property: w.property, source: comp.filePath, middlewareIndex: mwIndex });
          });
          comp.resLocalsReads.forEach(r => {
            allReads.push({ property: r.property, source: comp.filePath, middlewareIndex: mwIndex });
          });
          collectFromComponents(comp.children);
        }
      };
      collectFromComponents(mw.components);
    });

    // Find write -> read relationships
    for (const write of allWrites) {
      for (const read of allReads) {
        if (write.property === read.property && write.middlewareIndex <= read.middlewareIndex) {
          // Only track if write happens before or in same middleware as read
          if (write.source !== read.source) {
            edges.push({
              from: this.getShortPath(write.source),
              to: this.getShortPath(read.source),
              property: write.property,
              type: 'write-read'
            });
          }
        }
      }
    }

    return edges;
  }

  /**
   * Generate Mermaid diagram from analysis result - now with component details
   */
  public generateMermaidDiagram(result: FlowAnalysisResult): string {
    let diagram = 'flowchart TD\n';
    diagram += '    classDef default fill:#2d2d2d,stroke:#555,color:#fff\n';
    diagram += '    classDef hasWrites fill:#1a472a,stroke:#2d5a3d,color:#90EE90\n';
    diagram += '    classDef hasReads fill:#1a365d,stroke:#2a4a7f,color:#87CEEB\n';
    diagram += '    classDef hasBoth fill:#4a3728,stroke:#6b4423,color:#DEB887\n';
    diagram += '    classDef component fill:#3d3d3d,stroke:#666,color:#ccc\n';
    diagram += '    classDef external fill:#4a1a2e,stroke:#6b2340,color:#FFB6C1\n\n';

    // Add middleware nodes
    result.middlewares.forEach((mw, index) => {
      const id = `M${index}`;
      const shortName = mw.name.split('/').pop() || mw.name;
      const hasWrites = mw.allResLocalsWrites.length > 0;
      const hasReads = mw.allResLocalsReads.length > 0;
      const hasExternal = mw.allExternalCalls.length > 0;

      let nodeClass = '';
      if (hasWrites && hasReads) {
        nodeClass = ':::hasBoth';
      } else if (hasWrites) {
        nodeClass = ':::hasWrites';
      } else if (hasReads) {
        nodeClass = ':::hasReads';
      }

      // Create a subgraph for middleware with components
      if (mw.components.length > 0) {
        diagram += `    subgraph ${id}["${index + 1}. ${shortName}"]\n`;
        diagram += `        ${id}_main["${shortName}"]${nodeClass}\n`;
        
        // Add component nodes
        this.addComponentNodes(diagram, mw.components, id, 0);
        
        diagram += `    end\n`;
      } else {
        diagram += `    ${id}["${index + 1}. ${shortName}"]${nodeClass}\n`;
      }

      // Add external call nodes if present
      if (hasExternal) {
        mw.allExternalCalls.forEach((call, callIdx) => {
          const callId = `${id}_ext${callIdx}`;
          const label = call.template || call.type;
          diagram += `    ${callId}(("${label}")):::external\n`;
          diagram += `    ${id} -.-> ${callId}\n`;
        });
      }
    });

    diagram += '\n';

    // Add edges with data flow labels
    result.dataFlow.forEach((edge, index) => {
      const fromIndex = result.middlewares.findIndex(m => m.name === edge.from);
      const toIndex = result.middlewares.findIndex(m => m.name === edge.to);

      if (fromIndex !== -1 && toIndex !== -1) {
        const fromId = `M${fromIndex}`;
        const toId = `M${toIndex}`;

        if (edge.properties.length > 0) {
          const propsLabel = edge.properties.slice(0, 3).join('\\n');
          const suffix = edge.properties.length > 3 ? `\\n+${edge.properties.length - 3} more` : '';
          diagram += `    ${fromId} -->|"${propsLabel}${suffix}"| ${toId}\n`;
        } else {
          diagram += `    ${fromId} --> ${toId}\n`;
        }
      }
    });

    return diagram;
  }

  /**
   * Add component nodes recursively to the diagram
   */
  private addComponentNodes(diagram: string, components: ComponentAnalysis[], parentId: string, depth: number): string {
    components.forEach((comp, idx) => {
      const compId = `${parentId}_c${depth}_${idx}`;
      const hasWrites = comp.resLocalsWrites.length > 0;
      const hasReads = comp.resLocalsReads.length > 0;
      
      let nodeClass = ':::component';
      if (hasWrites && hasReads) {
        nodeClass = ':::hasBoth';
      } else if (hasWrites) {
        nodeClass = ':::hasWrites';
      } else if (hasReads) {
        nodeClass = ':::hasReads';
      }

      diagram += `        ${compId}["${comp.displayName}"]${nodeClass}\n`;
      diagram += `        ${parentId}_main --> ${compId}\n`;

      // Add children recursively
      if (comp.children.length > 0) {
        this.addComponentNodes(diagram, comp.children, compId, depth + 1);
      }
    });

    return diagram;
  }

  /**
   * Generate a summary of res.locals data flow
   */
  public generateDataFlowSummary(result: FlowAnalysisResult): object[] {
    const summary: object[] = [];

    result.allResLocalsProperties.forEach((info, property) => {
      summary.push({
        property,
        producers: info.producers,
        consumers: info.consumers
      });
    });

    // Sort by number of consumers (most used first)
    summary.sort((a: any, b: any) => b.consumers.length - a.consumers.length);

    return summary;
  }

  /**
   * Generate component tree structure for display
   */
  public generateComponentTree(middlewares: MiddlewareAnalysis[]): object[] {
    return middlewares.map((mw, index) => {
      const buildTree = (components: ComponentAnalysis[]): object[] => {
        return components.map(comp => ({
          name: comp.displayName,
          path: comp.filePath,
          resLocals: {
            reads: comp.resLocalsReads.map(r => ({ property: r.property, line: r.lineNumber })),
            writes: comp.resLocalsWrites.map(w => ({ property: w.property, line: w.lineNumber }))
          },
          externalCalls: comp.externalCalls.map(e => ({ type: e.type, template: e.template, line: e.lineNumber })),
          configDeps: comp.configDeps.map(c => ({ source: c.source, key: c.key, line: c.lineNumber })),
          children: buildTree(comp.children)
        }));
      };

      return {
        index: index + 1,
        name: mw.name,
        path: mw.filePath,
        resLocals: {
          reads: mw.resLocalsReads.map(r => ({ property: r.property, line: r.lineNumber })),
          writes: mw.resLocalsWrites.map(w => ({ property: w.property, line: w.lineNumber }))
        },
        allResLocals: {
          reads: mw.allResLocalsReads.length,
          writes: mw.allResLocalsWrites.length
        },
        externalCalls: mw.allExternalCalls.length,
        configDeps: mw.allConfigDeps.length,
        components: buildTree(mw.components)
      };
    });
  }
}
