const vscode = acquireVsCodeApi();

// State
let currentEndpoint = null;
let currentMiddlewares = [];
let currentProperties = [];
let zoomLevel = 1;
let currentExternalCallsMap = new Map(); // extId -> call data for click navigation

// Pan/Zoom state for diagram
let panState = {
    isPanning: false,
    startX: 0,
    startY: 0,
    translateX: 0,
    translateY: 0,
    currentTranslateX: 0,
    currentTranslateY: 0
};

// Last click position for floating panel
let lastClickPosition = { x: 0, y: 0 };
let lastClickedCardRect = null;

// Floating panel drag state
let floatingPanelDrag = {
    isDragging: false,
    startX: 0,
    startY: 0,
    panelStartX: 0,
    panelStartY: 0
};

// Navigation history for sidebar
let sidebarHistory = [];
let currentSidebarItem = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeMermaid();
    initializeTabs();
    initializeControls();
    initializeSidebar();
    initializeFloatingPanel();
    
    // Request data from extension
    vscode.postMessage({ command: 'webviewLoaded' });
});

// Initialize Mermaid
function initializeMermaid() {
    mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
            primaryColor: '#2d2d2d',
            primaryTextColor: '#fff',
            primaryBorderColor: '#555',
            lineColor: '#666',
            secondaryColor: '#3c3c3c',
            tertiaryColor: '#1e1e1e',
            fontSize: '16px',
            fontFamily: 'Consolas, Monaco, monospace'
        },
        flowchart: {
            useMaxWidth: false,
            htmlLabels: true,
            curve: 'basis',
            nodeSpacing: 50,
            rankSpacing: 60,
            padding: 15,
            diagramPadding: 15
        },
        securityLevel: 'loose'
    });
}

// Tab switching
function initializeTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            
            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Show corresponding panel
            document.querySelectorAll('.tab-panel').forEach(panel => {
                panel.classList.remove('active');
            });
            document.getElementById(tabId).classList.add('active');
        });
    });
}

// Controls
function initializeControls() {
    document.getElementById('refresh-btn')?.addEventListener('click', () => {
        vscode.postMessage({ command: 'refreshAnalysis' });
    });
    
    document.getElementById('zoom-in-btn')?.addEventListener('click', () => {
        zoomLevel = Math.min(zoomLevel + 0.25, 5);
        applyZoom();
    });
    
    document.getElementById('zoom-out-btn')?.addEventListener('click', () => {
        zoomLevel = Math.max(zoomLevel - 0.25, 0.1);
        applyZoom();
    });
    
    document.getElementById('reset-zoom-btn')?.addEventListener('click', () => {
        zoomLevel = 1;
        panState.currentTranslateX = 0;
        panState.currentTranslateY = 0;
        applyZoom();
    });
    
    // Initialize pan/zoom for diagram
    initializeDiagramPanZoom();
    
    document.getElementById('property-search')?.addEventListener('input', (e) => {
        filterProperties(e.target.value);
    });

    document.getElementById('expand-all-btn')?.addEventListener('click', () => {
        document.querySelectorAll('.collapsible-content').forEach(el => {
            el.classList.add('expanded');
        });
        document.querySelectorAll('.collapse-toggle').forEach(el => {
            el.classList.add('expanded');
            if (!el.classList.contains('empty')) el.textContent = '▼';
        });
    });

    document.getElementById('collapse-all-btn')?.addEventListener('click', () => {
        document.querySelectorAll('.collapsible-content').forEach(el => {
            el.classList.remove('expanded');
        });
        document.querySelectorAll('.collapse-toggle').forEach(el => {
            el.classList.remove('expanded');
            if (!el.classList.contains('empty')) el.textContent = '▶';
        });
    });
}

function applyZoom() {
    const viewport = document.querySelector('.diagram-viewport');
    if (viewport) {
        viewport.style.transform = `translate(${panState.currentTranslateX}px, ${panState.currentTranslateY}px) scale(${zoomLevel})`;
    }
    
    // Update zoom info display
    const zoomInfo = document.querySelector('.zoom-info');
    if (zoomInfo) {
        zoomInfo.textContent = `${Math.round(zoomLevel * 100)}%`;
    }
}

// Initialize pan and zoom for diagram
function initializeDiagramPanZoom() {
    const container = document.querySelector('.diagram-container');
    if (!container) return;
    
    // Mouse wheel zoom
    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        const newZoom = Math.max(0.1, Math.min(5, zoomLevel + delta));
        
        // Zoom towards mouse position
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Calculate new translate to zoom towards cursor
        const zoomRatio = newZoom / zoomLevel;
        panState.currentTranslateX = mouseX - (mouseX - panState.currentTranslateX) * zoomRatio;
        panState.currentTranslateY = mouseY - (mouseY - panState.currentTranslateY) * zoomRatio;
        
        zoomLevel = newZoom;
        applyZoom();
    }, { passive: false });
    
    // Mouse pan
    container.addEventListener('mousedown', (e) => {
        // Only pan with left mouse button, and not on clickable elements
        if (e.button !== 0) return;
        if (e.target.closest('.nodeLabel, .edgeLabel, a')) return;
        
        panState.isPanning = true;
        panState.startX = e.clientX;
        panState.startY = e.clientY;
        panState.translateX = panState.currentTranslateX;
        panState.translateY = panState.currentTranslateY;
        container.style.cursor = 'grabbing';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!panState.isPanning) return;
        
        const dx = e.clientX - panState.startX;
        const dy = e.clientY - panState.startY;
        
        panState.currentTranslateX = panState.translateX + dx;
        panState.currentTranslateY = panState.translateY + dy;
        
        applyZoom();
    });
    
    document.addEventListener('mouseup', () => {
        if (panState.isPanning) {
            panState.isPanning = false;
            const container = document.querySelector('.diagram-container');
            if (container) container.style.cursor = 'grab';
        }
    });
    
    // Touch support for mobile/tablet
    let lastTouchDistance = 0;
    
    container.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            panState.isPanning = true;
            panState.startX = e.touches[0].clientX;
            panState.startY = e.touches[0].clientY;
            panState.translateX = panState.currentTranslateX;
            panState.translateY = panState.currentTranslateY;
        } else if (e.touches.length === 2) {
            lastTouchDistance = getTouchDistance(e.touches);
        }
    }, { passive: true });
    
    container.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1 && panState.isPanning) {
            const dx = e.touches[0].clientX - panState.startX;
            const dy = e.touches[0].clientY - panState.startY;
            
            panState.currentTranslateX = panState.translateX + dx;
            panState.currentTranslateY = panState.translateY + dy;
            
            applyZoom();
        } else if (e.touches.length === 2) {
            e.preventDefault();
            const currentDistance = getTouchDistance(e.touches);
            const delta = (currentDistance - lastTouchDistance) * 0.01;
            zoomLevel = Math.max(0.1, Math.min(5, zoomLevel + delta));
            lastTouchDistance = currentDistance;
            applyZoom();
        }
    }, { passive: false });
    
    container.addEventListener('touchend', () => {
        panState.isPanning = false;
    }, { passive: true });
}

function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

// Sidebar - keep it persistent
function initializeSidebar() {
    document.getElementById('close-sidebar')?.addEventListener('click', () => {
        document.getElementById('detail-sidebar').classList.remove('open');
        // Clear history when closing sidebar
        sidebarHistory = [];
        currentSidebarItem = null;
        updateBackButton();
    });
    
    // Back button handler
    document.getElementById('back-btn')?.addEventListener('click', () => {
        navigateBack();
    });
}

// Open file without losing sidebar focus
function openFile(filePath, lineNumber, isMiddleware = false, middlewarePath = null) {
    if (isMiddleware) {
        vscode.postMessage({
            command: 'openMiddlewareFile',
            middlewarePath: middlewarePath || filePath,
            lineNumber: lineNumber || 1
        });
    } else {
        vscode.postMessage({
            command: 'openComponentFile',
            filePath: filePath,
            lineNumber: lineNumber || 1
        });
    }
}

// Message handling
window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.command) {
        case 'analysisResult':
            try {
                handleAnalysisResult(message.content);
            } catch (error) {
                console.error('[FlowAnalyzer WebView] Error handling analysisResult:', error);
            }
            break;
        case 'diagramUpdate':
            // Handle diagram-only update (for expand/collapse) - preserve pan/zoom
            try {
                // Update externalCallsMap for click navigation
                if (message.content.externalCallsMap) {
                    currentExternalCallsMap = new Map(message.content.externalCallsMap);
                }
                renderMermaidDiagram(message.content.mermaidDiagram, true);
            } catch (error) {
                console.error('[FlowAnalyzer WebView] Error handling diagramUpdate:', error);
            }
            break;
        case 'middlewareDetail':
            showMiddlewareDetailSidebar(message.content);
            break;
        case 'componentDetail':
            showComponentDetailSidebar(message.content);
            break;
        case 'propertyUsages':
            showPropertyUsages(message.content);
            break;
        case 'reqTransactionUsages':
            showPropertyUsages(message.content, 'req.transaction');
            break;
        case 'error':
            console.error('Error:', message.message);
            break;
    }
});

// Handle analysis result
async function handleAnalysisResult(data) {
    currentEndpoint = data.endpoint;
    currentMiddlewares = data.middlewares;
    currentProperties = data.allProperties;
    
    // Update externalCallsMap for click navigation
    if (data.externalCallsMap) {
        currentExternalCallsMap = new Map(data.externalCallsMap);
    }
    
    try {
        renderEndpointInfo(data.endpoint);
        await renderMermaidDiagram(data.mermaidDiagram);
        renderMiddlewareChain(data.middlewares);
        renderComponentTree(data.middlewares);
        renderDataFlow(data.allProperties, data.middlewares, data.allReqTransactionProperties);
        renderConfigView(data.endpoint, data.middlewares);
    } catch (error) {
        console.error('[FlowAnalyzer WebView] Error in handleAnalysisResult:', error);
    }
}

