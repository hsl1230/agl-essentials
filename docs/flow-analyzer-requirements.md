# AGL Flow Analyzer - 功能需求文档

## 1. 概述

AGL Flow Analyzer 是 VS Code 扩展 `agl-essentials` 的核心功能，用于分析 AGL 中间件的数据流、外部调用和组件依赖关系。它帮助开发者理解中间件的执行流程、`res.locals` 数据传递和外部服务调用。

---

## 2. 启动方式

- **触发方式**: 右键点击 middleware 文件 → "Analyze Middleware Flow"
- **支持的文件**: `*.js` 中间件定义文件
- **分析范围**: 从入口文件开始，递归分析所有本地依赖和 AGL 模块依赖

---

## 3. 流程图视图 (Flow Diagram)

### 3.1 图表展示

使用交互式流程图展示中间件之间的数据流动关系。

#### 图表布局
- 从上到下（TD）的流程布局
- 中间件和组件以节点形式展示
- 数据流以带标签的箭头连接

#### 节点颜色编码

| 颜色 | 含义 |
|------|------|
| 深灰色 | 无数据操作 |
| 绿色调 | 有 `res.locals` 写入 |
| 蓝色调 | 有 `res.locals` 读取 |
| 棕色调 | 同时有读写 |
| 浅灰色 | 子组件 |
| 粗边框 | 可展开的组件 |
| 粉红色调 | 外部调用节点 |

### 3.2 节点显示

#### Middleware 节点
- **▼ middlewareName**: 展开状态
- **▶ middlewareName (5)**: 折叠状态，括号内显示子组件数量

#### 组件节点
- **▼ componentName**: 展开状态，可以看到子组件
- **▶ componentName (3)**: 折叠状态，括号内显示子组件数量
- **componentName**: 无子组件的叶子节点

#### 外部调用节点
外部调用以**独立的圆角矩形节点**显示，通过虚线连接到其所属的组件节点。

**显示格式**：`类型: 模板名`
- 例如：`DCQ: GetUserProfile`
- 例如：`ELASTICSEARCH: SearchContent`
- 例如：`AVS: GetUserData`

**连接方式**：
```
┌─────────────────┐
│  componentName  │ (组件节点)
└────────┬────────┘
         ┊ (虚线)
   ┌─────┴─────┐
   │DCQ: Query │ (外部调用节点，圆角矩形，粉红色)
   └───────────┘
```

**显示规则**：
- 当组件**可见**时（无论展开或折叠），其外部调用节点直接显示在该组件下方
- 当组件**不可见**时（因祖先被折叠），外部调用节点会冒泡到最近的可见祖先组件下方显示
- 长模板名会被截断显示（最多35字符），超出部分显示 `...`

### 3.3 展开/折叠功能

- 点击节点左侧区域：展开/折叠子组件
- 默认状态：Middleware 展开，组件折叠
- 折叠时显示子组件总数
- 展开/折叠保持当前的 Pan/Zoom 状态

### 3.4 External Call 冒泡规则

当组件因祖先折叠而不可见时，其外部调用节点会"冒泡"到最近的可见祖先节点下方显示。

#### 冒泡规则
1. 收集所有外部调用及其来源组件
2. 对于**不可见**的组件（因祖先被折叠），向上查找最近的可见祖先
3. 将外部调用节点显示在可见祖先节点下方（作为独立的圆角矩形节点）

**注意**：折叠状态的组件（显示为 ▶）本身仍然**可见**，其外部调用直接显示在该组件下方，不会冒泡。

#### Flow Diagram 中的冒泡示例

**折叠前**：
```
┌─────────────────┐
│  ▼ Component A  │
└────────┬────────┘
         │
   ┌─────┴─────┐
   │Component B│ ← 有 2 个外部调用
   └─────┬─────┘
         ┊
   ┌─────┴─────┐   ┌─────────────┐
   │DCQ: Query1│   │DCQ: Query2  │
   └───────────┘   └─────────────┘
```

