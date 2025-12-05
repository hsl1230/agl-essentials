const vscode = acquireVsCodeApi();

// State
let currentEndpoint = null;
let currentMiddlewares = [];
let currentProperties = [];
let currentComponentTree = [];
let zoomLevel = 1;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeMermaid();
    initializeTabs();
    initializeControls();
    initializeSidebar();
    
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
            tertiaryColor: '#1e1e1e'
        },
        flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            curve: 'basis'
        }
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
        zoomLevel = Math.min(zoomLevel + 0.2, 2);
        applyZoom();
    });
    
    document.getElementById('zoom-out-btn')?.addEventListener('click', () => {
        zoomLevel = Math.max(zoomLevel - 0.2, 0.5);
        applyZoom();
    });
    
    document.getElementById('reset-zoom-btn')?.addEventListener('click', () => {
        zoomLevel = 1;
        applyZoom();
    });
    
    document.getElementById('property-search')?.addEventListener('input', (e) => {
        filterProperties(e.target.value);
    });

    document.getElementById('expand-all-btn')?.addEventListener('click', () => {
        document.querySelectorAll('.tree-node-children, .tree-child-children').forEach(el => {
            el.classList.add('expanded');
        });
        document.querySelectorAll('.tree-toggle').forEach(el => {
            if (!el.classList.contains('empty')) {
                el.classList.add('expanded');
            }
        });
    });

    document.getElementById('collapse-all-btn')?.addEventListener('click', () => {
        document.querySelectorAll('.tree-node-children, .tree-child-children').forEach(el => {
            el.classList.remove('expanded');
        });
        document.querySelectorAll('.tree-toggle').forEach(el => {
            el.classList.remove('expanded');
        });
    });
}

function applyZoom() {
    const diagram = document.querySelector('.mermaid');
    if (diagram) {
        diagram.style.transform = `scale(${zoomLevel})`;
        diagram.style.transformOrigin = 'top left';
    }
}

// Sidebar
function initializeSidebar() {
    document.getElementById('close-sidebar')?.addEventListener('click', () => {
        document.getElementById('detail-sidebar').classList.remove('open');
    });
}

// Message handling
window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.command) {
        case 'analysisResult':
            handleAnalysisResult(message.content);
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
        case 'error':
            console.error('Error:', message.message);
            break;
    }
});

// Handle analysis result
function handleAnalysisResult(data) {
    currentEndpoint = data.endpoint;
    currentMiddlewares = data.middlewares;
    currentProperties = data.allProperties;
    currentComponentTree = data.componentTree || [];
    
    renderEndpointInfo(data.endpoint);
    renderMermaidDiagram(data.mermaidDiagram);
    renderMiddlewareChain(data.middlewares);
    renderComponentTree(data.middlewares);
    renderDataFlow(data.allProperties);
    renderConfigView(data.endpoint, data.middlewares);
}

// Render endpoint info
function renderEndpointInfo(endpoint) {
    const info = document.getElementById('endpoint-info');
    info.innerHTML = `
        <span class="method ${endpoint.method.toLowerCase()}">${endpoint.method.toUpperCase()}</span>
        <span class="uri">${endpoint.endpointUri}</span>
    `;
}

// Render Mermaid diagram
async function renderMermaidDiagram(diagram) {
    const container = document.getElementById('mermaid-diagram');
    
    try {
        const { svg } = await mermaid.render('flowchart', diagram);
        container.innerHTML = `<div class="mermaid">${svg}</div>`;
        
        // Add click handlers to nodes
        setTimeout(() => {
            const nodes = container.querySelectorAll('.node');
            nodes.forEach((node, index) => {
                node.style.cursor = 'pointer';
                node.addEventListener('click', () => {
                    if (currentMiddlewares[index]) {
                        vscode.postMessage({
                            command: 'showMiddlewareDetail',
                            middlewareName: currentMiddlewares[index].name
                        });
                    }
                });
            });
        }, 100);
    } catch (error) {
        container.innerHTML = `<div class="error">Failed to render diagram: ${error.message}</div>`;
    }
}