// Render endpoint info
function renderEndpointInfo(endpoint) {
    const info = document.getElementById('endpoint-info');
    info.innerHTML = `
        <span class="method ${endpoint.method.toLowerCase()}">${endpoint.method.toUpperCase()}</span>
        <span class="uri">${endpoint.endpointUri}</span>
    `;
}

// Render Mermaid diagram - FIX click handlers
// preservePosition: if true, keep current pan/zoom (for expand/collapse)
async function renderMermaidDiagram(diagram, preservePosition = false) {
    const container = document.getElementById('mermaid-diagram');
    const viewport = container.querySelector('.diagram-viewport');
    
    // Save current position before re-render
    const savedZoom = zoomLevel;
    const savedTranslateX = panState.currentTranslateX;
    const savedTranslateY = panState.currentTranslateY;
    
    try {
        const { svg } = await mermaid.render('flowchart', diagram);
        viewport.innerHTML = `<div class="mermaid">${svg}</div>`;
        
        if (preservePosition) {
            // Restore saved position for expand/collapse
            zoomLevel = savedZoom;
            panState.currentTranslateX = savedTranslateX;
            panState.currentTranslateY = savedTranslateY;
            applyZoom();
        } else {
            // Center the diagram on new load
            zoomLevel = 1;
            
            // Wait a bit for the SVG to be fully rendered
            requestAnimationFrame(() => {
                const containerRect = container.getBoundingClientRect();
                const svgElement = viewport.querySelector('svg');
                
                if (svgElement) {
                    const svgRect = svgElement.getBoundingClientRect();
                    
                    // Calculate center position
                    const centerX = (containerRect.width - svgRect.width) / 2;
                    const centerY = Math.max(20, (containerRect.height - svgRect.height) / 2);
                    
                    panState.currentTranslateX = centerX;
                    panState.currentTranslateY = centerY;
                } else {
                    panState.currentTranslateX = 0;
                    panState.currentTranslateY = 0;
                }
                
                applyZoom();
            });
        }
        
        // Add click handlers to nodes - use a more robust selector
        setTimeout(() => {
            const nodes = viewport.querySelectorAll('.node');
            nodes.forEach((node) => {
                node.style.cursor = 'pointer';
                
                // Extract node info from id - Mermaid adds "flowchart-" prefix
                let nodeId = node.id;
                
                // Strip Mermaid prefix if present (e.g., "flowchart-MW1-0" -> "MW1")
                if (nodeId.startsWith('flowchart-')) {
                    // Format: flowchart-{nodeId}-{index}
                    const parts = nodeId.split('-');
                    // Remove 'flowchart' prefix and numeric suffix
                    nodeId = parts.slice(1, -1).join('-');
                    // Convert dashes back to underscores for component IDs
                    nodeId = nodeId.replace(/-/g, '_');
                }
                
                // Check if it's an external call node: 
                // Formats: MW{n}_ext{m}, MW{n}_main_ext{m}, MW{n}_c{x}_ext{m}, MW{n}_c{x}_c{y}_ext{m}
                const extMatch = nodeId.match(/^(MW\d+(?:_main|(?:_c\d+)*)?)_ext(\d+)$/);
                if (extMatch) {
                    const parentNodeId = extMatch[1];
                    const extIndex = parseInt(extMatch[2]);
                    
                    // Find the external call from the data
                    const extCall = findExternalCallByNodeId(parentNodeId, extIndex);
                    if (extCall) {
                        node.addEventListener('click', (e) => {
                            e.stopPropagation();
                            navigateToExternalCall(null, extCall);
                        });
                    }
                    return; // Don't process as middleware node
                }
                
                // Check if it's a component node: MW{n}_c{...} (e.g., MW1_c0, MW1_c0_c1)
                const compMatch = nodeId.match(/^(MW\d+(?:_c\d+)+)$/);
                if (compMatch) {
                    const compNodeId = compMatch[1];
                    const nodeLabel = node.querySelector('.nodeLabel')?.textContent || '';
                    const hasToggle = nodeLabel.includes('▶') || nodeLabel.includes('▼');
                    const hasExternalCalls = nodeLabel.includes('📡');
                    
                    node.addEventListener('click', (e) => {
                        e.stopPropagation();
                        
                        const rect = node.getBoundingClientRect();
                        const clickX = e.clientX - rect.left;
                        const nodeWidth = rect.width;
                        const clickRatio = clickX / nodeWidth;
                        
                        // Determine click zones:
                        // - Left 20%: toggle (if has toggle)
                        // - Right 20%: external calls (if has 📡)
                        // - Middle: detail view
                        
                        if (hasToggle && clickRatio < 0.20) {
                            vscode.postMessage({
                                command: 'toggleComponentExpansion',
                                nodeId: compNodeId
                            });
                        } else if (hasExternalCalls && clickRatio > 0.80) {
                            const comp = findComponentByNodeId(compNodeId);
                            if (comp) {
                                sidebarHistory = [];
                                currentSidebarItem = null;
                                showExternalCallsSidebar(comp);
                            }
                        } else {
                            const comp = findComponentByNodeId(compNodeId);
                            if (comp) {
                                sidebarHistory = [];
                                currentSidebarItem = null;
                                showComponentDetailSidebar(comp, false);
                            }
                        }
                    });
                    return;
                }
                
                // Check if it's a middleware node: MW{n} or MW{n}_main
                const mwMatch = nodeId.match(/^MW(\d+)(?:_main)?$/);
                if (mwMatch) {
                    const mwIndex = parseInt(mwMatch[1]) - 1;
                    const mwId = `MW${mwMatch[1]}`;
                    const mw = currentMiddlewares[mwIndex];
                    if (mw) {
                        const nodeLabel = node.querySelector('.nodeLabel')?.textContent || '';
                        const hasExternalCalls = nodeLabel.includes('📡');
                        const hasToggle = nodeLabel.includes('▶') || nodeLabel.includes('▼');
                        const hasComponents = mw.components && mw.components.length > 0;
                        
                        node.addEventListener('click', (e) => {
                            e.stopPropagation();
                            
                            const rect = node.getBoundingClientRect();
                            const clickX = e.clientX - rect.left;
                            const nodeWidth = rect.width;
                            const clickRatio = clickX / nodeWidth;
                            
                            // Determine click zones:
                            // - Left 20%: toggle (if has toggle/components)
                            // - Right 20%: external calls (if has 📡)
                            // - Middle: detail view
                            
                            if ((hasToggle || hasComponents) && clickRatio < 0.20) {
                                vscode.postMessage({
                                    command: 'toggleMiddlewareExpansion',
                                    nodeId: mwId
                                });
                            } else if (hasExternalCalls && clickRatio > 0.80) {
                                sidebarHistory = [];
                                currentSidebarItem = null;
                                showMiddlewareExternalCallsSidebar(mw);
                            } else {
                                sidebarHistory = [];
                                showMiddlewareDetailSidebar(mw, false);
                            }
                        });
                    }
                }
            });
        }, 200);
    } catch (error) {
        viewport.innerHTML = `<div class="error">Failed to render diagram: ${error.message}</div>`;
    }
}

// Find external call by node ID (extId format: MW1_main_ext0, MW1_c0_ext1, etc.)
function findExternalCallByNodeId(parentNodeId, extIndex) {
    // First, try to find from the currentExternalCallsMap (includes bubbled calls)
    const extId = `${parentNodeId}_ext${extIndex}`;
    if (currentExternalCallsMap && currentExternalCallsMap.has(extId)) {
        return currentExternalCallsMap.get(extId);
    }
    
    // Fallback: try to find from component's own externalCalls (legacy behavior)
    if (!currentMiddlewares) return null;
    
    // Parse the parent node ID to find the middleware and component
    // Formats: MW1, MW1_main, MW1_c0, MW1_c0_c1, etc.
    const mwMatch = parentNodeId.match(/^MW(\d+)/);
    if (!mwMatch) return null;
    
    const mwIndex = parseInt(mwMatch[1]) - 1;
    const mw = currentMiddlewares[mwIndex];
    if (!mw) return null;
    
    // Check if it's a component node (has _c in the ID)
    const compParts = parentNodeId.match(/_c(\d+)/g);
    
    if (!compParts || compParts.length === 0 || parentNodeId.includes('_main')) {
        // It's the middleware main node - get external calls from middleware
        const allCalls = mw.allExternalCalls || mw.externalCalls || [];
        // Filter to get only middleware's direct external calls (matching sourcePath)
        const mwDirectCalls = allCalls.filter(c => c.sourcePath === mw.filePath);
        return mwDirectCalls[extIndex] || allCalls[extIndex];
    }
    
    // Navigate through component tree to find the component
    let currentComponents = mw.components || [];
    let component = null;
    
    for (const part of compParts) {
        const idx = parseInt(part.replace('_c', ''));
        if (currentComponents && currentComponents[idx]) {
            component = currentComponents[idx];
            currentComponents = component.children || [];
        } else {
            return null;
        }
    }
    
    if (component) {
        const compCalls = component.externalCalls || [];
        return compCalls[extIndex];
    }
    
    return null;
}

// Navigate to external call source code
function navigateToExternalCall(middleware, extCall) {
    // Find the source file and line number for this external call
    const sourcePath = extCall.sourcePath || (middleware ? middleware.filePath : null);
    const lineNumber = extCall.lineNumber || extCall.line || 1;
    
    if (sourcePath) {
        openFile(sourcePath, lineNumber, false);
    } else if (middleware) {
        // Fallback: open middleware file at the call line
        openFile(null, lineNumber, true, middleware.name);
    } else {
        console.error('Cannot navigate: no source path and no middleware context');
    }
}

