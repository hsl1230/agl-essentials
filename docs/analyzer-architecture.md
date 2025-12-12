# AGL Essentials 分析器架构设计

## 概述

本文档描述了 `agl-essentials` 扩展中分析器模块的设计理念和协作机制。经过 SOLID 原则重构，分析器被拆分为多个职责单一的模块。

---

## 模块架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FlowAnalyzerPanel                                │
│                    (Webview 面板，用户交互层)                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        MiddlewareAnalyzer                                │
│  - 入口点分析                                                            │
│  - ComponentAnalysis → MiddlewareAnalysis 转换                          │
│  - 聚合 all* 字段                                                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    ComponentAnalyzerAcorn                                │
│               (主协调器，组合各专用分析器)                                │
│                                                                          │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │  PathResolver   │  │ ExternalCallAnalyzer │  │ DataUsageAnalyzer  │   │
│  │  路径解析       │  │ 外部调用检测         │  │ 数据流追踪         │   │
│  └─────────────────┘  └──────────────────┘  └──────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────┐  ┌────────────────────────────────────┐   │
│  │ ConfigDependencyAnalyzer │  │           AstUtils                 │   │
│  │ 配置依赖分析             │  │        AST 工具函数                │   │
│  └─────────────────────────┘  └────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                       ┌───────────────────────┐
                       │  ComponentAnalysis    │
                       │  (分析结果数据结构)    │
                       └───────────────────────┘
```

---

## 模块职责 (SOLID 原则)

### 1. AstUtils (`ast-utils.ts`)

**单一职责**: AST 工具函数和类型定义

| 功能 | 描述 |
|------|------|
| `Node` 类型 | 统一的 AST 节点类型定义 |
| `getPropertyName()` | 从属性节点提取名称 |
| `matchesMemberExpression()` | 匹配成员表达式模式 |
| `extractPropertyPath()` | 提取属性链路径 |
| `getLineNumber()` | 获取行号 |
| `getCodeSnippet()` | 提取代码片段 |
| `extractPossibleStringValues()` | 提取可能的字符串值 |
| `resolveVariableInScope()` | 作用域感知的变量解析 |

---

### 2. PathResolver (`path-resolver.ts`)

**单一职责**: 路径解析和模块名称处理

| 功能 | 描述 |
|------|------|
| `resolveLocalPath()` | 解析本地 require 路径 |
| `resolveAglModulePath()` | 解析 @opus/agl-* 模块路径 |
| `getAglModuleRoot()` | 获取 AGL 模块根目录 |
| `getModuleName()` | 从文件路径提取模块名 |
| `getDisplayName()` | 生成显示名称 |
| `getMiddlewareRoot()` | 获取中间件根目录 |

---

### 3. ExternalCallAnalyzer (`external-call-analyzer.ts`)

**单一职责**: 检测和分析外部 API 调用

| 功能 | 描述 |
|------|------|
| `detectWrapperType()` | 从 require 路径推断调用类型 |
| `registerWrapperImports()` | 注册 wrapper 导入 |
| `trackWrapperMethodAssignment()` | 追踪间接调用模式 |
| `extractTemplateArg()` | 提取模板参数 |
| `extractHttpClientUrl()` | 提取 httpClient URL |
| `analyze()` | 分析 CallExpression |

**支持的外部调用类型**:
```typescript
type ExternalCallType = 
  | 'dcq'           // DCQ 模板调用
  | 'avs'           // AVS 服务调用
  | 'ava'           // AVA 服务
  | 'dsf'           // DSF 服务
  | 'elasticsearch' // ES 搜索调用
  | 'external'      // 外部 API
  | 'pinboard'      // Pinboard 服务
  | 'microservice'  // 微服务调用
  | 'http'          // HTTP 客户端
  | 'cache';        // 缓存调用