// Render middleware chain with component info
function renderMiddlewareChain(middlewares) {
    const container = document.getElementById('middleware-chain');
    container.innerHTML = '';
    
    middlewares.forEach((mw, index) => {
        // Middleware item
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
            vscode.postMessage({
                command: 'showMiddlewareDetail',
                middlewareName: mw.name
            });
        });
        
        container.appendChild(item);
        
        // Arrow between items
        if (index < middlewares.length - 1) {
            const arrow = document.createElement('div');
            arrow.className = 'middleware-arrow';
            arrow.textContent = '↓';
            container.appendChild(arrow);
        }
    });
}

// Render component tree
function renderComponentTree(middlewares) {
    const container = document.getElementById('component-tree-container');
    if (!container) return;
    container.innerHTML = '';
    
    middlewares.forEach((mw, mwIndex) => {
        const node = createTreeNode(mw, mwIndex, true);
        container.appendChild(node);
    });
}

// Create a tree node (middleware or component)
function createTreeNode(item, index, isMiddleware) {
    const node = document.createElement('div');
    node.className = 'tree-node';
    
    const hasChildren = item.components?.length > 0 || item.children?.length > 0;
    const children = item.components || item.children || [];
    
    const reads = item.resLocalsReads || [];
    const writes = item.resLocalsWrites || [];
    const external = item.externalCalls || [];
    const configDeps = item.configDeps || [];
    
    const allReads = item.allResLocalsReads || reads;
    const allWrites = item.allResLocalsWrites || writes;
    const allExternal = item.allExternalCalls || external;
    
    const iconClass = isMiddleware ? 'middleware' : (item.name?.startsWith('@opus/') ? 'agl-module' : 'component');
    const icon = isMiddleware ? '📦' : (item.name?.startsWith('@opus/') ? '🔧' : '📄');
    
    node.innerHTML = `
        <div class="tree-node-header">
            <span class="tree-toggle ${hasChildren ? '' : 'empty'}">▶</span>
            <span class="tree-node-icon ${iconClass}">${icon}</span>
            <span class="tree-node-name">${isMiddleware ? `${index + 1}. ${item.name}` : item.displayName || item.name}</span>
            <div class="tree-node-badges">
                ${allReads.length > 0 ? `<span class="tree-badge reads">R:${allReads.length}</span>` : ''}
                ${allWrites.length > 0 ? `<span class="tree-badge writes">W:${allWrites.length}</span>` : ''}
                ${allExternal.length > 0 ? `<span class="tree-badge external">E:${allExternal.length}</span>` : ''}
                ${configDeps.length > 0 ? `<span class="tree-badge config">C:${configDeps.length}</span>` : ''}
            </div>
        </div>
        <div class="tree-node-children">
            <!-- Middleware/Component's own res.locals -->
            ${(reads.length > 0 || writes.length > 0) ? `
                <div class="tree-res-locals">
                    <div class="tree-res-locals-title">res.locals (this file)</div>
                    ${writes.map(w => `
                        <div class="tree-res-locals-item" data-path="${item.filePath}" data-line="${w.lineNumber}">
                            <span class="type-indicator write">W</span>
                            <span class="property">${w.property}</span>
                            <span class="line">:${w.lineNumber}</span>
                        </div>
                    `).join('')}
                    ${reads.map(r => `
                        <div class="tree-res-locals-item" data-path="${item.filePath}" data-line="${r.lineNumber}">
                            <span class="type-indicator read">R</span>
                            <span class="property">${r.property}</span>
                            <span class="line">:${r.lineNumber}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            
            <!-- External calls -->
            ${external.length > 0 ? `
                <div class="tree-external-calls">
                    <div class="tree-res-locals-title">External Calls</div>
                    ${external.map(e => `
                        <div class="tree-external-call-item" data-path="${item.filePath}" data-line="${e.lineNumber}">
                            <span class="call-type">${e.type}</span>
                            <span class="call-template">${e.template || e.method || ''}</span>
                            <span class="line">:${e.lineNumber}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            
            <!-- Child components -->
            ${children.map((child, idx) => createChildNode(child, idx)).join('')}
        </div>
    `;
    
    // Add toggle functionality
    const toggle = node.querySelector('.tree-toggle');
    const childrenContainer = node.querySelector('.tree-node-children');
    
    toggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle.classList.toggle('expanded');
        childrenContainer.classList.toggle('expanded');
    });
    
    // Add click handler for header to open file
    const header = node.querySelector('.tree-node-header');
    header.addEventListener('click', () => {
        if (isMiddleware) {
            vscode.postMessage({
                command: 'openMiddlewareFile',
                middlewarePath: item.name,
                lineNumber: item.runFunctionLine || 1
            });
        } else {
            vscode.postMessage({
                command: 'openComponentFile',
                filePath: item.filePath,
                lineNumber: item.mainFunctionLine || 1
            });
        }
    });
    
    // Add click handlers for res.locals items
    node.querySelectorAll('.tree-res-locals-item, .tree-external-call-item').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({
                command: 'openComponentFile',
                filePath: el.dataset.path,
                lineNumber: parseInt(el.dataset.line) || 1
            });
        });
    });
    
    return node;
}

