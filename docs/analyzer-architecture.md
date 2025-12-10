# AGL Essentials 分析器架构设计

## 概述

本文档描述了 `agl-essentials` 扩展中三个核心分析器类的设计理念和协作机制。

---

## 三个分析器类的设计理念

### 1. ComponentAnalyzer (Regex-based)

**核心理念**: 基于正则表达式的组件分析器

| 特性 | 描述 |
|------|------|
| **分析方式** | 使用正则表达式逐行扫描 JavaScript 文件 |
| **优点** | 实现简单，对简单模式匹配速度快 |
| **缺点** | 无法处理跨行表达式、嵌套结构等复杂场景 |
| **缓存策略** | 基于文件 `mtimeMs` 的结果缓存，避免重复分析 |
| **递归分析** | 通过 `require` 语句发现子组件并递归分析 |

**设计原则**:
- 每个组件独立分析，不做聚合
- 通过 `analysisStack` 检测循环依赖
- 最大递归深度限制 (`MAX_DEPTH = 10`)

---

### 2. ComponentAnalyzerAcorn (AST-based)

**核心理念**: 基于 AST 的组件分析器，与 ComponentAnalyzer 接口完全兼容

| 特性 | 描述 |
|------|------|
| **分析方式** | 使用 `acorn` 解析 AST，`estree-walker` 遍历 |
| **优点** | 准确处理跨行表达式、嵌套对象访问、复杂赋值模式 |
| **外部调用类型推断** | 通过 `require` 路径模式 `/wrapper/request/xxx` 推断调用类型 |
| **变量解析** | 作用域感知 - 从当前函数作用域向上搜索到全局作用域 |

**模板参数解析**:
- 根据方法名查找特定参数位置 (`TEMPLATE_ARG_INDEX`)
- 支持 `Identifier` 类型参数的变量值解析
- 处理 `ConditionalExpression` 和 `LogicalExpression` 提取多个可能值

---

### 3. MiddlewareAnalyzer (Aggregation Layer)

**核心理念**: 中间件分析的包装器，负责聚合和格式转换

| 职责 | 描述 |
|------|------|
| **委托分析** | 使用 `ComponentAnalyzer` 进行实际文件分析 |
| **格式转换** | 将 `ComponentAnalysis` 转换为 `MiddlewareAnalysis` 格式 |
| **数据聚合** | 计算聚合数据（`all*` 字段） |
| **向后兼容** | 保持 `MiddlewareAnalysis` 接口不变 |

**聚合逻辑**:
- 递归遍历组件树，收集所有子组件的分析结果
- 使用 `collectedPaths` 避免重复收集同一组件
- 通用的 `deduplicate<T>` 泛型方法去重

---

## 架构关系图

```
┌─────────────────────────────────────────────────────────────┐
│                    MiddlewareAnalyzer                        │
│  - 入口点分析                                                 │
│  - ComponentAnalysis → MiddlewareAnalysis 转换               │
│  - 聚合 all* 字段                                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│         ComponentAnalyzer  或  ComponentAnalyzerAcorn        │
│  ┌──────────────────────┐  ┌────────────────────────────┐   │
│  │ Regex-based (原版)   │  │ AST-based (acorn版)        │   │
│  │ - 正则逐行匹配       │  │ - AST 语法树分析           │   │
│  │ - 简单快速           │  │ - 准确处理复杂场景         │   │
│  │                      │  │ - 作用域感知的变量解析     │   │
│  └──────────────────────┘  └────────────────────────────┘   │
│                    (相同的公共接口)                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │ ComponentAnalysis │
                    │ (分析结果数据结构) │
                    └───────────────────┘
```

---

## ComponentAnalyzerAcorn 与 MiddlewareAnalyzer 的协作机制

