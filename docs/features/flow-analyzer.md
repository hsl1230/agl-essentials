# AGL Flow Analyzer

## 概述

AGL Flow Analyzer 是一个强大的可视化工具，用于分析和理解 AGL 中间件端点的执行流程。它能够深度分析中间件及其所有子组件，追踪 `res.locals.*` 数据如何在整个调用链中读写和传递。

## 主要功能

### 1. 流程图可视化 (Flow Diagram)
- 使用 Mermaid.js 生成美观的流程图
- 展示端点 → 中间件 → 组件 的完整调用链
- 包含数据流向标注（读取/写入）
- 支持导出 SVG 和 PNG 格式

### 2. 中间件分析 (Middleware Analysis)
- 列出端点的所有中间件
- 分析每个中间件的 `res.locals` 读写操作
- 识别外部 API 调用和 AGL Core 调用
- 追踪配置依赖（环境变量、配置文件等）

### 3. 深层组件树分析 (Component Trees) ⭐ NEW
最强大的功能 - 递归分析每个中间件调用的所有组件：
- **递归深度**: 最多分析 5 层嵌套组件
- **组件追踪**: 显示每个组件调用了哪些子组件
- **数据流追踪**: 在每个层级追踪 `res.locals.*` 的读写
- **外部调用识别**: 识别 HTTP 请求、AGL Core 调用等
- **可折叠树形视图**: 方便浏览复杂的组件层级
- **点击导航**: 点击任何组件直接跳转到源代码

### 4. 数据流分析 (Data Flow)
- 分析 `res.locals` 属性的完整生命周期
- 识别数据的生产者（writer）和消费者（reader）
- 包含组件级别的数据流追踪

### 5. 生产者-消费者关系 (Producers/Consumers)
- 可视化数据依赖关系
- 帮助理解中间件之间的数据传递
- 识别潜在的依赖问题

## 使用方法

### 方法一：通过 AGL 端点树
1. 打开 AGL 端点树视图
2. 右键点击任意端点
3. 选择 "Analyze Endpoint Flow"

### 方法二：通过命令面板
1. 按 `Ctrl+Shift+P`
2. 输入 "AGL: Analyze Endpoint Flow"
3. 选择要分析的端点

## 组件树功能详解

### 树形结构
```
📁 middleware_1.js
├── 📄 component_a.js
│   ├── 📤 writes: res.locals.data1
│   ├── 📥 reads: res.locals.input
│   ├── 🔗 calls: aglCore.makeRequest
│   └── 📁 sub_component_1.js
│       ├── 📤 writes: res.locals.result
│       └── 📥 reads: res.locals.data1
├── 📄 component_b.js
│   └── ...
```

### 视觉指示器
- 🟢 **绿色 (WRITE)**: 组件写入 `res.locals`
- 🔵 **蓝色 (READ)**: 组件读取 `res.locals`
- 🟣 **紫色**: 外部调用（HTTP, AGL Core 等）
- 📁 **文件夹图标**: 可展开的子组件
- ⚠️ **警告标记**: 找不到的组件文件

### 交互功能
- **点击展开/折叠**: 展开或折叠子组件树
- **点击组件名**: 显示组件详细信息侧边栏
- **点击文件路径**: 在编辑器中打开组件文件
- **点击行号**: 跳转到代码的具体位置

## 分析的内容

### res.locals 操作
```javascript
// 识别的模式
res.locals.xxx = value;     // 写入
res.locals['xxx'] = value;  // 写入
const x = res.locals.xxx;   // 读取
res.locals.xxx.property;    // 读取
```

### 外部调用
```javascript
// HTTP 请求
axios.get(), axios.post()
fetch()
request()
http.get(), https.get()

// AGL Core
aglCore.makeRequest()
aglCore.makeConditionalRequest()
aglCore.makeBatchRequest()
```

### 配置依赖
```javascript
// 环境变量
process.env.XXX

// 配置文件
config.xxx
appConfig.xxx
endpoints.xxx
```

## 技术实现

### 递归分析算法
```
1. 解析中间件文件
2. 查找所有 require() 和 import 语句
3. 解析组件路径（支持相对路径、.js 后缀、index.js）
4. 分析组件的 res.locals 操作
5. 递归分析组件调用的子组件（最多 5 层）
6. 使用 Set 防止循环引用
7. 生成完整的组件树
```

### 路径解析规则
1. 相对路径 (`./`, `../`) 从当前文件目录解析
2. 自动添加 `.js` 后缀
3. 检查 `index.js` 模式
4. 标记无法解析的组件

## 配置选项

暂无特定配置选项，功能开箱即用。

## 输出格式

### 导出选项
- **SVG**: 矢量图，适合文档
- **PNG**: 位图，适合分享

## 常见问题

### Q: 为什么某些组件显示 "NOT FOUND"？
A: 可能是动态 require、使用变量路径、或组件确实不存在。

### Q: 分析大型端点时会很慢吗？
A: 递归分析有深度限制（5层），且使用缓存避免重复分析。

### Q: 能分析 TypeScript 文件吗？
A: 目前主要支持 JavaScript 文件。

## 版本历史

- **v0.3.0**: 添加深层组件树分析功能
- **v0.2.0**: 添加右键菜单和数据流分析
- **v0.1.0**: 初始版本，基本流程可视化