// Create child node HTML (for recursive components)
function createChildNode(comp, index) {
    const hasChildren = comp.children?.length > 0;
    const reads = comp.resLocalsReads || [];
    const writes = comp.resLocalsWrites || [];
    const external = comp.externalCalls || [];
    
    const iconClass = comp.name?.startsWith('@opus/') ? 'agl-module' : 'component';
    const icon = comp.name?.startsWith('@opus/') ? '🔧' : '📄';
    
    return `
        <div class="tree-child-node">
            <div class="tree-child-header" data-path="${comp.filePath}" data-line="${comp.mainFunctionLine || 1}">
                <span class="tree-toggle ${hasChildren ? '' : 'empty'}">▶</span>
                <span class="tree-node-icon ${iconClass}">${icon}</span>
                <span class="tree-node-name">${comp.displayName || comp.name}</span>
                <div class="tree-node-badges">
                    ${reads.length > 0 ? `<span class="tree-badge reads">R:${reads.length}</span>` : ''}
                    ${writes.length > 0 ? `<span class="tree-badge writes">W:${writes.length}</span>` : ''}
                    ${external.length > 0 ? `<span class="tree-badge external">E:${external.length}</span>` : ''}
                </div>
            </div>
            <div class="tree-child-children">
                ${(reads.length > 0 || writes.length > 0) ? `
                    <div class="tree-res-locals">
                        ${writes.map(w => `
                            <div class="tree-res-locals-item" data-path="${comp.filePath}" data-line="${w.lineNumber}">
                                <span class="type-indicator write">W</span>
                                <span class="property">${w.property}</span>
                                <span class="line">:${w.lineNumber}</span>
                            </div>
                        `).join('')}
                        ${reads.map(r => `
                            <div class="tree-res-locals-item" data-path="${comp.filePath}" data-line="${r.lineNumber}">
                                <span class="type-indicator read">R</span>
                                <span class="property">${r.property}</span>
                                <span class="line">:${r.lineNumber}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                ${comp.children?.map((child, idx) => createChildNode(child, idx)).join('') || ''}
            </div>
        </div>
    `;
}

// Setup tree event handlers (called after rendering)
function setupTreeEventHandlers() {
    // Toggle handlers for child nodes
    document.querySelectorAll('.tree-child-header').forEach(header => {
        const toggle = header.querySelector('.tree-toggle');
        const parent = header.parentElement;
        const children = parent.querySelector('.tree-child-children');
        
        toggle?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle.classList.toggle('expanded');
            children?.classList.toggle('expanded');
        });
        
        header.addEventListener('click', () => {
            vscode.postMessage({
                command: 'openComponentFile',
                filePath: header.dataset.path,
                lineNumber: parseInt(header.dataset.line) || 1
            });
        });
    });
    
    // Res.locals item click handlers
    document.querySelectorAll('.tree-res-locals-item, .tree-external-call-item').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({
                command: 'openComponentFile',
                filePath: el.dataset.path,
                lineNumber: parseInt(el.dataset.line) || 1
            });
        });
    });
}

