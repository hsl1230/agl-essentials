# AGL Flow Analyzer

## Overview

AGL Flow Analyzer is a powerful visualization tool for analyzing and understanding the execution flow of AGL middleware endpoints. It performs deep analysis of middleware and all their sub-components, tracking how `res.locals.*` and `req.transaction.*` data is read and written throughout the entire call chain.

## Main Features

### 1. Flow Diagram Visualization
- Generates beautiful flow diagrams using Mermaid.js
- Displays the complete call chain: Endpoint → Middleware → Components
- Includes data flow annotations (read/write operations)
- Supports exporting to SVG and PNG formats
- **Pan & Zoom**: Navigate large diagrams with mouse drag and scroll wheel
- **Expandable Nodes**: Click toggle symbols (▼/▶) to expand/collapse component hierarchies
- **Webview Position**: Opens in a separate editor group (right side) for better code navigation

### 2. Middleware Analysis
- Lists all middlewares for an endpoint
- Analyzes `res.locals` and `req.transaction` read/write operations for each middleware
- Identifies external API calls and AGL Core calls
- Tracks configuration dependencies (environment variables, config files, etc.)

### 3. Deep Component Tree Analysis ⭐
The most powerful feature - recursively analyzes all components called by each middleware:
- **Recursive Depth**: Analyzes up to 5 levels of nested components
- **Component Tracking**: Shows which sub-components each component calls
- **Data Flow Tracking**: Tracks `res.locals.*` and `req.transaction.*` reads/writes at each level
- **External Call Detection**: Identifies HTTP requests, AGL Core calls, and more
- **Collapsible Tree View**: Easy navigation of complex component hierarchies
- **Click Navigation**: Click any component to jump directly to its source code (opens in left editor group)

### 4. External Calls Detection ⭐
Automatically detects and visualizes external service calls:
- **AVS B2B Calls**: `callAVSB2B`, `callAVSB2BVersioned`, `callAVSB2BPlain`
- **AVS B2C Calls**: `callAVSB2C`, `callAVSB2CVersioned`
- **DCQ Calls**: `callAVSDCQTemplate`, `callDcqDecoupledESTemplate`
- **Elasticsearch**: `callElasticSearch`, ES query calls
- **HTTP Calls**: `aglUtils.httpClient`, `aglUtils.forwardRequest`, `aglUtils.v2.httpClient`
- **Smart Bubbling**: External calls from hidden components bubble up to the nearest visible ancestor node
- **Library Filtering**: Hides low-level library implementation calls (e.g., internal httpClient in wrappers)
- **Deduplication**: Prevents duplicate entries when components are shared across middlewares
- **Indirect Call Detection**: Tracks wrapper method assignments like `const callAVS = wrapper.callAVS`

### 5. Search in Endpoint ⭐
Search for specific patterns within an endpoint's component chain:
- Search middleware component names
- Search external call templates
- Search configuration keys
- Search data properties (res.locals, req.transaction)
- Results display in a tree view with clickable navigation

### 6. Data Flow Analysis
- Analyzes the complete lifecycle of `res.locals` properties
- Identifies data producers (writers) and consumers (readers)
- Includes component-level data flow tracking

### 7. Producer-Consumer Relationships
- Visualizes data dependency relationships
- Helps understand data passing between middlewares
- Identifies potential dependency issues

## How to Use

### Method 1: Via AGL Endpoint Tree
1. Open the AGL Endpoint Tree view (click AGL icon in Activity Bar)
2. Right-click on any endpoint
3. Select "AGL: Analyze Endpoint Flow"
4. Or click the 🔍 icon on the endpoint

### Method 2: Via Command Palette
1. Press `Ctrl+Shift+P`
2. Type "AGL: Analyze Endpoint Flow"
3. Select the endpoint to analyze

### Method 3: Search in Endpoint
1. Right-click on any endpoint
2. Select "AGL: Search in Endpoint"
3. Enter your search term
4. Navigate results to find matching components

## Component Tree Details

### Tree Structure
```
📁 middleware_1.js
├── 📄 component_a.js
│   ├── 📤 writes: res.locals.data1
│   ├── 📥 reads: res.locals.input
│   ├── 🔗 calls: AVS: GetUnifiedAssetDetailById
│   └── 📁 sub_component_1.js
│       ├── 📤 writes: res.locals.result
│       └── 📥 reads: res.locals.data1
├── 📄 component_b.js
│   └── ...
```

### Visual Indicators
- 🟢 **Green (WRITE)**: Component writes to `res.locals`
- 🔵 **Blue (READ)**: Component reads from `res.locals`
- 🟣 **Purple (External)**: External calls (AVS, DCQ, ES, HTTP)
- 📁 **Folder icon**: Expandable sub-components
- ⚠️ **Warning marker**: Component file not found