**折叠后**（Component B 被折叠到 A 中）：
```
┌──────────────────────┐
│  ▶ Component A (1)   │ ← 显示子组件数量
└────────┬─────────────┘
         ┊
   ┌─────┴─────┐   ┌─────────────┐
   │DCQ: Query1│   │DCQ: Query2  │  ← 冒泡到 A 下方显示
   └───────────┘   └─────────────┘
```

### 3.5 应用层/库层的外部调用显示

#### Flow Diagram 中的显示规则

| 场景 | 外部调用节点显示 |
|------|-----------------|
| 应用层组件**可见** | ✅ 显示在该组件下方 |
| 应用层组件**不可见**（祖先折叠） | ✅ 冒泡到可见祖先下方 |
| 库组件**可见** | ✅ 显示在该组件下方 |
| 库组件**不可见**（祖先折叠） | ❌ 不冒泡，不显示 |

#### 设计原因
- **应用层调用**：开发者直接编写的业务逻辑，始终需要关注，支持冒泡
- **库层调用**：
  - 当展开查看库组件时，显示其内部调用（供调试参考）
  - 当库组件折叠时，不将其内部调用冒泡到父组件（避免干扰业务视图）

#### 组件详情侧边栏
无论应用层还是库层，在**组件详情侧边栏**中都显示该组件自己的 External Call，供调试时查看完整信息。

### 3.6 数据流连线

中间件之间的连线显示通过 `res.locals` 传递的属性：
- 箭头上显示属性名，如 `userInfo, sessionId`
- 最多显示 12 个属性
- 超过时显示 `+N more`

### 3.7 图表操作

#### 平移（Pan）
- 鼠标拖拽移动图表

#### 缩放（Zoom）
- 鼠标滚轮缩放
- 缩放范围：10% - 500%
- 重置按钮：恢复初始状态

### 3.8 点击交互

#### Flow Diagram 中的点击区域

节点被划分为三个点击区域（从左到右）：

```
┌──────────────────────────────────────┐
│ [左20%]  [    中间60%    ]  [右20%]  │
│ 展开/折叠    显示详情       (预留)    │
└──────────────────────────────────────┘
```

| 点击区域 | 条件 | 效果 |
|----------|------|------|
| 左侧 20% | 有子组件 | 展开/折叠子组件 |
| 中间 60% | - | 打开组件详情侧边栏 |
| 外部调用节点 | - | 跳转到该调用的源代码位置 |

#### 组件树视图中的点击

| 操作 | 效果 |
|------|------|
| 点击折叠图标 (▶/▼) | 展开/折叠子组件 |
| 点击组件名称或 Badge 区域 | 打开组件详情侧边栏（包含 External Calls 列表） |

---

## 4. 组件树视图 (Component Tree)

### 4.1 树形结构展示

- 以树形结构展示中间件及其所有依赖组件
- 每个节点显示组件名称和相关 Badge
- 支持展开/折叠子组件

### 4.2 组件类型识别

| 图标 | 类型 | 说明 |
|------|------|------|
| 📄 | 本地组件 | 项目内的 JavaScript 文件 |
| 🔧 | AGL 模块 | `@opus/agl-*` 系列库 |

### 4.3 组件 Badge 显示

| Badge | 含义 | 追踪对象 | 颜色 |
|-------|------|----------|------|
| `W:n` | res.locals 写入次数 | `res.locals.*` 写入操作 | 绿色 |
| `R:n` | res.locals 读取次数 | `res.locals.*` 读取操作 | 蓝色 |
| `TW:n` | req.transaction 写入次数 | `req.transaction.*` 写入操作 | 紫色 |
| `TR:n` | req.transaction 读取次数 | `req.transaction.*` 读取操作 | 青色 |
| `D:n` | 请求/响应数据访问次数 | `req.query`, `req.params`, `req.body`, `req.headers`, `req.cookies`, `res.cookie`, `res.header` | 黄色 |
| `E:n` | External Call 次数 | DCQ, AVS, HTTP 等外部调用 | 橙色 |

#### E:n Badge 的特殊显示规则

E:n Badge 在组件树视图中有冒泡显示机制：

