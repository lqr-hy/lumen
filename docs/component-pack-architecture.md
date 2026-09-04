# Component Pack 架构

> 状态：Manifest Loader 与正式组件生成链已实现  
> 基线日期：2026-08-14

## 1. 目标

Component Pack 是通用 AI 设计工具中的可选业务扩展。普通后台、Web、H5、App 和整图生图不依赖 Pack，也不会扫描 `componentsJson`。只有用户明确提到 Manifest 中登记的组件名、JSON 文件名或 alias 时，Runtime 才加载对应组件并激活其 Skill。

核心 Agent 只理解统一的组件描述、`design / structural` 类型和 Skill Tool 能力，不硬编码业务组件名称、Props 路径或 Skill Tool 名称。

## 2. 目录

原生 Pack 推荐结构：

```text
component-packs/example-pack/
  manifest.json
  components/
    ExampleCard.json
    ExampleContainer.json
  export-adapter.mjs
  assets/
```

开发环境从 `<appRoot>/component-packs` 发现；DMG 从 `process.resourcesPath/component-packs` 发现。`electron-builder.extraResources` 已包含该目录。

## 3. Manifest v1

```json
{
  "version": 1,
  "id": "example-pack",
  "label": "示例组件包",
  "source": {
    "kind": "pack",
    "root": "components"
  },
  "surface": {
    "kind": "mobile",
    "viewport": { "width": 375, "height": 812 },
    "autoHeight": true,
    "layout": { "direction": "vertical", "padding": 16, "gap": 24 }
  },
  "skill": {
    "name": "example-component-design",
    "tools": {
      "extractFacts": "example-component-design.extract-facts",
      "resolveContract": "example-component-design.resolve-contract"
    }
  },
  "components": [
    {
      "name": "ExampleCard",
      "label": "示例卡片",
      "file": "ExampleCard.json",
      "kind": "design",
      "aliases": ["示例卡片"]
    }
  ]
}
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `version` | 当前固定为 `1` |
| `id` | 必须等于目录名，只允许小写字母、数字和连字符 |
| `source.kind` | `pack` 或 `component-registry` |
| `source.root` | `pack` 模式下相对 Pack 根目录，禁止路径越界 |
| `surface` | 可选页面画布契约；声明 viewport、自动高度和 vertical/horizontal/grid 组合策略 |
| `skill.name` | 必须对应已打包 Skill |
| `skill.tools.resolveContract` | 必填，由组件流程动态调用 |
| `components[].kind` | `design` 可单独设计；`structural` 只能进入页面组合流程 |
| `aliases` | 最多 16 个，每个最多 64 字符 |
| `exportAdapter` | 可选 `.mjs` 路径；由 Electron 主进程执行 |

所有 Pack 的组件名、文件名、文件名 stem 和 aliases 必须全局唯一，否则 Registry 启动失败，防止自然语言选择器产生歧义。

## 4. Source 模式

### `pack`

组件 JSON 与 Pack 一起维护。Loader 只读取 Manifest 已登记的具体文件，不遍历组件目录。新增业务 Pack 应使用此模式。

### `component-registry`

仅用于迁移当前 `componentsJson`。组件仍由 Manifest 显式登记，Loader 不执行全目录扫描。内置 `campaign-components` 使用该模式兼容 EraLottery、EraTasklist、EvaLayoutContainer 和 EvaPage。

迁移完成后可将 JSON 移入 Pack 的 `components/`，把 `source.kind` 改为 `pack`，Agent 核心无需修改。

## 5. 运行流程

```text
自然语言 / 结构化 @组件引用
  -> Pi Workflow Tool 选择组件工作流
  -> Component Pack Registry 匹配 Manifest
  -> 激活 pack.skill.name
  -> 读取 Manifest 指定的单个组件 JSON
  -> 调用 pack.skill.tools.resolveContract
  -> 确定性组件 Plan / Slot 生图 / Props Patch
  -> ComponentDesignMeta.packId
  -> DesignDocument / 导出 Manifest
```

页面组合流程允许加载 `structural` 组件；单组件流程会返回 `COMPONENT_STRUCTURAL_ONLY`。普通设计请求不会调用 Pack Registry 的组件读取接口。

## 6. 安全与可靠性

1. Pack、组件源和 Export Adapter 路径必须位于声明根目录内。
2. 设计组件必须提供可信 HTTPS thumbnail；只允许 bilibili/hdslb 域及其子域。
3. thumbnail 最大 8MB，下载超时 15 秒，重定向后再次校验域名。
4. JSON 内的 `name` 必须与 Manifest 一致。
5. 未登记或损坏的 JSON 不会被扫描和加载。
6. 重名选择器直接拒绝整个 Registry，不进行不确定匹配。
7. Skill Tool 由 Manifest 声明，Agent Tool 不保存业务 Tool 名称。

## 7. 接入步骤

1. 创建 `component-packs/<id>/manifest.json`。
2. 将组件 JSON 放入 Pack 并使用 `source.kind=pack`。
3. 创建对应中文 `SKILL.md` 和 Runtime Tool。
4. 在 Manifest 声明 `resolveContract`，可选声明 `extractFacts`。
5. 为可独立设计组件提供 thumbnail；容器/Page Root 标记为 `structural`。
6. 运行专项测试和全量回归。

无需修改 `intent-router.mjs`、`agent-planner.mjs` 或 `agent-tools.mjs` 中的业务名称分支。

## 8. Export Adapter

Renderer 先通过 `buildComponentExportPackage` 生成标准 ZIP，再通过 `runtime:adaptComponentExport` 将以下输入交给 Adapter：

```js
export function adaptComponentExport(input) {
  // input: { version, componentName, profile, standardPackage: Uint8Array }
  return input.standardPackage
}
```

执行约束：

1. Adapter 必须导出 `adaptComponentExport`。
2. 输入和输出 ZIP 最大 64MB。
3. 输出必须具有合法 ZIP 文件头。
4. 异步执行最多等待 10 秒。
5. Adapter 失败时 Renderer 记录告警并下载标准组件包，保证导出可用。
6. IPC 不传入 DesignDocument、文件系统路径或 API Key。

Adapter 是随应用审核和打包的可信 Node 模块，不是第三方代码安全沙箱。不能从聊天、项目文件或网络动态安装并执行 Adapter；需要支持第三方 Pack 时，必须再引入独立受限进程或真正的 Sandbox。

## 9. 当前状态

Manifest Loader、组件发现、Skill 激活、结构类型限制、组件来源追踪、Export Adapter IPC 和 DMG 打包已经实现。标准与自定义组件开发包均保留 `componentPackId` 来源。

## 10. 验证

```bash
npm run test:component-packs
npm run test:component-design
npm run test:page-agent
npm run test:all
```

`test:component-packs` 覆盖内置发现、Manifest Tool、结构组件限制、原生 Pack、无目录扫描、Skill 自动激活、路径越界、重名冲突和 Export Adapter 输出校验。
