const vscode = acquireVsCodeApi();

// State
let currentEndpoint = null;
let currentMiddlewares = [];
let currentProperties = [];
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
    
    renderEndpointInfo(data.endpoint);
    renderMermaidDiagram(data.mermaidDiagram);
    renderMiddlewareChain(data.middlewares);
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

// Render middleware chain
function renderMiddlewareChain(middlewares) {
    const container = document.getElementById('middleware-chain');
    container.innerHTML = '';
    
    middlewares.forEach((mw, index) => {
        // Middleware item
        const item = document.createElement('div');
        item.className = 'middleware-item';
        item.innerHTML = `
            <div class="middleware-index">${index + 1}</div>
            <div class="middleware-content">
                <div class="middleware-name">${mw.name}</div>
                <div class="middleware-status">
                    ${mw.exists ? '' : '<span class="status-item missing">⚠️ File not found</span>'}
                    <span class="status-item reads">📥 ${mw.resLocalsReads.length} reads</span>
                    <span class="status-item writes">📤 ${mw.resLocalsWrites.length} writes</span>
                    ${mw.externalCalls.length > 0 ? `<span class="status-item calls">🌐 ${mw.externalCalls.length} calls</span>` : ''}
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
        <div class="usage-list">
            ${data.usages.map(usage => `
                <div class="usage-item" data-middleware="${usage.middleware}" data-line="${usage.lineNumber}">
                    <span class="usage-type ${usage.type}">${usage.type.toUpperCase()}</span>
                    <span class="usage-middleware">${usage.middleware}</span>
                    <span class="usage-line">:${usage.lineNumber}</span>
                </div>
            `).join('')}
        </div>
    `;
    
    // Add click handlers
    container.querySelectorAll('.usage-item').forEach(item => {
        item.addEventListener('click', () => {
            vscode.postMessage({
                command: 'openMiddlewareAtLine',
                middlewarePath: item.dataset.middleware,
                lineNumber: parseInt(item.dataset.line)
            });
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
        
        <!-- res.locals Writes -->
        <div class="detail-section">
            <div class="detail-section-title">📤 Writes to res.locals (${middleware.resLocalsWrites.length})</div>
            <div class="detail-list">
                ${middleware.resLocalsWrites.map(w => `
                    <div class="detail-item" data-path="${middleware.name}" data-line="${w.lineNumber}">
                        <code>${w.property}</code>
                        <span style="color: var(--text-muted)">:${w.lineNumber}</span>
                    </div>
                `).join('') || '<div style="color: var(--text-muted); font-size: 12px;">None</div>'}
            </div>
        </div>
        
        <!-- res.locals Reads -->
        <div class="detail-section">
            <div class="detail-section-title">📥 Reads from res.locals (${middleware.resLocalsReads.length})</div>
            <div class="detail-list">
                ${middleware.resLocalsReads.map(r => `
                    <div class="detail-item" data-path="${middleware.name}" data-line="${r.lineNumber}">
                        <code>${r.property}</code>
                        <span style="color: var(--text-muted)">:${r.lineNumber}</span>
                    </div>
                `).join('') || '<div style="color: var(--text-muted); font-size: 12px;">None</div>'}
            </div>
        </div>
        
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
    
    sidebar.classList.add('open');
}