// Render middleware chain with component info
function renderMiddlewareChain(middlewares) {
    const container = document.getElementById('middleware-chain');
    container.innerHTML = '';
    
    middlewares.forEach((mw, index) => {
        const item = document.createElement('div');
        item.className = 'middleware-item';
        
        const totalReads = mw.allResLocalsReads?.length || mw.resLocalsReads.length;
        const totalWrites = mw.allResLocalsWrites?.length || mw.resLocalsWrites.length;
        const totalExternal = mw.allExternalCalls?.length || mw.externalCalls.length;
        const componentCount = mw.components?.length || 0;
        
        item.innerHTML = `
            <div class="middleware-index">${index + 1}</div>
            <div class="middleware-content">
                <div class="middleware-name">${mw.name}</div>
                <div class="middleware-status">
                    ${mw.exists ? '' : '<span class="status-item missing">⚠️ File not found</span>'}
                    <span class="status-item reads">📥 ${totalReads} reads</span>
                    <span class="status-item writes">📤 ${totalWrites} writes</span>
                    ${totalExternal > 0 ? `<span class="status-item calls">🌐 ${totalExternal} calls</span>` : ''}
                    ${componentCount > 0 ? `<span class="status-item" style="color: var(--accent-purple)">📦 ${componentCount} components</span>` : ''}
                </div>
            </div>
        `;
        
        item.addEventListener('click', () => {
            // Reset history when clicking from main view
            sidebarHistory = [];
            currentSidebarItem = null;
            showMiddlewareDetailSidebar(mw, false);
        });
        
        container.appendChild(item);
        
        if (index < middlewares.length - 1) {
            const arrow = document.createElement('div');
            arrow.className = 'middleware-arrow';
            arrow.textContent = '↓';
            container.appendChild(arrow);
        }
    });
}

// Render component tree - simplified, main detail is in sidebar
function renderComponentTree(middlewares) {
    const container = document.getElementById('component-tree-container');
    if (!container) return;
    container.innerHTML = '';
    
    middlewares.forEach((mw, mwIndex) => {
        const treeNode = document.createElement('div');
        treeNode.className = 'tree-middleware';
        
        const componentCount = countAllComponents(mw.components || []);
        const hasComponents = componentCount > 0;
        
        treeNode.innerHTML = `
            <div class="tree-mw-header" data-mw-index="${mwIndex}">
                <span class="collapse-toggle ${hasComponents ? 'expanded' : 'empty'}">${hasComponents ? '▼' : '•'}</span>
                <span class="tree-mw-icon">📦</span>
                <span class="tree-mw-name">${mwIndex + 1}. ${mw.name}</span>
                <span class="tree-mw-badge">${componentCount} components</span>
            </div>
            <div class="collapsible-content ${hasComponents ? 'expanded' : ''}">
                ${hasComponents ? renderComponentTreeItems(mw.components, mw.filePath) : '<div class="no-components">No components</div>'}
            </div>
        `;
        
        container.appendChild(treeNode);
    });
    
    // Setup event handlers
    setupTreeEventHandlers();
}

