# AGL Essentials

**AGL Essentials** is a Visual Studio Code extension designed to simplify and enhance AGL (Accenture Gateway Layer) development within the **Opus TV system**. It provides essential tools including an **Endpoint Viewer**, **Mapper Viewer**, and a powerful **Flow Analyzer** to boost productivity and streamline the development process.

---

## 📋 Table of Contents

- [Features](#-features)
- [Getting Started](#-getting-started)
- [Installation](#-installation)
- [User Guide](#-user-guide)
- [Configuration](#️-configuration)
- [Extension Commands](#-extension-commands)
- [Keyboard Shortcuts](#️-keyboard-shortcuts)
- [Contributing](#-contributing)

---

## 🚀 Features

### 1. Endpoint Viewer
- View and manage AGL endpoints in a hierarchical tree view
- Navigate directly to endpoint definitions and middleware files
- Support for multiple API versions (1.0, 1.2, 1.4, 1.5, 2.0, 2.1)
- Quick access to endpoint configurations

### 2. Mapper Viewer
- Visualize and modify data mappings in the AGL layer
- Handle complex mapping scenarios with ease
- Highlight and validate errors in mapping configurations

### 3. Flow Analyzer ⭐ NEW
A powerful visualization tool for understanding middleware execution flows:
- **Mermaid Flow Diagrams**: Interactive visual representation of endpoint → middleware → component call chains
- **Pan & Zoom**: Navigate large diagrams with mouse drag and scroll wheel
- **Expandable Components**: Click to expand/collapse nested component hierarchies
- **External Calls Detection**: Automatically detects and displays:
  - AVS B2B/B2C API calls
  - DCQ template calls
  - Elasticsearch queries
  - HTTP client calls
- **Data Flow Tracking**: Trace `res.locals` and `req.transaction` read/write operations
- **Smart Bubbling**: External calls bubble up to the nearest visible ancestor node
- **Library Filtering**: Hides low-level library calls, shows only business-relevant external calls
- **Export Options**: Export diagrams as SVG or PNG

### 4. Deep Component Analysis
- Recursive analysis up to 5 levels deep
- Tracks `res.locals` and `req.transaction` data flow at each level
- Identifies external API calls and AGL Core calls
- Click-to-navigate to source code locations

---

## 📦 Installation

1. Open **Visual Studio Code**
2. Go to the **Extensions** view by clicking on the Extensions icon in the Activity Bar or pressing `Ctrl+Shift+X`
3. Search for **AGL Essentials**
4. Click **Install**

---

## 🎯 Getting Started

### Prerequisites

This extension requires your workspace to contain AGL middleware configurations. It automatically activates when it detects directories matching the pattern `agl-config-*`.

### First Steps

1. **Open your AGL workspace** - Open a folder containing AGL middleware (e.g., `agl-config-content`, `agl-config-plus`, etc.)
2. **Find the AGL icon** - Look for the **AGL Essentials** icon in the Activity Bar on the left side of VS Code
3. **Explore the sidebar** - Click the icon to see Mappers and Endpoints views

---

## 📖 User Guide

### Sidebar Views

When you click the AGL Essentials icon, you'll see two main views:

#### Mappers View
- Displays all data mappers organized by middleware
- Click on a mapper to open the **Mapper Viewer** with detailed field mappings
- Shows mapping structure and data transformations

#### Endpoints View
- Lists all API endpoints defined in your middleware
- **HTTP Method Icons**: Visual indicators for request types
  - 🔵 **GET** - Blue badge
  - 🟢 **POST** - Green badge  
  - 🟠 **PUT** - Orange badge
  - 🔴 **DELETE** - Red badge
- **Version Labels**: Shows API version (v1.2, v1.5, etc.)
- **URL Path**: The endpoint route as description

### Endpoint Flow Analysis

This is the most powerful feature for understanding middleware execution:

1. **Open Flow Analysis**:
   - Right-click on any endpoint → Select **"AGL: Analyze Endpoint Flow"**
   - Or click the 🔍 search icon on the endpoint

2. **What you'll see**:
   - **Middleware Pipeline**: Visual flow diagram showing all components
   - **External Calls**: DCQ templates, AVS calls, httpClient requests
   - **Data Flow**: `res.locals` and `req.transaction` read/write tracking
   - **Config Dependencies**: `appCache.getMWareConfig` calls

3. **Navigation**:
   - Click on any component to open its source file
   - Expand/collapse nested components
   - Pan and zoom the flow diagram

### Search in Endpoint

Search for specific patterns within an endpoint's component chain:

1. Right-click on an endpoint → Select **"AGL: Search in Endpoint"**
2. Enter your search term
3. Results show matching:
   - Middleware component names
   - External call templates
   - Configuration keys
   - Data properties

### Go to Unit Test

When editing a middleware JS file:
- Right-click in the editor → **"Go to Unit Test File"**
- Automatically navigates to the corresponding test file

---

## 📝 Usage

### Open the Endpoint Viewer
1. Press `Ctrl+Shift+P` to open the Command Palette
2. Search for `AGL Essentials: Open Endpoint Viewer` and press `Enter`

### Open the Mapper Viewer
1. Press `Ctrl+Shift+P` to open the Command Palette
2. Search for `AGL Essentials: Open Mapper Viewer` and press `Enter`

### Analyze Endpoint Flow
1. In the Endpoint Viewer, right-click on any endpoint
2. Select **"Analyze Endpoint Flow"**
3. Or use Command Palette: `AGL: Analyze Endpoint Flow`

---

## ⚙️ Configuration

To customize the behavior of **AGL Essentials**, modify the following settings in your `settings.json`:

```json
{
  "aglEssentials.endpointPath": "path/to/endpoint/files",
  "aglEssentials.mapperPath": "path/to/mapper/files"
}
```

---

## 🧩 Extension Commands

| Command                                  | Description                              |
| ---------------------------------------- | ---------------------------------------- |
| `AGL Essentials: Open Endpoint Viewer`   | Opens the Endpoint Viewer tree           |
| `AGL Essentials: Open Mapper Viewer`     | Opens the Mapper Viewer                  |
| `AGL: Analyze Endpoint Flow`             | Opens the Flow Analyzer for an endpoint  |
| `AGL: Search in Endpoint`                | Search within endpoint's middleware chain|

---

## ⌨️ Keyboard Shortcuts

| Action | Shortcut |
| ------ | -------- |
| Open Command Palette | `Ctrl+Shift+P` (Windows/Linux) / `Cmd+Shift+P` (Mac) |
| Open Extensions View | `Ctrl+Shift+X` |
| Toggle Sidebar | `Ctrl+B` |

### Context Menu Actions

| Action | Where | How |
| ------ | ----- | --- |
| Analyze Endpoint Flow | Endpoints View | Right-click endpoint → "AGL: Analyze Endpoint Flow" |
| Search in Endpoint | Endpoints View | Right-click endpoint → "AGL: Search in Endpoint" |
| Go to Unit Test File | JS Editor | Right-click → "Go to Unit Test File" |

---

## 💡 Tips & Tricks

1. **Quick Analysis**: Use the inline 🔍 icon on endpoints for faster flow analysis
2. **Deep Dive**: The flow analyzer tracks up to 5 levels of nested component calls
3. **External Calls**: Look for DCQ, AVS, httpClient calls highlighted in the flow diagram
4. **Data Tracing**: Track where `res.locals` properties are set and read
5. **Export Diagrams**: Use the export button to save flow diagrams as SVG/PNG

---

## 🤝 Contributing

We welcome contributions! If you'd like to suggest new features, report bugs, or contribute to the codebase, please feel free to submit an issue or create a pull request.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

## 📚 Resources

- [Flow Analyzer Documentation](docs/features/flow-analyzer.md)
- [Visual Studio Code API Documentation](https://code.visualstudio.com/api)
- [Opus TV System Documentation](#) *(Update with the correct URL if available)*