| 状态 | 显示格式 | 含义 |
|------|----------|------|
| 展开 | `E:n` | 仅显示该组件自己的外部调用次数 |
| 折叠 | `E:n↑` | 显示该组件及所有后代组件的外部调用总数（↑ 表示包含冒泡） |

**基本示例**：
```
▶ ComponentA        E:5↑   ← 折叠状态，5 = 自己2个 + 子组件3个
  ├─ ComponentB     E:2    ← 自己有2个调用
  └─ ComponentC     E:1    ← 自己有1个调用
```

展开后：
```
▼ ComponentA        E:2    ← 展开状态，仅显示自己的2个
  ├─ ComponentB     E:2
  └─ ComponentC     E:1
```

#### 应用层/库层的 Badge 显示规则

| 场景 | E:n Badge 显示 | 聚合统计 |
|------|---------------|----------|
| 应用层组件**展开** | `E:n`（仅自己） | ✅ 计入总数 |
| 应用层组件**折叠** | `E:n↑`（自己 + 后代冒泡） | ✅ 计入总数 |
| 库组件**展开** | `E:n`（仅自己） | ❌ 不计入顶层统计 |
| 库组件**折叠** | 不冒泡 | ❌ 不计入 |

#### 冒泡行为示例

**示例1：应用组件之间的冒泡**
```
▼ 应用组件 A        E:1    ← 展开，仅显示自己的1个
  └─▶ 应用组件 B    E:5↑   ← 折叠，显示自己2个 + C的3个
       └─ 应用组件 C  (不可见，有3个调用，冒泡到B)
```

**示例2：库组件不冒泡**
```
▼ 应用组件 A        E:0    ← A 自己没有调用
  └─▶ 库组件 B      E:2    ← 折叠，但库调用不冒泡到 A
       └─ 库组件 C    (不可见，有1个调用，也不冒泡)
```

**示例3：混合场景**
```
▼ 应用组件 A        E:1    ← 仅自己的1个
  ├─▶ 应用组件 B    E:3↑   ← 自己2个 + C的1个
  │    └─ 应用组件 C  (不可见，有1个调用)
  └─▶ 库组件 D      E:3    ← 库调用不冒泡到 A
```

#### Badge 区别说明

- **W/R (res.locals)**: 追踪中间件之间通过 `res.locals` 对象传递的数据，这是 Express 中间件最常用的数据共享机制
- **TW/TR (req.transaction)**: 追踪通过 `req.transaction` 传递的事务级元数据，如时间戳、追踪ID等
- **D (Data Usage)**: 追踪其他请求/响应数据的读写
  - 请求输入: `req.query`, `req.params`, `req.body`, `req.headers`, `req.cookies`
  - 响应输出: `res.cookie()`, `res.setHeader()`, `res.header()`
- **E (External Calls)**: 追踪对外部服务的调用（见第6节）

### 4.4 Shallow Reference（浅引用）

- 当同一组件被多个父组件引用时，避免重复分析
- 首次引用进行完整分析，后续引用使用缓存结果
- 浅引用保留完整的子组件树结构

---

## 5. 数据流分析 (Data Flow)

### 5.1 res.locals 追踪

追踪通过 `res.locals` 对象传递的数据：

**写入示例 (W)**:
- `res.locals.userInfo = userData`
- `res.locals['sessionId'] = sid`

**读取示例 (R)**:
- `const user = res.locals.userInfo`
- `const { sessionId } = res.locals`

### 5.2 req.transaction 追踪

追踪通过 `req.transaction` 对象传递的事务数据：

**写入示例 (TW)**:
- `req.transaction.startTime = Date.now()`
- `req.transaction.userId = user.id`

**读取示例 (TR)**:
- `const elapsed = Date.now() - req.transaction.startTime`
- `const { userId } = req.transaction`

#### req.transaction vs res.locals 的区别