function renderComponentTreeItems(components, parentPath, depth = 0) {
    if (!components || components.length === 0) return '';
    
    return components.map((comp, idx) => {
        const hasChildren = comp.children && comp.children.length > 0;
        const reads = comp.resLocalsReads || [];
        const writes = comp.resLocalsWrites || [];
        const transReads = comp.reqTransactionReads || [];
        const transWrites = comp.reqTransactionWrites || [];
        const dataUsages = comp.dataUsages || [];
        const ownExternal = comp.externalCalls || [];
        
        // Calculate total external calls including all descendants (for bubble display)
        const totalExternal = countAllExternalCalls(comp);
        const childrenExternal = totalExternal - ownExternal.length;
        
        const icon = comp.name?.startsWith('@opus/') ? '🔧' : '📄';
        const hasData = reads.length > 0 || writes.length > 0 || transReads.length > 0 || transWrites.length > 0 || dataUsages.length > 0;
        
        // Store component data for dynamic updates
        const compDataAttr = `data-own-ext="${ownExternal.length}" data-total-ext="${totalExternal}"`;
        
        return `
            <div class="tree-component" style="margin-left: ${depth * 16}px;" ${compDataAttr}>
                <div class="tree-comp-header" 
                     data-filepath="${comp.filePath}" 
                     data-line="${comp.mainFunctionLine || 1}">
                    <span class="collapse-toggle ${hasChildren ? '' : 'empty'}">${hasChildren ? '▶' : '•'}</span>
                    <span class="tree-comp-icon ${hasData ? 'has-data' : ''}">${icon}</span>
                    <span class="tree-comp-name">${comp.displayName || comp.name}</span>
                    <div class="tree-comp-badges">
                        ${writes.length > 0 ? `<span class="badge write">W:${writes.length}</span>` : ''}
                        ${reads.length > 0 ? `<span class="badge read">R:${reads.length}</span>` : ''}
                        ${transWrites.length > 0 ? `<span class="badge trans-write">TW:${transWrites.length}</span>` : ''}
                        ${transReads.length > 0 ? `<span class="badge trans-read">TR:${transReads.length}</span>` : ''}
                        ${dataUsages.length > 0 ? `<span class="badge data">D:${dataUsages.length}</span>` : ''}
                        ${totalExternal > 0 ? `
                            <span class="badge ext ext-badge" data-own="${ownExternal.length}" data-total="${totalExternal}">
                                E:${totalExternal}${childrenExternal > 0 ? `<span class="bubble-indicator">↑</span>` : ''}
                            </span>
                        ` : ''}
                    </div>
                </div>
                ${hasChildren ? `
                    <div class="collapsible-content">
                        ${renderComponentTreeItems(comp.children, comp.filePath, depth + 1)}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

/**
 * Count all external calls in a component and all its descendants
 */
function countAllExternalCalls(component) {
    let count = (component.externalCalls || []).length;
    if (component.children) {
        for (const child of component.children) {
            count += countAllExternalCalls(child);
        }
    }
    return count;
}

function countAllComponents(components) {
    let count = components.length;
    for (const comp of components) {
        if (comp.children) {
            count += countAllComponents(comp.children);
        }
    }
    return count;
}

function setupTreeEventHandlers() {
    // Middleware header click - show detail in sidebar
    document.querySelectorAll('.tree-mw-header').forEach(header => {
        header.addEventListener('click', (e) => {
            // If clicking on toggle, expand/collapse
            if (e.target.classList.contains('collapse-toggle')) {
                e.stopPropagation();
                const toggle = e.target;
                const content = header.nextElementSibling;
                if (toggle.classList.contains('empty')) return;
                toggle.classList.toggle('expanded');
                toggle.textContent = toggle.classList.contains('expanded') ? '▼' : '▶';
                content?.classList.toggle('expanded');
                return;
            }
            // Otherwise show middleware detail - reset history when clicking from tree
            const mwIndex = parseInt(header.dataset.mwIndex);
            if (currentMiddlewares[mwIndex]) {
                sidebarHistory = [];
                currentSidebarItem = null;
                showMiddlewareDetailSidebar(currentMiddlewares[mwIndex], false);
            }
        });
    });
    
    // Component header click
    document.querySelectorAll('.tree-comp-header').forEach(header => {
        header.addEventListener('click', (e) => {
            // If clicking on toggle, expand/collapse
            if (e.target.classList.contains('collapse-toggle')) {
                e.stopPropagation();
                const toggle = e.target;
                const content = header.nextElementSibling;
                if (toggle.classList.contains('empty')) return;
                
                const isExpanding = !toggle.classList.contains('expanded');
                toggle.classList.toggle('expanded');
                toggle.textContent = toggle.classList.contains('expanded') ? '▼' : '▶';
                content?.classList.toggle('expanded');
                
                // Update external call badges based on expand/collapse state
                updateExternalCallBadges(header.closest('.tree-component'), isExpanding);
                return;
            }
            // Otherwise find and show component detail - reset history when clicking from tree
            e.stopPropagation();
            const filePath = header.dataset.filepath;
            const component = findComponentByPath(filePath);
            if (component) {
                sidebarHistory = [];
                currentSidebarItem = null;
                showComponentDetailSidebar(component, false);
            }
        });
    });
}

/**
 * Update external call badges when expanding/collapsing
 * When collapsed: show total (own + children's) with bubble indicator
 * When expanded: show only own calls (children show their own)
 */
function updateExternalCallBadges(treeComponent, isExpanding) {
    if (!treeComponent) return;
    
    const badge = treeComponent.querySelector(':scope > .tree-comp-header .ext-badge');
    if (!badge) return;
    
    const ownCount = parseInt(badge.dataset.own) || 0;
    const totalCount = parseInt(badge.dataset.total) || 0;
    const childrenCount = totalCount - ownCount;
    
    if (isExpanding) {
        // When expanded, show only own calls (children will show their own)
        if (ownCount > 0) {
            badge.innerHTML = `E:${ownCount}`;
            badge.style.display = '';
        } else {
            // Hide badge if no own calls (children have their own badges now)
            badge.style.opacity = '0.5';
            badge.innerHTML = `E:0`;
        }
    } else {
        // When collapsed, show total with bubble indicator
        badge.style.display = '';
        badge.style.opacity = '';
        badge.innerHTML = `E:${totalCount}${childrenCount > 0 ? '<span class="bubble-indicator">↑</span>' : ''}`;
    }
}

function findComponentByPath(filePath) {
    for (const mw of currentMiddlewares) {
        const found = findInComponents(mw.components, filePath);
        if (found) return found;
    }
    return null;
}

/**
 * Find component by node ID (e.g., "MW1_c0", "MW1_c0_c1")
 * Node ID format: MW{mwIndex}_c{compIndex}[_c{childIndex}...]
 */
function findComponentByNodeId(nodeId) {
    // Parse node ID: MW1_c0_c1 -> mwIndex=0, path=[0, 1]
    const match = nodeId.match(/^MW(\d+)((?:_c\d+)+)$/);
    if (!match) return null;
    
    const mwIndex = parseInt(match[1]) - 1;
    const pathStr = match[2];  // e.g., "_c0_c1"
    const pathParts = pathStr.match(/_c(\d+)/g);  // ["_c0", "_c1"]
    
    if (!currentMiddlewares[mwIndex]) return null;
    
    let components = currentMiddlewares[mwIndex].components;
    let component = null;
    
    for (const part of pathParts) {
        const idx = parseInt(part.replace('_c', ''));
        if (!components || !components[idx]) return null;
        component = components[idx];
        components = component.children;
    }
    
    return component;
}

function findInComponents(components, filePath) {
    if (!components) return null;
    for (const comp of components) {
        if (comp.filePath === filePath) return comp;
        const found = findInComponents(comp.children, filePath);
        if (found) return found;
    }
    return null;
}

// Render data flow - enhanced with more data types
function renderDataFlow(properties, middlewares, reqTransactionProperties) {
    const container = document.getElementById('property-list');
    container.innerHTML = '';
    
    // Group by data source type - separate application and library usages
    const dataGroups = {
        'res.locals': { app: [], lib: [] },
        'req.transaction': { app: [], lib: [] },
        'req.query': { app: [], lib: [] },
        'req.body': { app: [], lib: [] },
        'req.params': { app: [], lib: [] },
        'req.headers': { app: [], lib: [] },
        'req.cookies': { app: [], lib: [] },
        'res.cookie': { app: [], lib: [] },
        'res.header': { app: [], lib: [] }
    };
    
    // First, process res.locals - count actual usages from middlewares and components
    // Separate app vs library counts
    // Use a Map to track unique source files per property
    const resLocalsCountMap = new Map(); // property -> { appWriteSources: Set, appReadSources: Set, libWriteSources: Set, libReadSources: Set }
    const seenResLocalsComponents = new Set(); // Track visited components to prevent duplicate counting
    
    const countResLocalsFromSource = (source) => {
        // Skip if we've already processed this component
        if (seenResLocalsComponents.has(source.filePath)) {
            return;
        }
        seenResLocalsComponents.add(source.filePath);
        
        (source.resLocalsWrites || []).forEach(w => {
            const entry = resLocalsCountMap.get(w.property) || { 
                appWriteSources: new Set(), appReadSources: new Set(), 
                libWriteSources: new Set(), libReadSources: new Set() 
            };
            if (w.isLibrary) {
                entry.libWriteSources.add(w.sourcePath || source.filePath);
            } else {
                entry.appWriteSources.add(w.sourcePath || source.filePath);
            }
            resLocalsCountMap.set(w.property, entry);
        });
        (source.resLocalsReads || []).forEach(r => {
            const entry = resLocalsCountMap.get(r.property) || { 
                appWriteSources: new Set(), appReadSources: new Set(), 
                libWriteSources: new Set(), libReadSources: new Set() 
            };
            if (r.isLibrary) {
                entry.libReadSources.add(r.sourcePath || source.filePath);
            } else {
                entry.appReadSources.add(r.sourcePath || source.filePath);
            }
            resLocalsCountMap.set(r.property, entry);
        });
    };
    
    const countFromComponents = (components) => {
        for (const comp of (components || [])) {
            countResLocalsFromSource(comp);
            countFromComponents(comp.children);
        }
    };
    
    middlewares.forEach(mw => {
        countResLocalsFromSource(mw);
        countFromComponents(mw.components);
    });
    
    // Build res.locals entries from properties list - separate app and library
    (properties || []).forEach(prop => {
        const counts = resLocalsCountMap.get(prop.property) || { 
            appWriteSources: new Set(), appReadSources: new Set(), 
            libWriteSources: new Set(), libReadSources: new Set() 
        };
        const appWriteCount = counts.appWriteSources.size;
        const appReadCount = counts.appReadSources.size;
        const libWriteCount = counts.libWriteSources.size;
        const libReadCount = counts.libReadSources.size;
        const hasAppUsage = appWriteCount > 0 || appReadCount > 0;
        const hasLibUsage = libWriteCount > 0 || libReadCount > 0;
        
        if (hasAppUsage) {
            dataGroups['res.locals'].app.push({
                property: prop.property,
                writeCount: appWriteCount,
                readCount: appReadCount
            });
        }
        if (hasLibUsage && !hasAppUsage) {
            // Only show in library section if no app usage
            dataGroups['res.locals'].lib.push({
                property: prop.property,
                writeCount: libWriteCount,
                readCount: libReadCount,
                isLibrary: true
            });
        }
    });
    
    // Process req.transaction - count actual usages from middlewares and components
    // Use a Map to track unique source files per property
    const reqTransactionCountMap = new Map(); // property -> { appWriteSources: Set, appReadSources: Set, libWriteSources: Set, libReadSources: Set }
    const seenReqTransactionComponents = new Set(); // Track visited components to prevent duplicate counting
    
    const countReqTransactionFromSource = (source) => {
        // Skip if we've already processed this component
        if (seenReqTransactionComponents.has(source.filePath)) {
            return;
        }
        seenReqTransactionComponents.add(source.filePath);
        
        (source.reqTransactionWrites || []).forEach(w => {
            const entry = reqTransactionCountMap.get(w.property) || { 
                appWriteSources: new Set(), appReadSources: new Set(), 
                libWriteSources: new Set(), libReadSources: new Set() 
            };
            if (w.isLibrary) {
                entry.libWriteSources.add(w.sourcePath || source.filePath);
            } else {
                entry.appWriteSources.add(w.sourcePath || source.filePath);
            }
            reqTransactionCountMap.set(w.property, entry);
        });
        (source.reqTransactionReads || []).forEach(r => {
            const entry = reqTransactionCountMap.get(r.property) || { 
                appWriteSources: new Set(), appReadSources: new Set(), 
                libWriteSources: new Set(), libReadSources: new Set() 
            };
            if (r.isLibrary) {
                entry.libReadSources.add(r.sourcePath || source.filePath);
            } else {
                entry.appReadSources.add(r.sourcePath || source.filePath);
            }
            reqTransactionCountMap.set(r.property, entry);
        });
    };
    
    const countReqTransactionFromComponents = (components) => {
        for (const comp of (components || [])) {
            countReqTransactionFromSource(comp);
            countReqTransactionFromComponents(comp.children);
        }
    };
    
    middlewares.forEach(mw => {
        countReqTransactionFromSource(mw);
        countReqTransactionFromComponents(mw.components);
    });
    
    // Build req.transaction entries from properties list - separate app and library
    (reqTransactionProperties || []).forEach(prop => {
        const counts = reqTransactionCountMap.get(prop.property) || { 
            appWriteSources: new Set(), appReadSources: new Set(), 
            libWriteSources: new Set(), libReadSources: new Set() 
        };
        const appWriteCount = counts.appWriteSources.size;
        const appReadCount = counts.appReadSources.size;
        const libWriteCount = counts.libWriteSources.size;
        const libReadCount = counts.libReadSources.size;
        const hasAppUsage = appWriteCount > 0 || appReadCount > 0;
        const hasLibUsage = libWriteCount > 0 || libReadCount > 0;
        
        if (hasAppUsage) {
            dataGroups['req.transaction'].app.push({
                property: prop.property,
                writeCount: appWriteCount,
                readCount: appReadCount
            });
        }
        if (hasLibUsage && !hasAppUsage) {
            dataGroups['req.transaction'].lib.push({
                property: prop.property,
                writeCount: libWriteCount,
                readCount: libReadCount,
                isLibrary: true
            });
        }
    });
    
    // Collect other data usages from middlewares
    // Use a global seen set to prevent duplicates when same component is shared across middlewares
    const seenDataUsages = new Set(); // Track by property + sourcePath + type to prevent duplicates
    
    // Track unique source files per property for counting
    // Key: sourceType:property:type:isLibrary, Value: Set of sourcePaths
    const propertySourceFiles = new Map();
    
    middlewares.forEach(mw => {
        const collectUsagesFromSource = (source) => {
            const usages = source.dataUsages || [];
            usages.forEach(usage => {
                // Skip res.locals as it's already handled above
                if (usage.sourceType === 'res.locals') return;
                
                // Create a unique key for this usage to prevent cross-middleware duplicates
                const usageKey = `${usage.sourceType}:${usage.property}:${usage.type}:${usage.sourcePath || 'unknown'}`;
                if (seenDataUsages.has(usageKey)) {
                    return; // Skip duplicate
                }
                seenDataUsages.add(usageKey);
                
                // Track unique source files for this property
                const propKey = `${usage.sourceType}:${usage.property}:${usage.type}:${usage.isLibrary ? 'lib' : 'app'}`;
                if (!propertySourceFiles.has(propKey)) {
                    propertySourceFiles.set(propKey, new Set());
                }
                propertySourceFiles.get(propKey).add(usage.sourcePath || 'unknown');
            });
        };
        
        const collectFromComponents = (components) => {
            for (const comp of (components || [])) {
                collectUsagesFromSource(comp);
                collectFromComponents(comp.children);
            }
        };
        
        collectUsagesFromSource(mw);
        collectFromComponents(mw.components);
    });
    
    // Build dataGroups from propertySourceFiles - count by unique source files, not total usages
    propertySourceFiles.forEach((sourcePaths, propKey) => {
        const [sourceType, property, type, group] = propKey.split(':');
        if (!dataGroups[sourceType]) return;
        
        const targetGroup = group === 'lib' ? 'lib' : 'app';
        const existing = dataGroups[sourceType][targetGroup].find(u => u.property === property);
        const count = sourcePaths.size; // Count unique source files
        
        if (!existing) {
            dataGroups[sourceType][targetGroup].push({
                property: property,
                writeCount: type === 'write' ? count : 0,
                readCount: type === 'read' ? count : 0,
                isLibrary: group === 'lib'
            });
        } else {
            if (type === 'write') existing.writeCount = count;
            if (type === 'read') existing.readCount = count;
        }
    });
    
    // Render each group - app properties first, then library properties at bottom
    Object.entries(dataGroups).forEach(([sourceType, { app: appProps, lib: libProps }]) => {
        const totalCount = appProps.length + libProps.length;
        if (totalCount === 0) return;
        
        const section = document.createElement('div');
        section.className = 'data-section';
        
        // Render app properties
        const appItemsHtml = appProps.map(prop => `
            <div class="property-card" data-property="${prop.property}" data-source="${sourceType}">
                <div class="property-name">${prop.property}</div>
                <div class="property-flow">
                    ${prop.writeCount > 0 ? `<span class="producers">📤 ${prop.writeCount}</span>` : ''}
                    ${prop.readCount > 0 ? `<span class="consumers">📥 ${prop.readCount}</span>` : ''}
                </div>
            </div>
        `).join('');
        
        // Render library properties (if any) with a separator
        let libItemsHtml = '';
        if (libProps.length > 0) {
            libItemsHtml = `
                <div class="library-separator">
                    <span class="separator-line"></span>
                    <span class="separator-label">📚 Library (${libProps.length})</span>
                    <span class="separator-line"></span>
                </div>
                ${libProps.map(prop => `
                    <div class="property-card library-property" data-property="${prop.property}" data-source="${sourceType}">
                        <div class="property-name">${prop.property}</div>
                        <div class="property-flow">
                            ${prop.writeCount > 0 ? `<span class="producers">📤 ${prop.writeCount}</span>` : ''}
                            ${prop.readCount > 0 ? `<span class="consumers">📥 ${prop.readCount}</span>` : ''}
                        </div>
                    </div>
                `).join('')}
            `;
        }
        
        section.innerHTML = `
            <div class="data-section-header">
                <span class="data-section-icon">${getDataSourceIcon(sourceType)}</span>
                <span class="data-section-title">${sourceType}</span>
                <span class="data-section-count">${appProps.length}${libProps.length > 0 ? ` + ${libProps.length}` : ''}</span>
            </div>
            <div class="data-section-items">
                ${appItemsHtml}
                ${libItemsHtml}
            </div>
        `;
        container.appendChild(section);
    });
    
    // Add click handlers
    document.querySelectorAll('.property-card').forEach(card => {
        card.addEventListener('click', (e) => {
            const property = card.dataset.property;
            const source = card.dataset.source;
            // Store card element rect for proper floating panel positioning
            lastClickedCardRect = card.getBoundingClientRect();
            if (source === 'res.locals') {
                vscode.postMessage({
                    command: 'trackProperty',
                    property: property
                });
            } else if (source === 'req.transaction') {
                vscode.postMessage({
                    command: 'trackReqTransaction',
                    property: property
                });
            } else {
                // Show local tracking for other data types
                showDataUsageDetail(source, property, e);
            }
        });
    });
}

function getDataSourceIcon(sourceType) {
    const icons = {
        'res.locals': '💾',
        'req.transaction': '📊',
        'req.query': '❓',
        'req.body': '📝',
        'req.params': '🔗',
        'req.headers': '📋',
        'req.cookies': '🍪',
        'res.cookie': '🍪',
        'res.header': '📤'
    };
    return icons[sourceType] || '📦';
}

function showDataUsageDetail(sourceType, property, event) {
    const usages = [];
    const seenKeys = new Set(); // Prevent duplicates from multi-referenced components
    const seenFilePaths = new Set(); // Track visited file paths to prevent duplicate component traversal
    
    const collectUsages = (source, sourceName, isComponent = false) => {
        // Skip if we've already processed this component
        if (isComponent && seenFilePaths.has(source.filePath)) {
            return;
        }
        if (isComponent) {
            seenFilePaths.add(source.filePath);
        }
        
        const dataUsages = source.dataUsages || [];
        dataUsages.filter(d => d.sourceType === sourceType && d.property === property).forEach(d => {
            // Create a unique key to prevent duplicates
            const key = `${source.filePath}:${d.lineNumber}:${d.type}`;
            if (seenKeys.has(key)) return;
            seenKeys.add(key);
            
            usages.push({
                source: sourceName,
                filePath: source.filePath,
                isComponent,
                isLibrary: d.isLibrary,
                type: d.type,
                lineNumber: d.lineNumber,
                codeSnippet: d.codeSnippet
            });
        });
    };
    
    const collectFromComponents = (components, parentName) => {
        for (const comp of (components || [])) {
            collectUsages(comp, `${parentName} → ${comp.displayName}`, true);
            collectFromComponents(comp.children, `${parentName} → ${comp.displayName}`);
        }
    };
    
    currentMiddlewares.forEach(mw => {
        collectUsages(mw, mw.name, false);
        collectFromComponents(mw.components, mw.name);
    });
    
    // Card rect is already stored by the click handler
    
    showPropertyUsages({
        property: property,
        sourceType: sourceType,
        producers: usages.filter(u => u.type === 'write').map(u => u.source),
        consumers: usages.filter(u => u.type === 'read').map(u => u.source),
        usages: usages
    });
}

// Filter properties
function filterProperties(query) {
    const cards = document.querySelectorAll('.property-card');
    const lowerQuery = query.toLowerCase();
    
    cards.forEach(card => {
        const name = card.querySelector('.property-name').textContent.toLowerCase();
        card.style.display = name.includes(lowerQuery) ? 'flex' : 'none';
    });
}

// Show property usages in floating panel - grouped by source file, collapsed by default
function showPropertyUsages(data, sourceType = 'res.locals') {
    const panel = document.getElementById('property-detail-floating');
    const titleEl = document.getElementById('floating-panel-title');
    const contentEl = document.getElementById('floating-panel-content');
    
    // Position panel based on clicked card rect
    positionFloatingPanel(panel);
    
    panel.classList.add('visible');
    
    const sourceLabel = data.sourceType || sourceType;
    titleEl.textContent = `${sourceLabel}.${data.property}`;
    
    const usages = data.usages || [];
    
    // Count unique source files for writes and reads (not total usages)
    const writeFiles = new Set(usages.filter(u => u.type === 'write').map(u => u.filePath || u.source));
    const readFiles = new Set(usages.filter(u => u.type === 'read').map(u => u.filePath || u.source));
    const writeCount = writeFiles.size;
    const readCount = readFiles.size;
    
    if (usages.length === 0) {
        contentEl.innerHTML = `<div class="floating-no-usage">No usages found</div>`;
        return;
    }
    
    // Group usages by source file
    const groupedByFile = {};
    usages.forEach(usage => {
        const fileKey = usage.filePath || usage.source || 'unknown';
        if (!groupedByFile[fileKey]) {
            groupedByFile[fileKey] = {
                filePath: usage.filePath,
                source: usage.source,
                isComponent: usage.isComponent,
                isLibrary: usage.isLibrary,
                usages: []
            };
        }
        groupedByFile[fileKey].usages.push(usage);
    });
    
    // Separate app and library groups
    const appGroups = [];
    const libGroups = [];
    Object.values(groupedByFile).forEach(group => {
        if (group.isLibrary) {
            libGroups.push(group);
        } else {
            appGroups.push(group);
        }
    });
    
    // Render grouped usages
    const renderGroup = (group, index, isLibrary = false) => {
        const displayName = group.source || getFileDisplayName(group.filePath);
        const writes = group.usages.filter(u => u.type === 'write');
        const reads = group.usages.filter(u => u.type === 'read');
        const groupId = `usage-group-${index}`;
        const libClass = isLibrary ? 'library-group' : '';
        
        return `
            <div class="usage-file-group ${libClass}">
                <div class="usage-file-header" data-group="${groupId}">
                    <span class="group-toggle">▶</span>
                    <span class="group-file-name" title="${group.filePath || ''}">${displayName}</span>
                    <span class="group-counts">
                        ${writes.length > 0 ? `<span class="write-count">📤${writes.length}</span>` : ''}
                        ${reads.length > 0 ? `<span class="read-count">📥${reads.length}</span>` : ''}
                    </span>
                </div>
                <div class="usage-file-content" id="${groupId}" style="display: none;">
                    ${group.usages.map(usage => `
                        <div class="floating-usage-item" 
                             data-filepath="${usage.filePath || ''}" 
                             data-middleware="${usage.source || usage.middleware}" 
                             data-line="${usage.lineNumber}"
                             data-iscomponent="${usage.isComponent || false}">
                            <span class="usage-type ${usage.type}">${usage.type}</span>
                            <span class="usage-line">:${usage.lineNumber}</span>
                            <span class="usage-snippet" title="${escapeHtml(usage.codeSnippet || '')}">${truncate(usage.codeSnippet || '', 40)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    };
    
    // Build HTML with app groups first, then library groups
    let groupsHtml = appGroups.map((g, i) => renderGroup(g, i, false)).join('');
    
    if (libGroups.length > 0) {
        groupsHtml += `
            <div class="library-section-header">
                <span class="separator-line"></span>
                <span class="separator-label">📚 Library (${libGroups.length} files)</span>
                <span class="separator-line"></span>
            </div>
        `;
        groupsHtml += libGroups.map((g, i) => renderGroup(g, appGroups.length + i, true)).join('');
    }
    
    contentEl.innerHTML = `
        <div class="floating-usage-summary">
            <span class="producer-count">📤 ${writeCount} Source(s)</span>
            <span class="arrow">→</span>
            <span class="consumer-count">📥 ${readCount} Source(s)</span>
        </div>
        <div class="floating-usage-groups">
            ${groupsHtml}
        </div>
    `;
    
    // Add click handlers for group toggles
    contentEl.querySelectorAll('.usage-file-header').forEach(header => {
        header.addEventListener('click', (e) => {
            e.stopPropagation();
            const groupId = header.dataset.group;
            const content = document.getElementById(groupId);
            const toggle = header.querySelector('.group-toggle');
            
            if (content.style.display === 'none') {
                content.style.display = 'block';
                toggle.textContent = '▼';
                header.classList.add('expanded');
            } else {
                content.style.display = 'none';
                toggle.textContent = '▶';
                header.classList.remove('expanded');
            }
        });
    });
    
    // Add click handlers for usage items
    contentEl.querySelectorAll('.floating-usage-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const filePath = item.dataset.filepath;
            const isComponent = item.dataset.iscomponent === 'true';
            const lineNumber = parseInt(item.dataset.line);
            
            if (isComponent && filePath) {
                openFile(filePath, lineNumber, false);
            } else {
                openFile(null, lineNumber, true, item.dataset.middleware);
            }
        });
    });
}

// Helper function to get display name from file path
function getFileDisplayName(filePath) {
    if (!filePath) return 'unknown';
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || filePath;
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper function to truncate text
function truncate(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

// Initialize floating panel with close button and drag support
function initializeFloatingPanel() {
    const panel = document.getElementById('property-detail-floating');
    const header = document.querySelector('.floating-panel-header');
    const closeBtn = document.getElementById('floating-panel-close');
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            panel.classList.remove('visible');
        });
    }
    
    // Click outside to close
    document.addEventListener('click', (e) => {
        if (panel.classList.contains('visible') && 
            !panel.contains(e.target) && 
            !e.target.closest('.property-card')) {
            panel.classList.remove('visible');
        }
    });
    
    // Drag support for header
    if (header) {
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.floating-panel-close')) return;
            
            floatingPanelDrag.isDragging = true;
            floatingPanelDrag.startX = e.clientX;
            floatingPanelDrag.startY = e.clientY;
            floatingPanelDrag.panelStartX = panel.offsetLeft;
            floatingPanelDrag.panelStartY = panel.offsetTop;
            e.preventDefault();
        });
    }
    
    document.addEventListener('mousemove', (e) => {
        if (!floatingPanelDrag.isDragging) return;
        
        const dx = e.clientX - floatingPanelDrag.startX;
        const dy = e.clientY - floatingPanelDrag.startY;
        
        let newX = floatingPanelDrag.panelStartX + dx;
        let newY = floatingPanelDrag.panelStartY + dy;
        
        // Keep panel within viewport
        const panelWidth = panel.offsetWidth;
        const panelHeight = panel.offsetHeight;
        newX = Math.max(0, Math.min(newX, window.innerWidth - panelWidth));
        newY = Math.max(0, Math.min(newY, window.innerHeight - panelHeight));
        
        panel.style.left = newX + 'px';
        panel.style.top = newY + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        floatingPanelDrag.isDragging = false;
    });
}