// Render data flow
function renderDataFlow(properties) {
    const container = document.getElementById('property-list');
    container.innerHTML = '';
    
    properties.forEach(prop => {
        const card = document.createElement('div');
        card.className = 'property-card';
        card.innerHTML = `
            <div class="property-name">res.locals.${prop.property}</div>
            <div class="property-flow">
                <span class="producers">📤 ${prop.producers.length} producer(s)</span>
                <span>→</span>
                <span class="consumers">📥 ${prop.consumers.length} consumer(s)</span>
            </div>
        `;
        
        card.addEventListener('click', () => {
            vscode.postMessage({
                command: 'trackProperty',
                property: prop.property
            });
        });
        
        container.appendChild(card);
    });
}

// Filter properties
function filterProperties(query) {
    const cards = document.querySelectorAll('.property-card');
    const lowerQuery = query.toLowerCase();
    
    cards.forEach(card => {
        const name = card.querySelector('.property-name').textContent.toLowerCase();
        card.style.display = name.includes(lowerQuery) ? 'block' : 'none';
    });
}

// Show property usages
function showPropertyUsages(data) {
    const container = document.getElementById('property-detail');
    container.classList.add('visible');
    
    container.innerHTML = `
        <h4>res.locals.${data.property}</h4>
        <div class="usage-summary" style="margin-bottom: 12px; font-size: 12px; color: var(--text-secondary);">
            <span style="color: var(--accent-green);">📤 ${data.producers.length} producer(s)</span>
            <span style="margin: 0 8px;">→</span>
            <span style="color: var(--accent-blue);">📥 ${data.consumers.length} consumer(s)</span>
        </div>
        <div class="usage-list">
            ${data.usages.map(usage => `
                <div class="usage-item" 
                     data-filepath="${usage.filePath || ''}" 
                     data-middleware="${usage.source || usage.middleware}" 
                     data-line="${usage.lineNumber}"
                     data-iscomponent="${usage.isComponent || false}">
                    <span class="usage-type ${usage.type}">${usage.type.toUpperCase()}</span>
                    <span class="usage-middleware">${usage.source || usage.middleware}</span>
                    <span class="usage-line">:${usage.lineNumber}</span>
                </div>
            `).join('')}
        </div>
    `;
    
    // Add click handlers
    container.querySelectorAll('.usage-item').forEach(item => {
        item.addEventListener('click', () => {
            const filePath = item.dataset.filepath;
            const isComponent = item.dataset.iscomponent === 'true';
            
            if (isComponent && filePath) {
                vscode.postMessage({
                    command: 'openComponentFile',
                    filePath: filePath,
                    lineNumber: parseInt(item.dataset.line)
                });
            } else {
                vscode.postMessage({
                    command: 'openMiddlewareAtLine',
                    middlewarePath: item.dataset.middleware,
                    lineNumber: parseInt(item.dataset.line)
                });
            }
        });
    });
}