### Interactive Features
- **Click expand/collapse**: Expand or collapse sub-component trees
- **Click component name**: Show component detail sidebar
- **Click file path**: Open component file in editor (left group)
- **Click line number**: Jump to specific code location
- **Pan & Zoom**: Drag to pan, scroll to zoom in flow diagram
- **Toggle symbols (▼/▶)**: Expand/collapse component hierarchies in diagram

## What Gets Analyzed

### res.locals Operations
```javascript
// Recognized patterns
res.locals.xxx = value;     // Write
res.locals['xxx'] = value;  // Write
const x = res.locals.xxx;   // Read
res.locals.xxx.property;    // Read
```

### req.transaction Operations
```javascript
// Recognized patterns
req.transaction.xxx = value;     // Write
req.transaction['xxx'] = value;  // Write
const x = req.transaction.xxx;   // Read
```

### External Calls
```javascript
// AVS B2B Calls
wrapper.callAVSB2B(req, res, method, action, ...)
wrapper.callAVSB2BVersioned(req, res, version, method, action, ...)

// AVS B2C Calls
wrapper.callAVSB2C(req, res, action, ...)

// DCQ Template Calls
wrapper.callAVSDCQTemplate(req, res, ..., templateName, ...)
wrapper.callDCQ(req, res, ..., templateName)
wrapper.callDcqDecoupledESTemplate(req, res, templateName, ...)

// Elasticsearch
wrapper.callES(req, res, ..., template)
wrapper.callAVSESTemplate(req, res, template, ...)

// HTTP Requests
aglUtils.httpClient(request, { url: '...' })
aglUtils.forwardRequest(request, config)
aglUtils.v2.httpClient(request, config)

// Indirect calls (also detected)
const callAVS = wrapper.callAVS;
callAVS(req, res, ...);  // Detected as AVS call
```

### Configuration Dependencies
```javascript
// Configuration access
appCache.getMWareConfig('key')      // mwareConfig
appCache.getAppConfig('key')        // appConfig  
appCache.getSysParameter('key')     // sysParameter
appCache.getEnv('key')              // env
appCache.getCustomPanicConfig('key') // customPanicConfig
```

## Technical Implementation

### Recursive Analysis Algorithm
```
1. Parse middleware file with acorn (AST)
2. Find all require() and import statements
3. Resolve component paths (supports relative paths, .js suffix, index.js)
4. Analyze component's res.locals and req.transaction operations
5. Recursively analyze sub-components (up to 5 levels deep)
6. Use Set to prevent circular references
7. Generate complete component tree
8. Detect external calls with smart template extraction
9. Mark library files to filter implementation-level calls
```

### Path Resolution Rules
1. Relative paths (`./`, `../`) resolved from current file directory
2. Automatically adds `.js` suffix
3. Checks for `index.js` pattern
4. Supports `@opus/agl-*` module resolution
5. Marks unresolvable components

### Library File Detection
The following paths are recognized as library files:
- `agl-core/*`
- `agl-utils/*`
- `agl-cache/*`
- `agl-logger/*`
- `node_modules/*`

External calls from library files are filtered out from top-level aggregation but remain visible when expanding the library component.

### External Calls Bubbling
When a component is collapsed (not visible), its external calls "bubble up" to the nearest visible ancestor node. This ensures all business-relevant external calls remain visible in the flow diagram.

**Note**: Library component calls do NOT bubble up to application components.

## Editor Layout

The Flow Analyzer uses a split editor layout for better navigation:
- **Right Group (ViewColumn.Two)**: Webview panel with flow diagram
- **Left Group (ViewColumn.One)**: Source code when clicking components

This allows you to keep the flow diagram visible while navigating through source files.

## Export Formats

### Export Options
- **SVG**: Vector format, ideal for documentation
- **PNG**: Bitmap format, ideal for sharing

## Frequently Asked Questions

### Q: Why do some components show "NOT FOUND"?
A: This can happen with dynamic require(), variable paths, or when the component file doesn't exist.

### Q: Will analyzing large endpoints be slow?
A: Recursive analysis has a depth limit (5 levels) and uses caching to avoid redundant analysis.

### Q: Can it analyze TypeScript files?
A: Currently primarily supports JavaScript files.

### Q: Why are some external calls not showing?
A: External calls from library wrapper files are filtered out at top-level. Expand the library component to see all calls.

### Q: Why do I see duplicate external calls?
A: Duplicates are automatically removed based on type + template + source file.

### Q: How do I keep the flow diagram visible while browsing code?
A: The diagram opens in the right editor group, code opens in the left group, so both remain visible.

## Version History

- **v0.4.0**: SOLID refactoring, split editor layout, indirect call detection, httpClient URL extraction
- **v0.3.2**: Added external calls deduplication, library filtering, bubbling logic for flow diagram
- **v0.3.1**: Added AVS/DCQ/ES external call detection with smart template extraction
- **v0.3.0**: Added deep component tree analysis, pan & zoom, expandable nodes
- **v0.2.0**: Added right-click menu and data flow analysis
- **v0.1.0**: Initial version with basic flow visualization