// Position floating panel - never overlap the clicked card
function positionFloatingPanel(panel) {
    const panelWidth = 580;
    const panelMaxHeight = window.innerHeight * 0.75;
    const gap = 15; // Gap between card and panel
    const padding = 10;
    
    if (!lastClickedCardRect) {
        // Fallback: center in viewport
        panel.style.left = Math.max(padding, (window.innerWidth - panelWidth) / 2) + 'px';
        panel.style.top = padding + 'px';
        return;
    }
    
    const cardRect = lastClickedCardRect;
    
    // Determine horizontal position: prefer right of card, otherwise left
    let x;
    const spaceOnRight = window.innerWidth - cardRect.right - gap - padding;
    const spaceOnLeft = cardRect.left - gap - padding;
    
    if (spaceOnRight >= panelWidth) {
        // Place to the right of the card
        x = cardRect.right + gap;
    } else if (spaceOnLeft >= panelWidth) {
        // Place to the left of the card
        x = cardRect.left - panelWidth - gap;
    } else {
        // Not enough space on either side - place where there's more space
        if (spaceOnRight >= spaceOnLeft) {
            x = cardRect.right + gap;
        } else {
            x = Math.max(padding, cardRect.left - panelWidth - gap);
        }
    }
    
    // Ensure x is within bounds
    x = Math.max(padding, Math.min(x, window.innerWidth - panelWidth - padding));
    
    // Determine vertical position based on card position in viewport
    let y;
    const viewportHeight = window.innerHeight;
    const cardCenterY = cardRect.top + cardRect.height / 2;
    const viewportCenterY = viewportHeight / 2;
    
    if (cardCenterY < viewportCenterY) {
        // Card is in upper half - align panel top with card top
        y = cardRect.top;
    } else {
        // Card is in lower half - align panel bottom with card bottom
        y = cardRect.bottom - panelMaxHeight;
    }
    
    // Ensure panel stays within viewport
    y = Math.max(padding, Math.min(y, viewportHeight - panelMaxHeight - padding));
    
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
}