// Render config view
function renderConfigView(endpoint, middlewares) {
    const container = document.getElementById('config-section');
    
    // Collect all config dependencies
    const configDeps = {
        mWareConfig: new Set(),
        appConfig: new Set(),
        sysParameter: new Set()
    };
    
    middlewares.forEach(mw => {
        mw.configDeps.forEach(dep => {
            if (configDeps[dep.source]) {
                configDeps[dep.source].add(dep.key);
            }
        });
    });
    
    container.innerHTML = `
        <!-- Endpoint Config -->
        <div class="config-card">
            <div class="config-card-header">
                <span class="config-card-title">📋 Endpoint Configuration</span>
                <button class="config-card-action" data-config="customRoutes">Open File</button>
            </div>
            <div class="config-card-content">
                <div class="config-item">
                    <span class="config-key">template</span>
                    <span class="config-value">${endpoint.template || 'N/A'}</span>
                </div>
                <div class="config-item">
                    <span class="config-key">panic</span>
                    <span class="config-value">${endpoint.panic || 'false'}</span>
                </div>
                ${endpoint.panicConfigKey ? `
                <div class="config-item">
                    <span class="config-key">panicConfigKey</span>
                    <span class="config-value">${endpoint.panicConfigKey}</span>
                </div>
                ` : ''}
                ${endpoint.nanoConfigKey ? `
                <div class="config-item">
                    <span class="config-key">nanoConfigKey</span>
                    <span class="config-value">${endpoint.nanoConfigKey}</span>
                </div>
                ` : ''}
            </div>
        </div>
        
        <!-- mWareConfig -->
        <div class="config-card">
            <div class="config-card-header">
                <span class="config-card-title">⚙️ mWareConfig Dependencies</span>
                <button class="config-card-action" data-config="mWareConfig">Open File</button>
            </div>
            <div class="config-card-content">
                ${Array.from(configDeps.mWareConfig).map(key => `
                    <div class="config-item">
                        <span class="config-key">${key}</span>
                    </div>
                `).join('') || '<div class="config-item"><span class="config-value">No dependencies found</span></div>'}
            </div>
        </div>
        
        <!-- System Parameters -->
        <div class="config-card">
            <div class="config-card-header">
                <span class="config-card-title">🔧 System Parameters</span>
            </div>
            <div class="config-card-content">
                ${Array.from(configDeps.sysParameter).map(key => `
                    <div class="config-item">
                        <span class="config-key">${key}</span>
                    </div>
                `).join('') || '<div class="config-item"><span class="config-value">No dependencies found</span></div>'}
            </div>
        </div>
    `;
    
    // Add click handlers for config buttons
    container.querySelectorAll('.config-card-action').forEach(btn => {
        btn.addEventListener('click', () => {
            vscode.postMessage({
                command: 'openConfigFile',
                configType: btn.dataset.config
            });
        });
    });
}

