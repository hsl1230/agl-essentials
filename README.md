# AGL Essentials

**AGL Essentials** is a Visual Studio Code extension designed to simplify and enhance AGL (Accenture Gateway Layer) development within the **Opus TV system**. It provides essential tools including an **Endpoint Viewer**, **Mapper Viewer**, and a powerful **Flow Analyzer** to boost productivity and streamline the development process.

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