### 协作流程图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MiddlewareAnalyzer                               │
│  analyzeMiddleware(middlewarePath)                                       │
│      │                                                                   │
│      ├─1. 解析路径: middlewarePath → fullPath                            │
│      │                                                                   │
│      ├─2. 委托分析 ─────────────────────────────────────────────────┐   │
│      │                                                               │   │
│      │   ┌─────────────────────────────────────────────────────────┐│   │
│      │   │            ComponentAnalyzerAcorn                        ││   │
│      │   │                                                          ││   │
│      │   │  analyze(fullPath, depth=0)                              ││   │
│      │   │      │                                                   ││   │
│      │   │      ├── 检查缓存 (mtimeMs hash)                          ││   │
│      │   │      ├── 检查循环依赖 (analysisStack)                     ││   │
│      │   │      ├── acorn.parse() → AST                             ││   │
│      │   │      ├── estree-walker 遍历 AST                           ││   │
│      │   │      │     ├── require() → 发现子组件                     ││   │
│      │   │      │     ├── res.locals.xxx → 读/写分析                 ││   │
│      │   │      │     ├── wrapper.callXxx() → 外部调用分析           ││   │
│      │   │      │     └── appCache.getXxx() → 配置依赖分析           ││   │
│      │   │      │                                                   ││   │
│      │   │      └── 递归分析子组件 (depth+1)                         ││   │
│      │   │                                                          ││   │
│      │   │  返回: ComponentAnalysis (树形结构)                       ││   │
│      │   └──────────────────────────────────────────────────────────┘│   │
│      │                                                               │   │
│      ├─3. 格式转换: ComponentAnalysis → MiddlewareAnalysis ←─────────┘   │
│      │                                                                   │
│      ├─4. 聚合数据: collectFromComponent() 递归遍历组件树               │
│      │      └── 填充 all* 字段 (allResLocalsReads, allExternalCalls...)  │
│      │                                                                   │
│      └─5. 去重: deduplicate<T>() 泛型方法                               │
│                                                                          │
│  返回: MiddlewareAnalysis (扁平化 + 聚合)                                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 设计亮点

### 1. 职责分离 (Separation of Concerns)

```
ComponentAnalyzerAcorn  →  "如何分析一个文件"
MiddlewareAnalyzer      →  "如何组织分析结果"
```

- 分析逻辑与聚合逻辑完全解耦
- 每个类职责单一，易于测试和维护

### 2. 策略模式 (Strategy Pattern)

```typescript
// MiddlewareAnalyzer 可以使用任一实现
private componentAnalyzer: ComponentAnalyzer;  // 或 ComponentAnalyzerAcorn
```

- 两个 ComponentAnalyzer 实现相同接口
- 可无缝切换 Regex 版本和 AST 版本

### 3. 树形分析 + 扁平聚合

```
ComponentAnalysis (树形)          MiddlewareAnalysis (扁平)
       A                              allExternalCalls: [
      / \                               A.calls,
     B   C                              B.calls,
        / \                             C.calls,
       D   E                            D.calls,
                                        E.calls
                                      ]
```

- ComponentAnalyzer 保持树形结构，保留层级关系
- MiddlewareAnalyzer 聚合为扁平列表，便于展示和查询

### 4. 智能缓存策略

```typescript
// ComponentAnalyzer 级别缓存
const cached = this.cache.get(normalizedPath);
if (cached.fileHash === stats.mtimeMs.toString()) {
  return cached.result;  // 文件未修改，直接返回缓存
}

// 同一组件被多个父组件引用时，只分析一次
if (collectedPaths.has(component.filePath)) {
  return;  // 已收集过，跳过
}
```

### 5. 作用域感知的变量解析 (AST 版本特有)

```typescript
// 从当前函数向上搜索到全局作用域
private resolveVariableInScope(variableName: string, ancestors: Node[]): string | undefined {
  const scopes = this.findEnclosingScopes(ancestors);  // [函数, 外层函数, ..., Program]
  for (const scopeNode of scopes) {
    const values = this.findVariableInScope(variableName, scopeNode);
    if (values.length > 0) {
      return values.join(' | ');  // 返回可能的值: "A | B"
    }
  }
}
```

### 6. 泛型去重工具

```typescript
private deduplicate<T>(
  items: T[], 
  keyFn: (item: T) => string,      // 生成唯一键
  filterFn?: (item: T) => boolean  // 可选过滤器
): T[]
```

- 一个方法处理所有类型的去重
- 避免为每种数据类型写重复代码

### 7. require 路径推断外部调用类型

```typescript
// 不再硬编码方法名到类型的映射
const wrapper = require('@opus/agl-core/wrapper/request/dcq');
// 自动推断: wrapper.callXxx() → type: 'dcq'

const { callAVS } = require('../wrapper/request/avs');  
// 自动推断: callAVS() → type: 'avs'
```

---

## 数据流向总结

| 阶段 | 输入 | 处理 | 输出 |
|------|------|------|------|
| 1. 入口 | `middlewarePath` | 路径解析 | `fullPath` |
| 2. 分析 | `fullPath` | AST 解析 + 遍历 | `ComponentAnalysis` (树) |
| 3. 转换 | `ComponentAnalysis` | 字段映射 | `MiddlewareAnalysis` (部分) |
| 4. 聚合 | 组件树 | 递归收集 | `all*` 字段填充 |
| 5. 去重 | 聚合数据 | `deduplicate<T>()` | 最终结果 |

---

## 文件位置

- `src/analyzers/component-analyzer.ts` - Regex 版本分析器
- `src/analyzers/component-analyzer-acorn.ts` - AST 版本分析器
- `src/analyzers/middleware-analyzer.ts` - 中间件聚合分析器
- `src/models/flow-analyzer-types.ts` - 类型定义
