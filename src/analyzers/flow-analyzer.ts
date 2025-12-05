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
    const allReqTransactionProperties = new Map<string, { producers: string[]; consumers: string[] }>();

    // Analyze each middleware in the chain
    for (const middlewarePath of endpoint.middleware) {
      const analysis = this.middlewareAnalyzer.analyzeMiddleware(middlewarePath);
      middlewares.push(analysis);

      // Track res.locals producers (writers) - now using aggregated data from all components
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

      // Track res.locals consumers (readers) - now using aggregated data from all components
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

      // Track req.transaction producers (writers)
      for (const write of analysis.allReqTransactionWrites) {
        if (!allReqTransactionProperties.has(write.property)) {
          allReqTransactionProperties.set(write.property, { producers: [], consumers: [] });
        }
        const sourceInfo = write.sourcePath ? `${middlewarePath}::${this.getShortPath(write.sourcePath)}` : middlewarePath;
        const entry = allReqTransactionProperties.get(write.property)!;
        if (!entry.producers.includes(sourceInfo)) {
          entry.producers.push(sourceInfo);
        }
      }

      // Track req.transaction consumers (readers)
      for (const read of analysis.allReqTransactionReads) {
        if (!allReqTransactionProperties.has(read.property)) {
          allReqTransactionProperties.set(read.property, { producers: [], consumers: [] });
        }
        const sourceInfo = read.sourcePath ? `${middlewarePath}::${this.getShortPath(read.sourcePath)}` : middlewarePath;
        const entry = allReqTransactionProperties.get(read.property)!;
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
      allReqTransactionProperties,
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
    
    // Use Maps to group writes and reads by property for O(1) lookup
    const writesByProperty = new Map<string, { source: string; middlewareIndex: number }[]>();
    const readsByProperty = new Map<string, { source: string; middlewareIndex: number }[]>();

    middlewares.forEach((mw, mwIndex) => {
      // Middleware's own writes/reads
      mw.resLocalsWrites.forEach(w => {
        if (!writesByProperty.has(w.property)) {
          writesByProperty.set(w.property, []);
        }
        writesByProperty.get(w.property)!.push({ source: mw.filePath, middlewareIndex: mwIndex });
      });
      mw.resLocalsReads.forEach(r => {
        if (!readsByProperty.has(r.property)) {
          readsByProperty.set(r.property, []);
        }
        readsByProperty.get(r.property)!.push({ source: mw.filePath, middlewareIndex: mwIndex });
      });

      // Component writes/reads (recursively)
      const collectFromComponents = (components: ComponentAnalysis[]) => {
        for (const comp of components) {
          comp.resLocalsWrites.forEach(w => {
            if (!writesByProperty.has(w.property)) {
              writesByProperty.set(w.property, []);
            }
            writesByProperty.get(w.property)!.push({ source: comp.filePath, middlewareIndex: mwIndex });
          });
          comp.resLocalsReads.forEach(r => {
            if (!readsByProperty.has(r.property)) {
              readsByProperty.set(r.property, []);
            }
            readsByProperty.get(r.property)!.push({ source: comp.filePath, middlewareIndex: mwIndex });
          });
          collectFromComponents(comp.children);
        }
      };
      collectFromComponents(mw.components);
    });

    // Find write -> read relationships by property (optimized O(n) per property)
    const seenEdges = new Set<string>();
    
    for (const [property, writes] of writesByProperty.entries()) {
      const reads = readsByProperty.get(property);
      if (!reads) continue;

      for (const write of writes) {
        for (const read of reads) {
          if (write.middlewareIndex <= read.middlewareIndex && write.source !== read.source) {
            const fromPath = this.getShortPath(write.source);
            const toPath = this.getShortPath(read.source);
            const edgeKey = `${fromPath}:${toPath}:${property}`;
            
            if (!seenEdges.has(edgeKey)) {
              seenEdges.add(edgeKey);
              edges.push({
                from: fromPath,
                to: toPath,
                property,
                type: 'write-read'
              });
            }
          }
        }
      }
    }

    return edges;
  }

  /**
   * Generate Mermaid diagram from analysis result
   * @param result - The flow analysis result
   * @param expandedNodes - Set of node IDs that should show their children (e.g., "MW1_c0", "MW2_c1")
   */
  public generateMermaidDiagram(result: FlowAnalysisResult, expandedNodes: Set<string> = new Set()): string {
    let diagram = 'flowchart TD\n';
    diagram += '    classDef default fill:#2d2d2d,stroke:#555,color:#fff\n';
    diagram += '    classDef hasWrites fill:#1a472a,stroke:#2d5a3d,color:#90EE90\n';
    diagram += '    classDef hasReads fill:#1a365d,stroke:#2a4a7f,color:#87CEEB\n';
    diagram += '    classDef hasBoth fill:#4a3728,stroke:#6b4423,color:#DEB887\n';
    diagram += '    classDef component fill:#3d3d3d,stroke:#666,color:#ccc\n';
    diagram += '    classDef expandable fill:#3d3d3d,stroke:#888,color:#fff,stroke-width:2px\n';
    diagram += '    classDef external fill:#4a1a2e,stroke:#6b2340,color:#FFB6C1,font-size:12px\n\n';

    // Add middleware nodes with external calls arranged on left/right sides
    result.middlewares.forEach((mw, index) => {
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
        diagram += `    subgraph MW${index + 1}["${index + 1}. ${shortName}"]\n`;
        diagram += `        MW${index + 1}_main["${shortName}"]${nodeClass}\n`;
        
        // Add component nodes with expansion support
        diagram = this.addComponentNodesWithExpansion(diagram, mw.components, `MW${index + 1}`, `MW${index + 1}_main`, expandedNodes);
        
        diagram += `    end\n`;
      } else {
        diagram += `    MW${index + 1}["${index + 1}. ${shortName}"]${nodeClass}\n`;
      }

      // Add external call nodes - use rounded rectangles and arrange on left/right sides
      if (hasExternal) {
        const calls = mw.allExternalCalls;
        const leftCalls = calls.filter((_, i) => i % 2 === 0);  // Even indices on left
        const rightCalls = calls.filter((_, i) => i % 2 === 1); // Odd indices on right
        
        // Create left side external calls (stacked vertically)
        if (leftCalls.length > 0) {
          diagram += `    subgraph MW${index + 1}_extL[" "]\n`;
          diagram += `    direction TB\n`;
          leftCalls.forEach((call, i) => {
            const callIdx = i * 2;
            const callId = `MW${index + 1}_ext${callIdx}`;
            const label = call.template || call.type;
            diagram += `        ${callId}("${label}"):::external\n`;
          });
          diagram += `    end\n`;
          diagram += `    MW${index + 1} -.-> MW${index + 1}_extL\n`;
        }
        
        // Create right side external calls (stacked vertically)
        if (rightCalls.length > 0) {
          diagram += `    subgraph MW${index + 1}_extR[" "]\n`;
          diagram += `    direction TB\n`;
          rightCalls.forEach((call, i) => {
            const callIdx = i * 2 + 1;
            const callId = `MW${index + 1}_ext${callIdx}`;
            const label = call.template || call.type;
            diagram += `        ${callId}("${label}"):::external\n`;
          });
          diagram += `    end\n`;
          diagram += `    MW${index + 1} -.-> MW${index + 1}_extR\n`;
        }
      }
    });

    diagram += '\n';

    // Add edges with data flow labels
    result.dataFlow.forEach((edge, index) => {
      const fromIndex = result.middlewares.findIndex(m => m.name === edge.from);
      const toIndex = result.middlewares.findIndex(m => m.name === edge.to);

      if (fromIndex !== -1 && toIndex !== -1) {
        const fromId = `MW${fromIndex + 1}`;
        const toId = `MW${toIndex + 1}`;

        if (edge.properties.length > 0) {
          // Show max 12 properties (or 11 + "more"), 3 per line, separated by comma
          const maxDisplay = 12;
          const props = edge.properties;
          const hasMore = props.length > maxDisplay;
          const displayProps = hasMore ? props.slice(0, 11) : props;
          
          const lines: string[] = [];
          for (let i = 0; i < displayProps.length; i += 3) {
            const lineProps = displayProps.slice(i, i + 3);
            lines.push(lineProps.join(', '));
          }
          
          // If there are more than 12, add "+N more" to the last line
          if (hasMore) {
            const remaining = props.length - 11;
            lines[lines.length - 1] += `, +${remaining} more`;
          }
          
          const propsLabel = lines.join('\\n');
          diagram += `    ${fromId} -->|"${propsLabel}"| ${toId}\n`;
        } else {
          diagram += `    ${fromId} --> ${toId}\n`;
        }
      }
    });

    return diagram;
  }

  /**
   * Add component nodes with expansion support
   * Shows components and allows expanding those with children
   */
  private addComponentNodesWithExpansion(
    diagram: string, 
    components: ComponentAnalysis[], 
    mwId: string,
    parentNodeId: string,
    expandedNodes: Set<string>,
    prefix: string = ''
  ): string {
    components.forEach((comp, idx) => {
      const compId = prefix ? `${prefix}_c${idx}` : `${mwId}_c${idx}`;
      const hasWrites = comp.resLocalsWrites.length > 0;
      const hasReads = comp.resLocalsReads.length > 0;
      const hasChildren = comp.children.length > 0;
      const isExpanded = expandedNodes.has(compId);
      
      // Determine node class based on data operations
      let nodeClass = ':::component';
      if (hasWrites && hasReads) {
        nodeClass = ':::hasBoth';
      } else if (hasWrites) {
        nodeClass = ':::hasWrites';
      } else if (hasReads) {
        nodeClass = ':::hasReads';
      }
      
      // If has children but not expanded, use expandable class
      if (hasChildren && !isExpanded) {
        nodeClass = ':::expandable';
      }

      // Build label with expansion indicator
      let label = comp.displayName;
      if (hasChildren) {
        const childCount = this.countAllChildren(comp);
        if (isExpanded) {
          label = `▼ ${label}`;  // Expanded indicator
        } else {
          label = `▶ ${label} (${childCount})`;  // Collapsed with count
        }
      }

      diagram += `        ${compId}["${label}"]${nodeClass}\n`;
      diagram += `        ${parentNodeId} --> ${compId}\n`;
      
      // If expanded, show children
      if (hasChildren && isExpanded) {
        diagram = this.addComponentNodesWithExpansion(
          diagram, 
          comp.children, 
          mwId,
          compId,
          expandedNodes,
          compId
        );
      }
    });

    return diagram;
  }

  /**
   * Count all nested children recursively
   */
  private countAllChildren(comp: ComponentAnalysis): number {
    let count = comp.children.length;
    for (const child of comp.children) {
      count += this.countAllChildren(child);
    }
    return count;
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