| 特性 | res.locals | req.transaction |
|------|------------|-----------------|
| 用途 | 中间件间数据传递 | 事务/请求级别的元数据 |
| 典型内容 | 业务数据、用户信息 | 时间戳、追踪ID、事务状态 |
| 生命周期 | 单个请求 | 单个请求 |
| Badge | W (写入) / R (读取) | TW (写入) / TR (读取) |
| 颜色 | 绿色 / 蓝色 | 紫色 / 青色 |

### 5.3 Data Usage 追踪

追踪其他请求/响应数据的使用：

| 数据源 | 类型 | 示例 |
|--------|------|------|
| `req.query` | 读取 | URL 查询参数 |
| `req.params` | 读取 | 路由参数 |
| `req.body` | 读取 | 请求体数据 |
| `req.headers` | 读取 | 请求头 |
| `req.cookies` | 读取 | Cookie 数据 |
| `res.cookie()` | 写入 | 设置 Cookie |
| `res.header()` | 写入 | 设置响应头 |

### 5.4 去重规则

- 同一属性在同一源文件中只计数一次
- 保留所有不同源文件的使用记录
- 计数基于唯一源文件数量

---

## 6. 外部调用分析 (External Calls)

### 6.1 支持的调用类型

| 类型 | 识别的方法 | 说明 |
|------|----------|------|
| `dcq` | `callAVSDCQTemplate`, `callDCQ`, `callAVSDCQSearch` | DCQ 模板调用 |
| `avs` | `callAVS`, `callAVSB2C`, `callAVSB2B`, `callAVSB2BVersioned` 等 | AVS 服务调用 |
| `pinboard` | `callPinboard` | Pinboard 服务 |
| `elasticsearch` | `callAVSESTemplate`, `callDcqDecoupledESTemplate`, `callES` | ES 搜索调用 |
| `external` | `callExternal` | 外部 API 调用 |
| `ava` | `callAVA` | AVA 服务 |
| `dsf` | `callDsf` | DSF 服务 |
| `microservice` | `callAVSMicroservice` | 微服务调用 |
| `http` | `aglUtils.httpClient`, `aglUtils.forwardRequest` | HTTP 客户端 |

#### DCQ ES Mapper 快捷方法

以下方法也被识别为 `dcq` 类型：
- `callGetAggregatedContentDetail`
- `callGetLiveContentMetadata`
- `callGetVodContentMetadata`
- `callGetLauncherMetadata`
- `callGetLiveChannelList`
- `callSearchSuggestions`
- `callSearchVodEvents`
- `callSearchContents`
- `callGetLiveInfo`
- `callGetEpg`

#### AVS 系列方法

| 方法 | Action 参数位置 |
|------|----------------|
| `callAVS(req, res, apiType, method, action, ...)` | 第5个参数 |
| `callAVSB2C(req, res, action, ...)` | 第3个参数 |
| `callAVSB2B(req, res, method, action, ...)` | 第4个参数 |
| `callAVSB2BVersioned(req, res, version, method, action, ...)` | 第5个参数 |

### 6.2 多行函数调用支持

支持检测跨多行的函数调用，正确识别行号：
```javascript
const result = await callDcqDecoupledESTemplate(
    req,
    res,
    templateName,
    params
);
```

### 6.3 应用层 vs 库层调用

#### 区分规则
- **应用层调用**: 在项目代码中直接调用外部服务
- **库层调用**: 在 `agl-utils`, `agl-core` 等库内部的调用

#### 过滤规则
- 聚合视图中过滤掉库层调用
- 组件详情中仍然显示库层调用（供调试参考）

### 6.4 去重规则

- 同一类型、模板、源文件的调用只计数一次
- 不同行的相同调用视为一次
- 库层调用不计入顶层统计

---

## 7. 冒泡显示规则总结

External Calls 的冒泡机制在两个视图中都有体现：

### 7.1 Flow Diagram 中的冒泡

当组件因祖先折叠而**不可见**时，其外部调用节点会冒泡到最近的可见祖先下方显示（详见 3.4 节）。

### 7.2 组件树 E:n Badge 的冒泡

当组件**折叠**时，E:n Badge 显示汇总数值（自己 + 所有后代），并用 ↑ 指示器标记（详见 4.3 节）。

