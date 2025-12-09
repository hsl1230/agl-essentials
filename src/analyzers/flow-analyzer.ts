import {
  ComponentAnalysis,
  ComponentDataFlowEdge,
  DataFlowEdge,
  EndpointConfig,
  FlowAnalysisResult,
  MiddlewareAnalysis
} from '../models/flow-analyzer-types';
import { getShortPath as sharedGetShortPath } from '../shared';
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

      // Track res.locals producers and consumers
      this.trackPropertyUsage(
        analysis.allResLocalsWrites,
        analysis.allResLocalsReads,
        middlewarePath,
        allResLocalsProperties
      );

      // Track req.transaction producers and consumers
      this.trackPropertyUsage(
        analysis.allReqTransactionWrites,
        analysis.allReqTransactionReads,
        middlewarePath,
        allReqTransactionProperties
      );
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
   * Track property usage (producers and consumers)
   */
  private trackPropertyUsage(
    writes: { property: string; sourcePath?: string }[],
    reads: { property: string; sourcePath?: string }[],
    middlewarePath: string,
    properties: Map<string, { producers: string[]; consumers: string[] }>
  ): void {
    for (const write of writes) {
      if (!properties.has(write.property)) {
        properties.set(write.property, { producers: [], consumers: [] });
      }
      const sourceInfo = write.sourcePath 
        ? `${middlewarePath}::${sharedGetShortPath(write.sourcePath)}` 
        : middlewarePath;
      const entry = properties.get(write.property)!;
      if (!entry.producers.includes(sourceInfo)) {
        entry.producers.push(sourceInfo);
      }
    }

    for (const read of reads) {
      if (!properties.has(read.property)) {
        properties.set(read.property, { producers: [], consumers: [] });
      }
      const sourceInfo = read.sourcePath 
        ? `${middlewarePath}::${sharedGetShortPath(read.sourcePath)}` 
        : middlewarePath;
      const entry = properties.get(read.property)!;
      if (!entry.consumers.includes(sourceInfo)) {
        entry.consumers.push(sourceInfo);
      }
    }
  }

  /**
   * Get short path from full path
   */
  private getShortPath(fullPath: string): string {
    return sharedGetShortPath(fullPath);
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
   * @returns Object containing diagram string and externalCallsMap for click navigation
   */
  public generateMermaidDiagram(result: FlowAnalysisResult, expandedNodes: Set<string> = new Set()): { diagram: string, externalCallsMap: Map<string, any> } {
    // Map to store extId -> call data for click navigation
    const externalCallsMap = new Map<string, any>();
    
    let diagram = 'flowchart TD\n';
    diagram += '    classDef default fill:#2d2d2d,stroke:#555,color:#fff\n';
    diagram += '    classDef hasWrites fill:#1a472a,stroke:#2d5a3d,color:#90EE90\n';
    diagram += '    classDef hasReads fill:#1a365d,stroke:#2a4a7f,color:#87CEEB\n';
    diagram += '    classDef hasBoth fill:#4a3728,stroke:#6b4423,color:#DEB887\n';
    diagram += '    classDef component fill:#3d3d3d,stroke:#666,color:#ccc\n';
    diagram += '    classDef expandable fill:#3d3d3d,stroke:#888,color:#fff,stroke-width:2px,font-weight:bold\n';
    diagram += '    classDef external fill:#4a1a2e,stroke:#6b2340,color:#FFB6C1,font-size:12px\n\n';

    // Build component path map for external call linking
    // Maps filePath -> visible component node ID
    const visibleComponentMap = new Map<string, string>();

    // Build external calls map: sourceFilePath -> external calls
    // Use a seen set to prevent duplicates when same component is referenced by multiple middlewares
    const allExternalCallsMap = new Map<string, { call: any, extIdx: number }[]>();
    const seenCalls = new Set<string>(); // Track calls globally to prevent cross-middleware duplicates
    
    // Map sourcePath to its owning middleware's filePath (for fallback when no visible ancestor found)
    const sourcePathToMiddlewarePath = new Map<string, string>();
    
    // Helper to normalize paths for consistent map keys
    const normalizePathForKey = (p: string) => p.toLowerCase().replace(/\\/g, '/');
    
    // Helper function to add an external call to the map
    const addExternalCallToMap = (call: any, extIdx: number, mwFilePath?: string) => {
      const sourcePath = call.sourcePath;
      if (!sourcePath) return;
      
      // Normalize the source path for consistent key
      const normalizedSourcePath = normalizePathForKey(sourcePath);
      
      // Track which middleware this sourcePath belongs to
      if (mwFilePath && !sourcePathToMiddlewarePath.has(normalizedSourcePath)) {
        sourcePathToMiddlewarePath.set(normalizedSourcePath, normalizePathForKey(mwFilePath));
      }
      
      // Create a unique key for this call: type + template + lineNumber + normalizedSourcePath
      const callKey = `${call.type || ''}:${call.template || ''}:${call.lineNumber || 0}:${normalizedSourcePath}`;
      
      // Skip if we've already seen this exact call
      if (seenCalls.has(callKey)) return;
      seenCalls.add(callKey);
      
      if (!allExternalCallsMap.has(normalizedSourcePath)) {
        allExternalCallsMap.set(normalizedSourcePath, []);
      }
      allExternalCallsMap.get(normalizedSourcePath)!.push({ call, extIdx });
    };
    
    // Helper function to collect external calls ONLY from library components
    // Non-library component calls are already in allExternalCalls
    const collectLibraryExternalCalls = (components: ComponentAnalysis[], mwFilePath?: string) => {
      for (const comp of components) {
        // Only collect library component calls (these are filtered from allExternalCalls)
        if (comp.externalCalls) {
          comp.externalCalls.forEach((call, idx) => {
            if (call.isLibrary) {
              addExternalCallToMap(call, idx, mwFilePath);
            }
          });
        }
        // Recursively collect from children
        if (comp.children && comp.children.length > 0) {
          collectLibraryExternalCalls(comp.children, mwFilePath);
        }
      }
    };
    
    // First collect from allExternalCalls (the deduplicated list - excludes library calls)
    result.middlewares.forEach((mw, mwIndex) => {
      mw.allExternalCalls.forEach((call, extIdx) => {
        addExternalCallToMap(call, extIdx, mw.filePath);
      });
      
      // Also collect library component external calls
      // These were filtered from allExternalCalls but should show when component is visible
      if (mw.components && mw.components.length > 0) {
        collectLibraryExternalCalls(mw.components, mw.filePath);
      }
    });
    
    // First pass: collect all visible components AND build path-to-ancestor map in ONE traversal
    // This is a key optimization - we do both tasks in a single tree walk
    const visibleFilePaths = new Set<string>();
    const pathToVisibleAncestorMap = new Map<string, string>(); // normalizedPath -> visibleAncestorPath
    
    const collectVisibleAndBuildAncestorMap = (
      components: ComponentAnalysis[], 
      mwId: string, 
      prefix: string, 
      isParentExpanded: boolean,
      lastVisiblePath: string  // Already normalized
    ) => {
      for (let idx = 0; idx < components.length; idx++) {
        const comp = components[idx];
        const compId = prefix ? `${prefix}_c${idx}` : `${mwId}_c${idx}`;
        
        // Track visibility
        const isVisible = isParentExpanded && comp.filePath;
        if (isVisible) {
          visibleFilePaths.add(comp.filePath!);
          visibleComponentMap.set(comp.filePath!, compId);
        }
        
        // Build path-to-ancestor map (use normalized paths for both key and value)
        const normalizedCompPath = comp.filePath ? comp.filePath.toLowerCase().replace(/\\/g, '/') : '';
        const currentVisiblePath = isVisible ? normalizedCompPath : lastVisiblePath;
        if (comp.filePath) {
          pathToVisibleAncestorMap.set(normalizedCompPath, currentVisiblePath);
        }
        
        // Recursively process children
        const hasChildren = comp.children.length > 0;
        const isExpanded = expandedNodes.has(compId);
        
        if (hasChildren) {
          collectVisibleAndBuildAncestorMap(
            comp.children, 
            mwId, 
            compId, 
            isParentExpanded && isExpanded,
            currentVisiblePath
          );
        }
      }
    };
    
    // Single pass: collect visible components and build ancestor map for all middlewares
    result.middlewares.forEach((mw, index) => {
      const mwId = `MW${index + 1}`;
      const isMwExpanded = !expandedNodes.has(`${mwId}_collapsed`);
      
      if (mw.filePath) {
        visibleFilePaths.add(mw.filePath);
        visibleComponentMap.set(mw.filePath, mwId);
        // Also add middleware filePath to ancestor map (points to itself since it's always visible)
        // Use normalized path for both key and value
        const normalizedMwPath = mw.filePath.toLowerCase().replace(/\\/g, '/');
        pathToVisibleAncestorMap.set(normalizedMwPath, normalizedMwPath);
      }
      
      if (mw.components.length > 0) {
        // Pass normalized path as lastVisiblePath
        const normalizedMwPath = mw.filePath ? mw.filePath.toLowerCase().replace(/\\/g, '/') : '';
        collectVisibleAndBuildAncestorMap(mw.components, mwId, '', isMwExpanded, normalizedMwPath);
      }
    });
    
    // Build effective external calls map: assigns calls to the deepest visible component
    // If a component is not visible, bubble up to its visible ancestor
    const effectiveExternalCallsMap = new Map<string, { call: any, extIdx: number }[]>();
    
    // Fast lookup function using the pre-built map - O(1) instead of O(n) tree traversal
    const findVisibleAncestorFast = (targetPath: string): string | null => {
      const normalizedTarget = targetPath.toLowerCase().replace(/\\/g, '/');
      return pathToVisibleAncestorMap.get(normalizedTarget) || null;
    };
    
    // Assign each external call to the deepest visible component
    // For library calls: if source is not visible, do NOT bubble (discard)
    // For application calls: if source is not visible, bubble to visible ancestor
    
    // Create normalized version of visibleFilePaths for consistent lookup
    // (reuse normalizePathForKey from above)
    const normalizedVisibleFilePaths = new Set<string>();
    visibleFilePaths.forEach(p => normalizedVisibleFilePaths.add(normalizePathForKey(p)));
    
    allExternalCallsMap.forEach((calls, normalizedSourcePath) => {
      // sourcePath is already normalized (key of allExternalCallsMap)
      // Check if the source path is visible
      const isSourceVisible = normalizedVisibleFilePaths.has(normalizedSourcePath);
      
      // Filter calls based on visibility and library status
      const callsToAssign: { call: any, extIdx: number }[] = [];
      
      for (const callInfo of calls) {
        const isLibraryCall = callInfo.call.isLibrary;
        
        if (isSourceVisible) {
          // Source is visible - always show the call
          callsToAssign.push(callInfo);
        } else if (!isLibraryCall) {
          // Source is not visible, but it's an application call - will bubble
          callsToAssign.push(callInfo);
        }
        // Library calls with non-visible source are discarded (not bubbled)
      }
      
      if (callsToAssign.length === 0) {
        return;
      }
      
      // If the source path is visible, assign directly (using normalized path as key)
      if (isSourceVisible) {
        if (!effectiveExternalCallsMap.has(normalizedSourcePath)) {
          effectiveExternalCallsMap.set(normalizedSourcePath, []);
        }
        effectiveExternalCallsMap.get(normalizedSourcePath)!.push(...callsToAssign);
        return;
      }
      
      // If the source path is not visible, find visible ancestor using the pre-built map
      // This is O(1) lookup instead of O(n) tree traversal
      // Note: normalizedSourcePath is already normalized, so we can use it directly
      const deepestVisible = findVisibleAncestorFast(normalizedSourcePath);
      
      if (deepestVisible) {
        // Use normalized path as key for consistency
        const normalizedDeepestVisible = normalizePathForKey(deepestVisible);
        if (!effectiveExternalCallsMap.has(normalizedDeepestVisible)) {
          effectiveExternalCallsMap.set(normalizedDeepestVisible, []);
        }
        effectiveExternalCallsMap.get(normalizedDeepestVisible)!.push(...callsToAssign);
      } else {
        // Fallback: if no visible ancestor found in the pre-built map,
        // the source is likely from a component beyond MAX_DEPTH limit.
        // Try to fall back to the owning middleware's path.
        const mwPath = sourcePathToMiddlewarePath.get(normalizedSourcePath);
        if (mwPath) {
          // Check if middleware path is in effectiveExternalCallsMap or should be added
          if (!effectiveExternalCallsMap.has(mwPath)) {
            effectiveExternalCallsMap.set(mwPath, []);
          }
          effectiveExternalCallsMap.get(mwPath)!.push(...callsToAssign);
        }
        // If no middleware path found either, the calls are silently discarded
        // (this shouldn't happen if data is consistent)
      }
    });

    // Add middleware nodes with external calls embedded in labels
    result.middlewares.forEach((mw, index) => {
      const shortName = mw.name.split('/').pop() || mw.name;
      const hasWrites = mw.allResLocalsWrites.length > 0;
      const hasReads = mw.allResLocalsReads.length > 0;
      const mwId = `MW${index + 1}`;
      const hasComponents = mw.components.length > 0;
      const isMwExpanded = !expandedNodes.has(`${mwId}_collapsed`); // Default expanded, track collapsed state

      let nodeClass = '';
      if (hasWrites && hasReads) {
        nodeClass = ':::hasBoth';
      } else if (hasWrites) {
        nodeClass = ':::hasWrites';
      } else if (hasReads) {
        nodeClass = ':::hasReads';
      }

      // Register middleware file path
      if (mw.filePath) {
        visibleComponentMap.set(mw.filePath, mwId);
      }

      // Get middleware's direct external calls (from effectiveExternalCallsMap)
      // Use normalized path for consistent lookup
      const mwExternalCalls = mw.filePath ? effectiveExternalCallsMap.get(normalizePathForKey(mw.filePath)) : [];

      // Build labels - toggle symbol goes on the main node (inside subgraph), not on subgraph title
      const mwLabel = `${index + 1}. ${shortName}`;
      let mainLabel = shortName;
      let mainNodeClass = nodeClass;
      if (hasComponents) {
        const toggleSymbol = isMwExpanded ? '▼' : '▶';
        const componentCount = this.countAllComponentsInMiddleware(mw);
        mainLabel = isMwExpanded 
          ? `${toggleSymbol}  ${shortName}`
          : `${toggleSymbol}  ${shortName} (${componentCount})`;
        mainNodeClass = ':::expandable'; // Use expandable style for nodes with toggle
      }

      // Create a subgraph for middleware with components (only if expanded)
      if (hasComponents && isMwExpanded) {
        diagram += `    subgraph ${mwId}["${mwLabel}"]\n`;
        diagram += `        ${mwId}_main["${mainLabel}"]${mainNodeClass}\n`;
        
        // Add external call nodes as rounded rectangles inside the subgraph
        if (mwExternalCalls && mwExternalCalls.length > 0) {
          diagram = this.addExternalCallNodes(diagram, mwExternalCalls, `${mwId}_main`, '        ', externalCallsMap);
        }
        
        // Add component nodes with expansion support and collect visible components
        diagram = this.addComponentNodesWithExpansion(
          diagram, mw.components, mwId, `${mwId}_main`, 
          expandedNodes, '', 0, visibleComponentMap, effectiveExternalCallsMap, externalCallsMap
        );
        
        diagram += `    end\n`;
      } else if (hasComponents && !isMwExpanded) {
        // Collapsed middleware with components - show subgraph with just the main node
        diagram += `    subgraph ${mwId}["${mwLabel}"]\n`;
        diagram += `        ${mwId}_main["${mainLabel}"]${mainNodeClass}\n`;
        
        // Add external call nodes as rounded rectangles (only middleware's own calls when collapsed)
        if (mwExternalCalls && mwExternalCalls.length > 0) {
          diagram = this.addExternalCallNodes(diagram, mwExternalCalls, `${mwId}_main`, '        ', externalCallsMap);
        }
        
        diagram += `    end\n`;
      } else {
        // No components - simple node without subgraph
        diagram += `    ${mwId}["${mwLabel}"]${nodeClass}\n`;
        
        // Add external call nodes as rounded rectangles
        if (mwExternalCalls && mwExternalCalls.length > 0) {
          diagram = this.addExternalCallNodes(diagram, mwExternalCalls, mwId, '    ', externalCallsMap);
        }
      }
    });

    diagram += '\n';

    // Add edges with data flow labels
    result.dataFlow.forEach((edge, index) => {
      const fromIndex = result.middlewares.findIndex(m => m.name === edge.from);
      const toIndex = result.middlewares.findIndex(m => m.name === edge.to);

      if (fromIndex !== -1 && toIndex !== -1) {
        // Connect middleware subgraphs directly (not internal _main nodes)
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

    return { diagram, externalCallsMap };
  }

  /**
   * Add component nodes with expansion support
   * Shows components and allows expanding those with children
   * Uses subgraphs for expanded components to improve layout
   */
  private addComponentNodesWithExpansion(
    diagram: string, 
    components: ComponentAnalysis[], 
    mwId: string,
    parentNodeId: string,
    expandedNodes: Set<string>,
    prefix: string = '',
    depth: number = 0,
    visibleComponentMap?: Map<string, string>,
    externalCallsMap?: Map<string, { call: any, extIdx: number }[]>,
    extIdToCallMap?: Map<string, any>
  ): string {
    // Helper to normalize paths for map lookup
    const normalizePath = (p: string) => p.toLowerCase().replace(/\\/g, '/');
    
    components.forEach((comp, idx) => {
      const compId = prefix ? `${prefix}_c${idx}` : `${mwId}_c${idx}`;
      const hasWrites = comp.resLocalsWrites.length > 0;
      const hasReads = comp.resLocalsReads.length > 0;
      const hasChildren = comp.children.length > 0;
      const isExpanded = expandedNodes.has(compId);
      
      // Register this component in the visible map
      if (visibleComponentMap && comp.filePath) {
        visibleComponentMap.set(comp.filePath, compId);
      }
      
      // Get external calls for this component (using normalized path for lookup)
      const compExternalCalls = comp.filePath && externalCallsMap 
        ? externalCallsMap.get(normalizePath(comp.filePath)) 
        : [];
      
      // Determine node class based on data operations
      let nodeClass = ':::component';
      if (hasWrites && hasReads) {
        nodeClass = ':::hasBoth';
      } else if (hasWrites) {
        nodeClass = ':::hasWrites';
      } else if (hasReads) {
        nodeClass = ':::hasReads';
      }

      const indent = '        ' + '    '.repeat(depth);
      
      // Build label - include toggle symbol
      let label = comp.displayName;
      if (hasChildren) {
        const childCount = this.countAllChildren(comp);
        const toggleSymbol = isExpanded ? '▼' : '▶';
        label = isExpanded 
          ? `${toggleSymbol}  ${label}` 
          : `${toggleSymbol}  ${label} (${childCount})`;
        nodeClass = ':::expandable';
      }
      
      // If expanded, wrap in a subgraph to keep children close together
      if (hasChildren && isExpanded) {
        // Use subgraph for expanded component to contain its children
        const subgraphId = `${compId}_sg`;
        diagram += `${indent}subgraph ${subgraphId}[" "]\n`;
        diagram += `${indent}    direction TB\n`;
        diagram += `${indent}    ${compId}["${label}"]${nodeClass}\n`;
        
        // Add external call nodes as rounded rectangles inside subgraph
        if (compExternalCalls && compExternalCalls.length > 0) {
          diagram = this.addExternalCallNodes(diagram, compExternalCalls, compId, indent + '    ', extIdToCallMap);
        }
        
        // Add children inside the subgraph
        diagram = this.addComponentNodesWithExpansion(
          diagram, 
          comp.children, 
          mwId,
          compId,
          expandedNodes,
          compId,
          depth + 1,
          visibleComponentMap,
          externalCallsMap,
          extIdToCallMap
        );
        
        diagram += `${indent}end\n`;
        // Connect parent to the subgraph
        diagram += `${indent}${parentNodeId} --> ${compId}\n`;
      } else {
        // Regular node without subgraph
        diagram += `${indent}${compId}["${label}"]${nodeClass}\n`;
        diagram += `${indent}${parentNodeId} --> ${compId}\n`;
        
        // Add external call nodes as rounded rectangles
        if (compExternalCalls && compExternalCalls.length > 0) {
          diagram = this.addExternalCallNodes(diagram, compExternalCalls, compId, indent, extIdToCallMap);
        }
      }
    });

    return diagram;
  }
  
  /**
   * Add external call nodes as rounded rectangles connected to a parent node
   * Also populates extIdToCallMap for click navigation
   */
  private addExternalCallNodes(
    diagram: string, 
    externalCalls: { call: any, extIdx: number }[], 
    parentId: string, 
    indent: string,
    extIdToCallMap?: Map<string, any>
  ): string {
    externalCalls.forEach((ext, idx) => {
      const call = ext.call;
      const extId = `${parentId}_ext${idx}`;
      
      // Extract a short name for the external call
      // Get the template/endpoint name - this is the meaningful identifier
      let callName = call.template || call.endpoint || '';
      
      // If no template name found, skip this call (it's not meaningful to display)
      if (!callName) {
        return;
      }
      
      // Store the call data in the map for click navigation
      if (extIdToCallMap) {
        extIdToCallMap.set(extId, {
          type: call.type,
          template: call.template,
          sourcePath: call.sourcePath,
          lineNumber: call.lineNumber,
          codeSnippet: call.codeSnippet,
          isLibrary: call.isLibrary
        });
      }
      
      // Shorten long names - take the last meaningful part
      if (callName.length > 35) {
        const parts = callName.split('/').filter((p: string) => p && !p.startsWith('$'));
        callName = parts.length > 0 ? '.../' + parts.slice(-2).join('/') : callName.substring(0, 32) + '...';
      }
      
      // Use rounded rectangle syntax: ([...])
      // Format: TYPE: TemplateName (e.g., "DCQ: GetUnifiedAssetDetailById")
      const typeLabel = call.type ? `${call.type.toUpperCase()}: ` : '';
      diagram += `${indent}${extId}(["${typeLabel}${callName}"]):::external\n`;
      diagram += `${indent}${parentId} -.-> ${extId}\n`;
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
   * Count all components in a middleware (including nested)
   */
  private countAllComponentsInMiddleware(mw: MiddlewareAnalysis): number {
    let count = mw.components.length;
    for (const comp of mw.components) {
      count += this.countAllChildren(comp);
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
