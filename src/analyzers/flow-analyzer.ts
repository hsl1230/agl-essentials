import {
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

      // Track producers (writers)
      for (const write of analysis.resLocalsWrites) {
        if (!allResLocalsProperties.has(write.property)) {
          allResLocalsProperties.set(write.property, { producers: [], consumers: [] });
        }
        allResLocalsProperties.get(write.property)!.producers.push(middlewarePath);
      }

      // Track consumers (readers)
      for (const read of analysis.resLocalsReads) {
        if (!allResLocalsProperties.has(read.property)) {
          allResLocalsProperties.set(read.property, { producers: [], consumers: [] });
        }
        allResLocalsProperties.get(read.property)!.consumers.push(middlewarePath);
      }
    }

    // Build data flow edges
    const dataFlow = this.buildDataFlowEdges(middlewares, endpoint.middleware);

    return {
      endpoint,
      middlewares,
      dataFlow,
      allResLocalsProperties
    };
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

      // Find properties written by current and read by next
      const currentWrites = new Set(current.resLocalsWrites.map(w => w.property));
      const nextReads = new Set(next.resLocalsReads.map(r => r.property));

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
   * Generate Mermaid diagram from analysis result
   */
  public generateMermaidDiagram(result: FlowAnalysisResult): string {
    let diagram = 'flowchart TD\n';
    diagram += '    classDef default fill:#2d2d2d,stroke:#555,color:#fff\n';
    diagram += '    classDef hasWrites fill:#1a472a,stroke:#2d5a3d,color:#90EE90\n';
    diagram += '    classDef hasReads fill:#1a365d,stroke:#2a4a7f,color:#87CEEB\n';
    diagram += '    classDef hasBoth fill:#4a3728,stroke:#6b4423,color:#DEB887\n\n';

    // Add nodes
    result.middlewares.forEach((mw, index) => {
      const id = `M${index}`;
      const shortName = mw.name.split('/').pop() || mw.name;
      const hasWrites = mw.resLocalsWrites.length > 0;
      const hasReads = mw.resLocalsReads.length > 0;

      let nodeClass = '';
      if (hasWrites && hasReads) {
        nodeClass = ':::hasBoth';
      } else if (hasWrites) {
        nodeClass = ':::hasWrites';
      } else if (hasReads) {
        nodeClass = ':::hasReads';
      }

      diagram += `    ${id}["${index + 1}. ${shortName}"]${nodeClass}\n`;
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
}