| 视图 | 触发条件 | 冒泡行为 |
|------|----------|----------|
| Flow Diagram | 组件不可见（祖先折叠） | 外部调用节点移到可见祖先下方 |
| 组件树 Badge | 组件折叠 | E:n 数值汇总后代，显示 ↑ 指示器 |

**注意**：库组件的调用在两个视图中都不会冒泡到应用层父组件。

---

## 8. Library 模块识别

### 8.1 识别的库路径

以下路径被识别为库模块：
- `agl-utils`
- `agl-core`
- `agl-cache`
- `agl-logger`
- `node_modules`

### 8.2 库的特殊处理

- 库组件用 🔧 图标标识
- 库内部的外部调用不计入顶层统计
- 库组件折叠时，其调用不会向上冒泡

---

## 9. 详情弹出面板

### 9.1 Property Usage 详情

点击 Data Flow 中的属性时，显示浮动面板：

#### 分组显示
- **App Section**: 应用层代码中的使用
- **Library Section**: 库代码中的使用

#### 按文件分组
- 同一文件的多个使用折叠在一起
- 显示文件中的使用次数

### 9.2 External Call 详情

#### 触发方式
在**组件详情侧边栏**中查看 External Calls 部分。

#### 侧边栏中的 External Calls 显示

当打开组件详情侧边栏时，会显示该组件的外部调用列表：

**显示内容**：
- 按调用类型分组（DCQ, AVS, HTTP 等）
- 每个调用显示：
  - 调用类型图标和类型名称
  - 模板/Action 名称
  - 源文件路径（如果来自子组件）
  - 行号
- 点击任意调用条目可跳转到源代码位置

**分组结构示例**：
```
🌐 External Calls (5)

├── 📊 DCQ (2)
│   ├── GetUserProfile          :45
│   └── GetContentMetadata      :78
│
├── 🔗 AVS (2)
│   ├── GetUserData             :123
│   └── UpdateProfile           :156
│
└── 🔍 ELASTICSEARCH (1)
    └── SearchContent           :89
```

#### Middleware 的 External Calls

Middleware 详情侧边栏中额外显示：
- **自己的调用**: 该 Middleware 文件中直接调用的外部服务
- **展开查看所有调用**: 可展开显示所有子组件中的外部调用（按来源分组）

---

## 10. 交互功能

### 10.1 代码跳转

- 点击组件名称 → 跳转到组件文件
- 点击 Data Usage 条目 → 跳转到使用位置
- 点击 External Call 条目 → 跳转到调用位置

### 10.2 侧边栏导航

- **Back 按钮**: 返回上一个查看的组件
- **历史记录**: 维护浏览历史栈

### 10.3 刷新功能

- 重新分析当前 middleware
- 获取最新代码结构

---

## 11. 已知限制

1. **动态属性**: 无法追踪 `res.locals[variable]` 形式的动态属性访问
2. **间接调用**: 无法追踪通过变量间接调用的外部服务
3. **异步流程**: 不分析 Promise chain 或 async/await 的执行顺序
4. **条件分支**: 不区分 if/else 分支中的不同调用路径

---

## 12. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2025-12 | 初始版本 |
| 1.1 | 2025-12 | 添加多行函数调用支持 |
| 1.2 | 2025-12 | 添加 Library 调用过滤 |
| 1.3 | 2025-12 | 优化去重逻辑，添加冒泡显示 |
| 1.4 | 2025-12 | 添加 req.transaction 追踪（TW/TR Badge）|
| 1.5 | 2025-12 | SOLID 重构：拆分为多个专用分析器模块 |
| 1.6 | 2025-12 | 添加间接调用追踪（wrapper 方法赋值模式）|
| 1.7 | 2025-12 | 添加 httpClient URL 提取 |
| 1.8 | 2025-12 | Webview 分组布局：Flow Diagram 右侧，代码左侧 |
| 1.9 | 2025-12 | Endpoint 搜索功能 |
| 2.0 | 2025-12 | HTTP 方法图标、多根工作区支持 |