// Show middleware detail in sidebar
function showMiddlewareDetailSidebar(middleware) {
    const sidebar = document.getElementById('detail-sidebar');
    const content = document.getElementById('sidebar-content');
    const title = document.getElementById('sidebar-title');
    
    title.textContent = middleware.name;
    
    const allReads = middleware.allResLocalsReads || middleware.resLocalsReads;
    const allWrites = middleware.allResLocalsWrites || middleware.resLocalsWrites;
    const allExternal = middleware.allExternalCalls || middleware.externalCalls;
    const allConfigDeps = middleware.allConfigDeps || middleware.configDeps;
    const components = middleware.components || [];
    
    content.innerHTML = `
        <!-- File Info -->
        <div class="detail-section">
            <div class="detail-section-title">📁 File</div>
            <div class="detail-item" data-path="${middleware.name}" data-line="${middleware.runFunctionLine || 1}">
                <code>${middleware.filePath.split(/[/\\]/).slice(-3).join('/')}</code>
            </div>
            ${middleware.runFunctionLine ? `
            <div class="detail-item" data-path="${middleware.name}" data-line="${middleware.runFunctionLine}">
                Go to <code>run()</code> function (line ${middleware.runFunctionLine})
            </div>
            ` : ''}
        </div>
        
        <!-- Components -->
        ${components.length > 0 ? `
        <div class="detail-section">
            <div class="detail-section-title">📦 Components (${countAllComponents(components)})</div>
            <div class="detail-list">
                ${renderComponentList(components)}
            </div>
        </div>
        ` : ''}
        
        <!-- res.locals Writes (this file) -->
        <div class="detail-section">
            <div class="detail-section-title">📤 Writes in this file (${middleware.resLocalsWrites.length})</div>
            <div class="detail-list">
                ${middleware.resLocalsWrites.map(w => `
                    <div class="detail-item" data-path="${middleware.name}" data-line="${w.lineNumber}">
                        <code>${w.property}</code>
                        <span style="color: var(--text-muted)">:${w.lineNumber}</span>
                    </div>
                `).join('') || '<div style="color: var(--text-muted); font-size: 12px;">None</div>'}
            </div>
        </div>
        
        <!-- res.locals Reads (this file) -->
        <div class="detail-section">
            <div class="detail-section-title">📥 Reads in this file (${middleware.resLocalsReads.length})</div>
            <div class="detail-list">
                ${middleware.resLocalsReads.map(r => `
                    <div class="detail-item" data-path="${middleware.name}" data-line="${r.lineNumber}">
                        <code>${r.property}</code>
                        <span style="color: var(--text-muted)">:${r.lineNumber}</span>
                    </div>
                `).join('') || '<div style="color: var(--text-muted); font-size: 12px;">None</div>'}
            </div>
        </div>
        
        <!-- Total from all components -->
        ${allWrites.length > middleware.resLocalsWrites.length || allReads.length > middleware.resLocalsReads.length ? `
        <div class="detail-section">
            <div class="detail-section-title">📊 Total (including components)</div>
            <div style="font-size: 12px; color: var(--text-secondary);">
                <div>📤 ${allWrites.length} total writes</div>
                <div>📥 ${allReads.length} total reads</div>
                <div>🌐 ${allExternal.length} external calls</div>
                <div>⚙️ ${allConfigDeps.length} config dependencies</div>
            </div>
        </div>
        ` : ''}
        
        <!-- External Calls -->
        <div class="detail-section">
            <div class="detail-section-title">🌐 External Calls (${middleware.externalCalls.length})</div>
            <div class="detail-list">
                ${middleware.externalCalls.map(c => `
                    <div class="detail-item" data-path="${middleware.name}" data-line="${c.lineNumber}">
                        <span style="color: var(--accent-orange)">${c.type.toUpperCase()}</span>
                        ${c.template ? `<code>${c.template}</code>` : ''}
                        <span style="color: var(--text-muted)">:${c.lineNumber}</span>
                    </div>
                `).join('') || '<div style="color: var(--text-muted); font-size: 12px;">None</div>'}
            </div>
        </div>
        
        <!-- Config Dependencies -->
        <div class="detail-section">
            <div class="detail-section-title">⚙️ Config Dependencies (${middleware.configDeps.length})</div>
            <div class="detail-list">
                ${middleware.configDeps.map(d => `
                    <div class="detail-item">
                        <span style="color: var(--accent-purple)">${d.source}</span>
                        <code>${d.key}</code>
                    </div>
                `).join('') || '<div style="color: var(--text-muted); font-size: 12px;">None</div>'}
            </div>
        </div>
    `;
    
    // Add click handlers
    content.querySelectorAll('.detail-item[data-path]').forEach(item => {
        item.addEventListener('click', () => {
            vscode.postMessage({
                command: 'openMiddlewareAtLine',
                middlewarePath: item.dataset.path,
                lineNumber: parseInt(item.dataset.line) || 1
            });
        });
    });
    
    // Add click handlers for component items
    content.querySelectorAll('.component-item').forEach(item => {
        item.addEventListener('click', () => {
            vscode.postMessage({
                command: 'openComponentFile',
                filePath: item.dataset.filepath,
                lineNumber: parseInt(item.dataset.line) || 1
            });
        });
    });
    
    sidebar.classList.add('open');
}

// Count all components recursively
function countAllComponents(components) {
    let count = components.length;
    for (const comp of components) {
        if (comp.children) {
            count += countAllComponents(comp.children);
        }
    }
    return count;
}

// Render component list for sidebar
function renderComponentList(components, depth = 0) {
    return components.map(comp => {
        const indent = '  '.repeat(depth);
        const childCount = comp.children?.length || 0;
        const hasData = comp.resLocalsReads?.length > 0 || comp.resLocalsWrites?.length > 0;
        
        let html = `
            <div class="component-item" data-filepath="${comp.filePath}" data-line="${comp.mainFunctionLine || 1}" style="padding-left: ${depth * 16}px;">
                <span style="color: ${hasData ? 'var(--accent-green)' : 'var(--text-secondary)'}">
                    ${comp.name?.startsWith('@opus/') ? '🔧' : '📄'} ${comp.displayName || comp.name}
                </span>
                ${comp.resLocalsWrites?.length > 0 ? `<span style="color: var(--accent-green); font-size: 10px;">W:${comp.resLocalsWrites.length}</span>` : ''}
                ${comp.resLocalsReads?.length > 0 ? `<span style="color: var(--accent-blue); font-size: 10px;">R:${comp.resLocalsReads.length}</span>` : ''}
                ${childCount > 0 ? `<span style="color: var(--text-muted); font-size: 10px;">(${childCount})</span>` : ''}
            </div>
        `;
        
        if (comp.children?.length > 0) {
            html += renderComponentList(comp.children, depth + 1);
        }
        
        return html;
    }).join('');
}