// Render config view
function renderConfigView(endpoint, middlewares) {
    const container = document.getElementById('config-section');
    
    const configDeps = {
        mWareConfig: new Set(),
        appConfig: new Set(),
        sysParameter: new Set()
    };
    
    middlewares.forEach(mw => {
        (mw.allConfigDeps || mw.configDeps || []).forEach(dep => {
            if (configDeps[dep.source]) {
                configDeps[dep.source].add(dep.key);
            }
        });
    });
    
    container.innerHTML = `
        <div class="config-card">
            <div class="config-card-header">
                <span class="config-card-title">📋 Endpoint Configuration</span>
                <button class="config-card-action" data-config="customRoutes">Open File</button>
            </div>
            <div class="config-card-content">
                <div class="config-item"><span class="config-key">template</span><span class="config-value">${endpoint.template || 'N/A'}</span></div>
                <div class="config-item"><span class="config-key">panic</span><span class="config-value">${endpoint.panic || 'false'}</span></div>
                ${endpoint.panicConfigKey ? `<div class="config-item"><span class="config-key">panicConfigKey</span><span class="config-value">${endpoint.panicConfigKey}</span></div>` : ''}
                ${endpoint.nanoConfigKey ? `<div class="config-item"><span class="config-key">nanoConfigKey</span><span class="config-value">${endpoint.nanoConfigKey}</span></div>` : ''}
            </div>
        </div>
        
        <div class="config-card">
            <div class="config-card-header">
                <span class="config-card-title">⚙️ mWareConfig Dependencies</span>
                <button class="config-card-action" data-config="mWareConfig">Open File</button>
            </div>
            <div class="config-card-content">
                ${Array.from(configDeps.mWareConfig).map(key => `<div class="config-item"><span class="config-key">${key}</span></div>`).join('') || '<div class="config-item"><span class="config-value">No dependencies found</span></div>'}
            </div>
        </div>
        
        <div class="config-card">
            <div class="config-card-header">
                <span class="config-card-title">🔧 System Parameters</span>
            </div>
            <div class="config-card-content">
                ${Array.from(configDeps.sysParameter).map(key => `<div class="config-item"><span class="config-key">${key}</span></div>`).join('') || '<div class="config-item"><span class="config-value">No dependencies found</span></div>'}
            </div>
        </div>
    `;
    
    container.querySelectorAll('.config-card-action').forEach(btn => {
        btn.addEventListener('click', () => {
            vscode.postMessage({
                command: 'openConfigFile',
                configType: btn.dataset.config
            });
        });
    });
}

// ============================================
// SIDEBAR FUNCTIONS - Enhanced and fixed
// ============================================

// Update back button visibility
function updateBackButton() {
    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
        backBtn.style.display = sidebarHistory.length > 0 ? 'flex' : 'none';
    }
}

// Navigate back in sidebar history
function navigateBack() {
    if (sidebarHistory.length > 0) {
        const previous = sidebarHistory.pop();
        currentSidebarItem = previous;
        if (previous.type === 'middleware') {
            showMiddlewareDetailSidebar(previous.item, false);
        } else {
            showComponentDetailSidebar(previous.item, false);
        }
    }
}