```

**模板参数位置映射**:
```typescript
const TEMPLATE_ARG_INDEX: [RegExp, number][] = [
  [/^callAVSDCQTemplate$/, 4],
  [/^callDCQ$/, 6],
  [/^callAVS$/, 4],
  [/^callAVSB2C(WithFullResponse)?$/, 2],
  [/^callAVSB2B(WithFullResponse)?$/, 3],
  [/^callAVSB2BVersioned(WithFullResponse)?$/, 4],
  // ... 更多映射
];
```

---

### 4. DataUsageAnalyzer (`data-usage-analyzer.ts`)

**单一职责**: 追踪 res.locals、req.transaction 和其他数据使用

| 功能 | 描述 |
|------|------|
| `analyzeResLocals()` | 分析 res.locals 读写 |
| `analyzeReqTransaction()` | 分析 req.transaction 读写 |
| `analyzeDataUsage()` | 分析 req.query/body/params 等 |
| `analyzeResponseMethods()` | 分析 res.cookie/header 等 |

**追踪的数据类型**:
| 类型 | Badge | 描述 |
|------|-------|------|
| res.locals 写入 | W | 中间件数据传递 |
| res.locals 读取 | R | 中间件数据读取 |
| req.transaction 写入 | TW | 事务元数据写入 |
| req.transaction 读取 | TR | 事务元数据读取 |
| 请求数据 | D | req.query/body/params 等 |

---

### 5. ConfigDependencyAnalyzer (`config-dependency-analyzer.ts`)

**单一职责**: 检测 appCache 配置依赖

| 功能 | 描述 |
|------|------|
| `analyze()` | 分析 appCache 调用 |

**检测的方法**:
- `appCache.getMWareConfig()` → mwareConfig
- `appCache.getAppConfig()` → appConfig
- `appCache.getSysParameter()` → sysParameter
- `appCache.getEnv()` → env
- `appCache.getCustomPanicConfig()` → customPanicConfig

---

### 6. ComponentAnalyzerAcorn (`component-analyzer-acorn.ts`)

**协调器角色**: 组合各专用分析器，执行完整的组件分析

| 功能 | 描述 |
|------|------|
| `analyze()` | 分析单个组件文件 |
| `analyzeMiddlewareEntry()` | 分析中间件入口 |
| `analyzeAST()` | 遍历 AST 并调用各分析器 |
| `analyzeChildComponents()` | 递归分析子组件 |

**分析流程**:
```
1. 解析文件路径
2. 检查缓存 (mtimeMs hash)
3. 检查循环依赖 (analysisStack)
4. acorn.parse() → AST
5. estree-walker 遍历 AST:
   ├── require() → 发现子组件
   ├── res.locals.xxx → DataUsageAnalyzer
   ├── wrapper.callXxx() → ExternalCallAnalyzer
   └── appCache.getXxx() → ConfigDependencyAnalyzer
6. 递归分析子组件 (depth+1)
7. 返回 ComponentAnalysis (树形结构)
```

---

### 7. MiddlewareAnalyzer (`middleware-analyzer.ts`)

**聚合层**: 将组件分析结果转换为中间件分析结果

| 职责 | 描述 |
|------|------|
| 委托分析 | 使用 ComponentAnalyzerAcorn 分析 |
| 格式转换 | ComponentAnalysis → MiddlewareAnalysis |
| 数据聚合 | 计算 all* 字段 |
| 去重处理 | deduplicate<T>() 泛型方法 |

---

## 设计亮点

### 1. SOLID 原则应用

| 原则 | 应用 |
|------|------|
| **S** - 单一职责 | 每个分析器类只负责一类分析任务 |
| **O** - 开放封闭 | 新增外部调用类型只需修改 ExternalCallAnalyzer |
| **L** - 里氏替换 | ComponentAnalyzer 接口可替换实现 |
| **I** - 接口隔离 | 各分析器有独立的分析方法 |
| **D** - 依赖倒置 | ComponentAnalyzerAcorn 依赖抽象分析器接口 |

### 2. 智能缓存策略

```typescript
// 文件级缓存
const cached = this.cache.get(normalizedPath);
if (cached.fileHash === stats.mtimeMs.toString()) {
  return cached.result;  // 文件未修改，直接返回
}

// 组件级去重
if (collectedPaths.has(component.filePath)) {
  return;  // 已收集过，跳过
}
```

### 3. 作用域感知的变量解析

```typescript
// 从当前函数向上搜索到全局作用域
resolveVariableInScope(variableName, ancestors): string | undefined {
  const scopes = findEnclosingScopes(ancestors);
  for (const scopeNode of scopes) {
    const values = findVariableInScope(variableName, scopeNode);
    if (values.length > 0) return values.join(' | ');
  }
}
```

### 4. 间接调用追踪

```typescript
// 支持间接调用模式
const callAVS = wrapper.callAVS;  // 追踪赋值
callAVS(req, res, ...);           // 识别为 AVS 调用
```

### 5. require 路径推断

```typescript
// 不硬编码方法名映射，从 require 路径推断类型
const wrapper = require('@opus/agl-core/wrapper/request/dcq');
// 自动推断: wrapper.callXxx() → type: 'dcq'
```

---

## 文件位置

```
src/analyzers/
├── ast-utils.ts                    # AST 工具函数
├── path-resolver.ts                # 路径解析
├── external-call-analyzer.ts       # 外部调用分析
├── data-usage-analyzer.ts          # 数据流分析
├── config-dependency-analyzer.ts   # 配置依赖分析
├── component-analyzer-acorn.ts     # 组件分析器 (AST)
├── component-analyzer.ts           # 组件分析器 (Regex, 备用)
├── middleware-analyzer.ts          # 中间件聚合分析
└── flow-analyzer.ts                # 流程分析器

src/models/
└── flow-analyzer-types.ts          # 类型定义
```