// Show component detail in sidebar
function showComponentDetailSidebar(component) {
    const sidebar = document.getElementById('detail-sidebar');
    const content = document.getElementById('sidebar-content');
    const title = document.getElementById('sidebar-title');
    
    title.textContent = component.displayName || component.name;
    
    content.innerHTML = `
        <!-- File Info -->
        <div class="detail-section">
            <div class="detail-section-title">📁 File</div>
            <div class="detail-item component-file" data-filepath="${component.filePath}" data-line="${component.mainFunctionLine || 1}">
                <code>${component.filePath.split(/[/\\]/).slice(-3).join('/')}</code>
            </div>
        </div>
        
        <!-- Exported Functions -->
        ${component.exportedFunctions?.length > 0 ? `
        <div class="detail-section">
            <div class="detail-section-title">📤 Exports</div>
            <div style="font-size: 12px; color: var(--accent-yellow);">
                ${component.exportedFunctions.join(', ')}
            </div>
        </div>
        ` : ''}
        
        <!-- res.locals Writes -->
        <div class="detail-section">
            <div class="detail-section-title">📤 Writes (${component.resLocalsWrites?.length || 0})</div>
            <div class="detail-list">
                ${(component.resLocalsWrites || []).map(w => `
                    <div class="detail-item component-line" data-filepath="${component.filePath}" data-line="${w.lineNumber}">
                        <code>${w.property}</code>
                        <span style="color: var(--text-muted)">:${w.lineNumber}</span>
                    </div>
                `).join('') || '<div style="color: var(--text-muted); font-size: 12px;">None</div>'}
            </div>
        </div>
        
        <!-- res.locals Reads -->
        <div class="detail-section">
            <div class="detail-section-title">📥 Reads (${component.resLocalsReads?.length || 0})</div>
            <div class="detail-list">
                ${(component.resLocalsReads || []).map(r => `
                    <div class="detail-item component-line" data-filepath="${component.filePath}" data-line="${r.lineNumber}">
                        <code>${r.property}</code>
                        <span style="color: var(--text-muted)">:${r.lineNumber}</span>
                    </div>
                `).join('') || '<div style="color: var(--text-muted); font-size: 12px;">None</div>'}
            </div>
        </div>
        
        <!-- External Calls -->
        <div class="detail-section">
            <div class="detail-section-title">🌐 External Calls (${component.externalCalls?.length || 0})</div>
            <div class="detail-list">
                ${(component.externalCalls || []).map(c => `
                    <div class="detail-item component-line" data-filepath="${component.filePath}" data-line="${c.lineNumber}">
                        <span style="color: var(--accent-orange)">${c.type.toUpperCase()}</span>
                        ${c.template ? `<code>${c.template}</code>` : ''}
                        <span style="color: var(--text-muted)">:${c.lineNumber}</span>
                    </div>
                `).join('') || '<div style="color: var(--text-muted); font-size: 12px;">None</div>'}
            </div>
        </div>
        
        <!-- Children -->
        ${component.children?.length > 0 ? `
        <div class="detail-section">
            <div class="detail-section-title">📦 Sub-components (${component.children.length})</div>
            <div class="detail-list">
                ${renderComponentList(component.children)}
            </div>
        </div>
        ` : ''}
    `;
    
    // Add click handlers
    content.querySelectorAll('.component-file, .component-line').forEach(item => {
        item.addEventListener('click', () => {
            vscode.postMessage({
                command: 'openComponentFile',
                filePath: item.dataset.filepath,
                lineNumber: parseInt(item.dataset.line) || 1
            });
        });
    });
    
    content.querySelectorAll('.component-item').forEach(item => {
        item.addEventListener('click', () => {
            vscode.postMessage({
                command: 'openComponentFile',
                filePath: item.dataset.filepath,
                lineNumber: parseInt(item.dataset.line) || 1
            });
        });
    });
    
    sidebar.classList.add('open');
}