// Show middleware detail in sidebar
function showMiddlewareDetailSidebar(middleware, addToHistory = true) {
    // Add current to history before switching (if not initial or back navigation)
    if (addToHistory && currentSidebarItem) {
        sidebarHistory.push(currentSidebarItem);
    }
    currentSidebarItem = { type: 'middleware', item: middleware };
    updateBackButton();

    const sidebar = document.getElementById('detail-sidebar');
    const content = document.getElementById('sidebar-content');
    const title = document.getElementById('sidebar-title');
    
    title.textContent = middleware.name;
    
    const components = middleware.components || [];
    const dataUsages = middleware.dataUsages || [];
    
    // Group data usages by source type
    const inputUsages = dataUsages.filter(d => d.type === 'read');
    const outputUsages = dataUsages.filter(d => d.type === 'write');
    
    content.innerHTML = `
        <!-- File Info -->
        <div class="sidebar-section">
            <div class="section-title">📁 File</div>
            <div class="section-content">
                <div class="clickable-item file-link" data-path="${middleware.name}" data-line="${middleware.runFunctionLine || 1}">
                    <code>${middleware.filePath.split(/[/\\]/).slice(-3).join('/')}</code>
                </div>
                ${middleware.runFunctionLine ? `
                <div class="clickable-item file-link" data-path="${middleware.name}" data-line="${middleware.runFunctionLine}">
                    Go to <code>run()</code> function (line ${middleware.runFunctionLine})
                </div>
                ` : ''}
            </div>
        </div>
        
        <!-- Components - Collapsible -->
        ${components.length > 0 ? `
        <div class="sidebar-section">
            <div class="section-title collapsible" data-collapsed="false">
                <span class="collapse-icon">▼</span>
                📦 Components (${countAllComponents(components)})
            </div>
            <div class="section-content collapsible-body">
                ${renderSidebarComponentTree(components, 0)}
            </div>
        </div>
        ` : ''}
        
        <!-- Input Data (Reads) -->
        <div class="sidebar-section">
            <div class="section-title collapsible" data-collapsed="false">
                <span class="collapse-icon">▼</span>
                📥 Input Data
            </div>
            <div class="section-content collapsible-body">
                ${renderDataUsageGroup('res.locals', middleware.resLocalsReads, middleware.filePath)}
                ${renderDataUsageGroup('req.query', inputUsages.filter(d => d.sourceType === 'req.query'), middleware.filePath)}
                ${renderDataUsageGroup('req.body', inputUsages.filter(d => d.sourceType === 'req.body'), middleware.filePath)}
                ${renderDataUsageGroup('req.params', inputUsages.filter(d => d.sourceType === 'req.params'), middleware.filePath)}
                ${renderDataUsageGroup('req.headers', inputUsages.filter(d => d.sourceType === 'req.headers'), middleware.filePath)}
                ${renderDataUsageGroup('req.cookies', inputUsages.filter(d => d.sourceType === 'req.cookies'), middleware.filePath)}
            </div>
        </div>
        
        <!-- Output Data (Writes) -->
        <div class="sidebar-section">
            <div class="section-title collapsible" data-collapsed="false">
                <span class="collapse-icon">▼</span>
                📤 Output Data
            </div>
            <div class="section-content collapsible-body">
                ${renderDataUsageGroup('res.locals', middleware.resLocalsWrites, middleware.filePath)}
                ${renderDataUsageGroup('res.cookie', outputUsages.filter(d => d.sourceType === 'res.cookie'), middleware.filePath)}
                ${renderDataUsageGroup('res.header', outputUsages.filter(d => d.sourceType === 'res.header'), middleware.filePath)}
            </div>
        </div>
        
        <!-- External Calls - show only this middleware's own calls, with option to see all -->
        <div class="sidebar-section">
            <div class="section-title collapsible" data-collapsed="false">
                <span class="collapse-icon">▼</span>
                🌐 External Calls (${middleware.externalCalls?.length || 0})
                ${(middleware.allExternalCalls?.length || 0) > (middleware.externalCalls?.length || 0) ? 
                    `<span class="all-calls-badge" title="Total calls including components">(${middleware.allExternalCalls.length} total)</span>` : ''}
            </div>
            <div class="section-content collapsible-body">
                ${(middleware.externalCalls?.length || 0) > 0 ? 
                    renderExternalCallsGrouped(middleware.externalCalls, middleware.filePath) :
                    '<div class="empty-msg">No direct external calls in this middleware</div>'
                }
                ${(middleware.allExternalCalls?.length || 0) > (middleware.externalCalls?.length || 0) ? `
                    <div class="show-all-calls-section">
                        <div class="show-all-calls-toggle" onclick="toggleAllExternalCalls(this)">
                            ▶ Show all calls from components (${middleware.allExternalCalls.length - (middleware.externalCalls?.length || 0)} more)
                        </div>
                        <div class="all-calls-content" style="display: none;">
                            ${renderExternalCallsGrouped(
                                middleware.allExternalCalls.filter(c => 
                                    !middleware.externalCalls?.some(mc => 
                                        mc.type === c.type && mc.template === c.template && mc.sourcePath === c.sourcePath
                                    )
                                ), 
                                middleware.filePath
                            )}
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
        
        <!-- Config Dependencies -->
        <div class="sidebar-section">
            <div class="section-title collapsible" data-collapsed="true">
                <span class="collapse-icon">▶</span>
                ⚙️ Config Dependencies (${middleware.configDeps?.length || 0})
            </div>
            <div class="section-content collapsible-body collapsed">
                ${(middleware.configDeps || []).map(d => `
                    <div class="config-dep-item">
                        <span class="config-source">${d.source}</span>
                        <code>${d.key}</code>
                    </div>
                `).join('') || '<div class="empty-msg">None</div>'}
            </div>
        </div>
    `;
    
    setupSidebarEventHandlers(content, middleware, true);
    sidebar.classList.add('open');
}

function renderSidebarComponentTree(components, depth) {
    return components.map(comp => {
        const hasChildren = comp.children && comp.children.length > 0;
        const reads = comp.resLocalsReads || [];
        const writes = comp.resLocalsWrites || [];
        const dataUsages = comp.dataUsages || [];
        const hasData = reads.length > 0 || writes.length > 0 || dataUsages.length > 0;
        
        const icon = comp.name?.startsWith('@opus/') ? '🔧' : '📄';
        const indent = depth * 12;
        
        return `
            <div class="sidebar-comp-tree" style="margin-left: ${indent}px;">
                <div class="sidebar-comp-header ${hasChildren ? 'has-children' : ''}" 
                     data-filepath="${comp.filePath}" 
                     data-line="${comp.mainFunctionLine || 1}"
                     data-collapsed="${hasChildren ? 'true' : 'false'}">
                    ${hasChildren ? '<span class="collapse-icon">▶</span>' : '<span class="collapse-icon empty">•</span>'}
                    <span class="comp-icon ${hasData ? 'has-data' : ''}">${icon}</span>
                    <span class="comp-name">${comp.displayName || comp.name}</span>
                    <div class="comp-badges">
                        ${writes.length > 0 ? `<span class="badge write">W:${writes.length}</span>` : ''}
                        ${reads.length > 0 ? `<span class="badge read">R:${reads.length}</span>` : ''}
                        ${dataUsages.length > 0 ? `<span class="badge data">D:${dataUsages.length}</span>` : ''}
                    </div>
                </div>
                ${hasChildren ? `
                    <div class="sidebar-comp-children collapsed">
                        ${renderSidebarComponentTree(comp.children, depth + 1)}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

/**
 * Render external calls grouped by type, with source file info
 * Groups calls by type (AVS, DCQ, etc.) and shows which file they come from
 */
function renderExternalCallsGrouped(calls, defaultFilePath) {
    if (!calls || calls.length === 0) {
        return '<div class="empty-msg">None</div>';
    }
    
    // Group calls by type
    const callsByType = {};
    calls.forEach(call => {
        const type = (call.type || 'unknown').toUpperCase();
        if (!callsByType[type]) {
            callsByType[type] = [];
        }
        callsByType[type].push(call);
    });
    
    // Sort types alphabetically
    const sortedTypes = Object.keys(callsByType).sort();
    
    return sortedTypes.map(type => {
        const typeCalls = callsByType[type];
        const typeIcon = getExternalCallIcon(type);
        
        return `
            <div class="ext-call-group">
                <div class="ext-call-group-header">
                    ${typeIcon} ${type} (${typeCalls.length})
                </div>
                <div class="ext-call-group-items">
                    ${typeCalls.map(c => {
                        const sourceFile = c.sourcePath ? c.sourcePath.split(/[/\\]/).slice(-2).join('/') : '';
                        return `
                            <div class="clickable-item ext-call" data-path="${c.sourcePath || defaultFilePath}" data-line="${c.lineNumber}">
                                ${c.template ? `<code>${c.template}</code>` : '<span class="no-template">(no name)</span>'}
                                ${sourceFile ? `<span class="source-file" title="${c.sourcePath}">${sourceFile}</span>` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');
}

function getExternalCallIcon(type) {
    const icons = {
        'AVS': '🔗',
        'DCQ': '📊',
        'ELASTICSEARCH': '🔍',
        'PINBOARD': '📌',
        'HTTP': '🌐',
        'EXTERNAL': '🔌',
        'MICROSERVICE': '⚡',
        'DSF': '📡',
        'AVA': '🎬'
    };
    return icons[type] || '📡';
}

/**
 * Toggle visibility of all external calls from components section
 */
function toggleAllExternalCalls(toggleElement) {
    const section = toggleElement.closest('.show-all-calls-section');
    const content = section.querySelector('.all-calls-content');
    const isExpanded = content.style.display !== 'none';
    
    if (isExpanded) {
        content.style.display = 'none';
        toggleElement.textContent = toggleElement.textContent.replace('▼', '▶');
    } else {
        content.style.display = 'block';
        toggleElement.textContent = toggleElement.textContent.replace('▶', '▼');
    }
}

function renderDataUsageGroup(sourceType, usages, filePath) {
    if (!usages || usages.length === 0) return '';
    
    const icon = getDataSourceIcon(sourceType);
    return `
        <div class="data-group">
            <div class="data-group-header">${icon} ${sourceType} (${usages.length})</div>
            <div class="data-group-items">
                ${usages.map(u => `
                    <div class="clickable-item data-item" data-path="${u.sourcePath || filePath}" data-line="${u.lineNumber}">
                        <code>${u.property}</code>
                        <span class="line-num">:${u.lineNumber}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// Show external calls list for a component in sidebar
function showExternalCallsSidebar(component) {
    // Add current to history before switching
    if (currentSidebarItem) {
        sidebarHistory.push(currentSidebarItem);
    }
    currentSidebarItem = { type: 'externalCalls', item: component };
    updateBackButton();

    const sidebar = document.getElementById('detail-sidebar');
    const content = document.getElementById('sidebar-content');
    const title = document.getElementById('sidebar-title');
    
    title.textContent = `📡 ${component.displayName || component.name} - External Calls`;
    
    const externalCalls = component.externalCalls || [];
    
    // Group calls by type
    const callsByType = {};
    externalCalls.forEach(call => {
        const type = call.type || 'unknown';
        if (!callsByType[type]) {
            callsByType[type] = [];
        }
        callsByType[type].push(call);
    });
    
    content.innerHTML = `
        <!-- Component File -->
        <div class="sidebar-section">
            <div class="section-title">📁 Source</div>
            <div class="section-content">
                <div class="clickable-item component-file" data-filepath="${component.filePath}" data-line="${component.mainFunctionLine || 1}">
                    <code>${component.filePath.split(/[/\\]/).slice(-3).join('/')}</code>
                </div>
            </div>
        </div>
        
        <!-- External Calls by Type -->
        ${Object.entries(callsByType).map(([type, calls]) => `
        <div class="sidebar-section">
            <div class="section-title collapsible" data-collapsed="false">
                <span class="collapse-icon">▼</span>
                ${getCallTypeEmoji(type)} ${type.toUpperCase()} (${calls.length})
            </div>
            <div class="section-content collapsible-body">
                ${calls.map(c => `
                    <div class="clickable-item ext-call" data-path="${c.sourcePath || component.filePath}" data-line="${c.lineNumber}">
                        <div class="ext-call-url">${c.template || c.url || 'Unknown URL'}</div>
                        ${c.method ? `<span class="call-method">${c.method}</span>` : ''}
                        <span class="line-num">:${c.lineNumber}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        `).join('') || '<div class="empty-msg">No external calls</div>'}
    `;
    
    setupSidebarEventHandlers(content, component, false);
    sidebar.classList.add('open');
}

// Get emoji for external call type
function getCallTypeEmoji(type) {
    switch (type?.toLowerCase()) {
        case 'get': return '📥';
        case 'post': return '📤';
        case 'put': return '📝';
        case 'delete': return '🗑️';
        case 'patch': return '🔧';
        case 'axios': return '🌐';
        case 'fetch': return '🔗';
        default: return '🌐';
    }
}

// Show middleware external calls in sidebar
function showMiddlewareExternalCallsSidebar(middleware) {
    // Add current to history before switching
    if (currentSidebarItem) {
        sidebarHistory.push(currentSidebarItem);
    }
    currentSidebarItem = { type: 'middlewareExternalCalls', item: middleware };
    updateBackButton();

    const sidebar = document.getElementById('detail-sidebar');
    const content = document.getElementById('sidebar-content');
    const title = document.getElementById('sidebar-title');
    
    title.textContent = `📡 ${middleware.name} - All External Calls`;
    
    // Collect all external calls from middleware and its components
    const allCalls = [];
    
    // Add middleware's own external calls
    (middleware.externalCalls || []).forEach(call => {
        allCalls.push({ ...call, source: middleware.name, sourcePath: call.sourcePath || middleware.filePath });
    });
    
    // Add external calls from all components recursively
    function collectComponentCalls(components, level = 0) {
        (components || []).forEach(comp => {
            (comp.externalCalls || []).forEach(call => {
                allCalls.push({ ...call, source: comp.displayName || comp.name, sourcePath: call.sourcePath || comp.filePath });
            });
            if (comp.children) {
                collectComponentCalls(comp.children, level + 1);
            }
        });
    }
    collectComponentCalls(middleware.components);
    
    // Group calls by source
    const callsBySource = {};
    allCalls.forEach(call => {
        const source = call.source;
        if (!callsBySource[source]) {
            callsBySource[source] = [];
        }
        callsBySource[source].push(call);
    });
    
    content.innerHTML = `
        <!-- Middleware File -->
        <div class="sidebar-section">
            <div class="section-title">📁 Middleware</div>
            <div class="section-content">
                <div class="clickable-item component-file" data-filepath="${middleware.filePath}" data-line="1">
                    <code>${middleware.filePath.split(/[/\\]/).slice(-3).join('/')}</code>
                </div>
            </div>
        </div>
        
        <!-- Summary -->
        <div class="sidebar-section">
            <div class="section-title">📊 Summary</div>
            <div class="section-content">
                <div class="summary-text">Total: ${allCalls.length} external calls from ${Object.keys(callsBySource).length} sources</div>
            </div>
        </div>
        
        <!-- External Calls by Source -->
        ${Object.entries(callsBySource).map(([source, calls]) => `
        <div class="sidebar-section">
            <div class="section-title collapsible" data-collapsed="false">
                <span class="collapse-icon">▼</span>
                📦 ${source} (${calls.length})
            </div>
            <div class="section-content collapsible-body">
                ${calls.map(c => `
                    <div class="clickable-item ext-call" data-path="${c.sourcePath}" data-line="${c.lineNumber}">
                        <span class="call-type">${c.type?.toUpperCase() || 'HTTP'}</span>
                        <div class="ext-call-url">${c.template || c.url || 'Unknown URL'}</div>
                        <span class="line-num">:${c.lineNumber}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        `).join('') || '<div class="empty-msg">No external calls</div>'}
    `;
    
    setupSidebarEventHandlers(content, middleware, true);
    sidebar.classList.add('open');
}

// Show component detail in sidebar
function showComponentDetailSidebar(component, addToHistory = true) {
    // Add current to history before switching (if not initial or back navigation)
    if (addToHistory && currentSidebarItem) {
        sidebarHistory.push(currentSidebarItem);
    }
    currentSidebarItem = { type: 'component', item: component };
    updateBackButton();

    const sidebar = document.getElementById('detail-sidebar');
    const content = document.getElementById('sidebar-content');
    const title = document.getElementById('sidebar-title');
    
    title.textContent = component.displayName || component.name;
    
    const dataUsages = component.dataUsages || [];
    const inputUsages = dataUsages.filter(d => d.type === 'read');
    const outputUsages = dataUsages.filter(d => d.type === 'write');
    
    content.innerHTML = `
        <!-- File Info -->
        <div class="sidebar-section">
            <div class="section-title">📁 File</div>
            <div class="section-content">
                <div class="clickable-item component-file" data-filepath="${component.filePath}" data-line="${component.mainFunctionLine || 1}">
                    <code>${component.filePath.split(/[/\\]/).slice(-3).join('/')}</code>
                </div>
            </div>
        </div>
        
        <!-- Exported Functions -->
        ${component.exportedFunctions?.length > 0 ? `
        <div class="sidebar-section">
            <div class="section-title">📤 Exports</div>
            <div class="section-content">
                <div class="exports-list">${component.exportedFunctions.join(', ')}</div>
            </div>
        </div>
        ` : ''}
        
        <!-- Child Components -->
        ${component.children?.length > 0 ? `
        <div class="sidebar-section">
            <div class="section-title collapsible" data-collapsed="false">
                <span class="collapse-icon">▼</span>
                📦 Sub-components (${component.children.length})
            </div>
            <div class="section-content collapsible-body">
                ${renderSidebarComponentTree(component.children, 0)}
            </div>
        </div>
        ` : ''}
        
        <!-- Input Data -->
        <div class="sidebar-section">
            <div class="section-title collapsible" data-collapsed="false">
                <span class="collapse-icon">▼</span>
                📥 Input Data
            </div>
            <div class="section-content collapsible-body">
                ${renderDataUsageGroup('res.locals', component.resLocalsReads, component.filePath)}
                ${renderDataUsageGroup('req.query', inputUsages.filter(d => d.sourceType === 'req.query'), component.filePath)}
                ${renderDataUsageGroup('req.body', inputUsages.filter(d => d.sourceType === 'req.body'), component.filePath)}
                ${renderDataUsageGroup('req.params', inputUsages.filter(d => d.sourceType === 'req.params'), component.filePath)}
                ${renderDataUsageGroup('req.headers', inputUsages.filter(d => d.sourceType === 'req.headers'), component.filePath)}
            </div>
        </div>
        
        <!-- Output Data -->
        <div class="sidebar-section">
            <div class="section-title collapsible" data-collapsed="false">
                <span class="collapse-icon">▼</span>
                📤 Output Data
            </div>
            <div class="section-content collapsible-body">
                ${renderDataUsageGroup('res.locals', component.resLocalsWrites, component.filePath)}
                ${renderDataUsageGroup('res.cookie', outputUsages.filter(d => d.sourceType === 'res.cookie'), component.filePath)}
                ${renderDataUsageGroup('res.header', outputUsages.filter(d => d.sourceType === 'res.header'), component.filePath)}
            </div>
        </div>
        
        <!-- External Calls -->
        <div class="sidebar-section">
            <div class="section-title collapsible" data-collapsed="false">
                <span class="collapse-icon">▼</span>
                🌐 External Calls (${component.externalCalls?.length || 0})
            </div>
            <div class="section-content collapsible-body">
                ${(component.externalCalls || []).map(c => `
                    <div class="clickable-item ext-call" data-path="${component.filePath}" data-line="${c.lineNumber}">
                        <span class="call-type">${c.type.toUpperCase()}</span>
                        ${c.template ? `<code>${c.template}</code>` : ''}
                        <span class="line-num">:${c.lineNumber}</span>
                    </div>
                `).join('') || '<div class="empty-msg">None</div>'}
            </div>
        </div>
    `;
    
    setupSidebarEventHandlers(content, component, false);
    sidebar.classList.add('open');
}

function setupSidebarEventHandlers(content, item, isMiddleware) {
    // Collapsible section toggles
    content.querySelectorAll('.section-title.collapsible').forEach(title => {
        title.addEventListener('click', () => {
            const isCollapsed = title.dataset.collapsed === 'true';
            const body = title.nextElementSibling;
            const icon = title.querySelector('.collapse-icon');
            
            if (isCollapsed) {
                title.dataset.collapsed = 'false';
                body?.classList.remove('collapsed');
                if (icon) icon.textContent = '▼';
            } else {
                title.dataset.collapsed = 'true';
                body?.classList.add('collapsed');
                if (icon) icon.textContent = '▶';
            }
        });
    });
    
    // Component tree collapse toggles
    content.querySelectorAll('.sidebar-comp-header.has-children').forEach(header => {
        const collapseIcon = header.querySelector('.collapse-icon');
        collapseIcon?.addEventListener('click', (e) => {
            e.stopPropagation();
            const isCollapsed = header.dataset.collapsed === 'true';
            const children = header.nextElementSibling;
            
            if (isCollapsed) {
                header.dataset.collapsed = 'false';
                children?.classList.remove('collapsed');
                collapseIcon.textContent = '▼';
            } else {
                header.dataset.collapsed = 'true';
                children?.classList.add('collapsed');
                collapseIcon.textContent = '▶';
            }
        });
    });
    
    // Component header click - show component detail
    content.querySelectorAll('.sidebar-comp-header').forEach(header => {
        header.addEventListener('click', (e) => {
            // Don't trigger if clicking collapse icon
            if (e.target.classList.contains('collapse-icon')) return;
            
            const filePath = header.dataset.filepath;
            const component = findComponentByPath(filePath);
            if (component) {
                showComponentDetailSidebar(component);
            }
        });
    });
    
    // File links for middleware
    content.querySelectorAll('.file-link').forEach(el => {
        el.addEventListener('click', () => {
            openFile(null, parseInt(el.dataset.line) || 1, true, el.dataset.path);
        });
    });
    
    // Component file links
    content.querySelectorAll('.component-file').forEach(el => {
        el.addEventListener('click', () => {
            openFile(el.dataset.filepath, parseInt(el.dataset.line) || 1, false);
        });
    });
    
    // Data items click
    content.querySelectorAll('.data-item').forEach(el => {
        el.addEventListener('click', () => {
            openFile(el.dataset.path, parseInt(el.dataset.line) || 1, false);
        });
    });
    
    // External call items click
    content.querySelectorAll('.ext-call').forEach(el => {
        el.addEventListener('click', () => {
            openFile(el.dataset.path, parseInt(el.dataset.line) || 1, false);
        });
    });
}
