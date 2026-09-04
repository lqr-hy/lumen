# 通用 AI 设计工具架构

> 状态：开放 DesignSpec Runtime 已实施
> 基线日期：2026-08-19

## 1. 产品边界

产品默认是通用 AI 设计工具。用户通过自然语言、参考图和画布上下文生成可编辑设计稿，随后可以继续局部修改、生成位图素材并导出结果。

`componentsJson`、业务 Props 和运行时组件不是通用设计的前置条件。它们只在用户明确指定组件 JSON、组件名称或要求导出业务 Props 时，以可选 Component Pack 形式启用。

## 2. 架构原则

1. `DesignDocument` 是画布唯一事实源。
2. PI 负责会话、Tool Call 和自然语言决策，领域 Workflow 负责确定性执行。
3. 普通生图使用 Runtime 本地 `GenerationBrief`，不得依赖模型生成 Blueprint。
4. 通用 UI 只能使用开放 Block Registry 声明的节点和属性。
5. 模型决定信息层级和视觉意图，编译器决定坐标、节点 ID、默认间距和画布写入。
6. 规划结果只允许 `valid / repaired / invalid`；`invalid` 经过一次结构修复后仍无节点必须阻断交付。
7. 核心代码不得硬编码 EraLottery 等业务组件名称。

## 3. 任务分流

```text
自然语言 + ReferenceDigest + CanvasSnapshot
  -> Pi 原生 Tool Decision
     -> design-image      整张图片、KV、海报、背景
     -> generic-design    后台、Web、H5、App、普通页面
     -> design-patch      选中通用节点后的局部修改
     -> component-pack    明确指定组件 JSON / Props
     -> page-component    明确指定多个业务组件组合页面
```

通用“页面”不再自动等于业务组件页面。只有输入包含明确组件选择器时，才允许进入 `create-component` 或 `create-page`。

## 4. 普通图片流程

```text
reference.prepare
  -> design.brief
  -> design.generate
  -> artifact.review
  -> design.refine
  -> artifact.validate
  -> canvas.present
```

`design.brief` 是纯 Runtime Tool，不请求推理模型。它根据用户目标、参考图角色、画布尺寸和放置模式生成：

```ts
interface GenerationBrief {
  version: 1
  goal: string
  outputKind: 'full-image' | 'section' | 'asset'
  target: {
    width: number
    height: number
    placementMode: string
  }
  references: Array<{
    id: string
    name: string
    role: 'kv' | 'prototype' | 'visual' | 'edit-base' | 'unknown'
    responsibility: 'visual-theme' | 'structure' | 'edit-base' | 'visual-reference'
  }>
  constraints: string[]
}
```

GenerationBrief 只描述生成契约，不构造自由页面节点。普通生图即使没有参考图，也必须能立即进入图片 Provider。

## 5. 通用 DesignSpec

通用设计参考 json-render 的 Catalog / Spec 模式。第一阶段沿用现有 Generic UI 数据并升级命名为 `DesignSpec`：

```ts
interface DesignSpec {
  version: 1
  surfaceKind: 'desktop-admin' | 'desktop-web' | 'mobile'
  title: string
  viewport: { width: number; height: number }
  theme: DesignTheme
  blocks: DesignBlock[]
}
```

当前 Registry：

```text
container / stack / grid / hero / text / image / button-group
sidebar / header / tabs / stats / filter-bar / data-table / form
content-grid / chart / tree / detail-panel / timeline / kanban / calendar / map
modal / drawer / toast / pagination / footer
```

每个 Registry 项声明内容字段和分类；扩展通过 `registerDesignBlockDefinitions` 注册。基础布局节点支持 children、方向、列数、间距、内边距和高度。

## 6. 通用设计流程

```text
reference.prepare
  -> design.spec
  -> design.spec.validate
  -> canvas.present-design
  -> Canvas ACK
```

`design.spec` 请求推理模型补充信息架构和文案。缺少字段时由 Runtime 标准化；无有效 Block 时进行一次结构修复，仍失败则终止，禁止生成无关模板。

参考图职责：

- KV：颜色、字体气质、材质和装饰语言。
- Prototype：区域顺序和结构。
- Visual：局部风格。
- Edit Base：需要保持其余部分不变的当前对象。

## 7. Component Pack

业务组件作为可选包加载，正式协议见 `component-pack-architecture.md`：

```text
component-packs/<pack>/
  manifest.json
  components/
    ExampleComponent.json
  export-adapter.mjs
  assets/
```

核心 Runtime 只理解统一 Manifest：

```ts
interface ComponentPackManifest {
  version: 1
  id: string
  label?: string
  source: {
    kind: 'pack' | 'component-registry'
    root?: string
  }
  skill: {
    name: string
    tools: {
      extractFacts?: string
      resolveContract: string
    }
  }
  components: Array<{
    name: string
    label?: string
    file: string
    kind: 'design' | 'structural'
    aliases?: string[]
  }>
  exportAdapter?: string
}
```

当前 `.agents/skills/component-design-assets` 和 `componentsJson` 视为内置兼容 Pack。它们不得在普通设计请求中自动扫描或激活。

## 8. 失败与恢复

不同失败必须分开处理：

| 失败类型 | 行为 |
| --- | --- |
| Provider 网络错误 | 原请求有限重试 |
| Spec 缺少字段 | Runtime 本地补全 |
| Catalog 节点非法 | 丢弃或映射到兼容节点 |
| Spec 无可用节点 | 结构修复一次，仍失败则明确终止 |
| 图片质量失败 | 携带质量问题重新生成一次 |
| Canvas ACK 失败 | 终止并保留 Artifact/Checkpoint |
| 缺少明确组件 | 仅组件请求阻断，普通设计不受影响 |

工具重试不能重复发送完全相同的结构错误请求。Schema Repair 与网络 Retry 必须分别记录。

## 9. 可观测性

每个 Step 展示：

- Tool 名称和可读标题。
- 输入摘要和参考图选择结果。
- 输出摘要、Spec 状态和节点数量。
- `valid / repaired / fallback`。
- 重试次数、耗时、错误码和原始错误。
- Canvas 写入目标和 ACK。

应用同时展示 Renderer 与 Electron Runtime Build ID；版本不一致时禁止启动设计任务，避免旧主进程继续执行已经删除的协议。

## 10. 模块边界

| 模块 | 职责 |
| --- | --- |
| Pi Workflow Tool | 唯一在线高层意图、Surface、输出种类、参考图职责和 Placement 决策源 |
| `intent-router.mjs` | 仅离线降级路由 |
| `generation-brief.mjs` | 本地构造普通图片生成契约 |
| `design-block-registry.mjs` | 开放 Block 能力注册 |
| `design-catalog.mjs` | DesignSpec 标准化、修复状态和校验 |
| `agent-planner.mjs` | 按任务类型建立确定性 Workflow |
| `agent-tools.mjs` | 执行领域 Tool，不混入 UI 状态 |
| `design-spec-compiler.ts` | 将 DesignSpec 编译为 DesignDocument 原生节点 |
| `component-pack` | 可选业务组件契约、Props Patch 和导出 |

## 11. 迁移阶段

### P0 稳定性

- Runtime Build ID 握手。
- 普通生图移除 `design.blueprint`。
- 通用页面默认进入 generic-design。

### P1 通用 Spec

- GenericUiSchema 升级为 DesignSpec。
- Catalog 成为模型和编译器共享约束。
- Spec 无效时归一化或 fallback。

### P2 局部设计

- [已实现] 新增受限 `DesignPatch` 和 `generic-node EditScope`。
- [已实现] 支持通用节点新增、修改、删除、移动和图片替换。
- [已实现] 增加 document revision 冲突检查与 Renderer 原子提交。
- [后续] 冲突自动重基和超大画布跨截断节点修改。

### P3 Component Pack

- [已实现] Manifest Loader、原生 Pack 和 `componentsJson` 显式索引兼容。
- [已实现] 组件发现、Skill 激活、Contract Tool 和 `design / structural` 类型由 Manifest 声明。
- [已实现] 核心移除业务组件名、固定 Skill Tool 和 `componentsJson` 全目录扫描。
- [已实现] 组件设计与导出 Manifest 保存 `packId` 来源。
- [已实现] 通过受限 Electron IPC 执行可信 Pack `exportAdapter`，校验输入输出大小、ZIP 格式和异步超时，失败时回退标准组件包。

### P4 渐进交付

- [已实现] `ui.validate` 按 DesignSpec Block 动态生成 Section 交付 Step。
- [已实现] Renderer 使用完整 DesignSpec 计算布局，以稳定编译 ID 对当前 Block 执行节点 Patch 并逐 Section ACK。
- [已实现] 单个 Section 失败标记 partial、从后续 Spec 排除并继续执行，不回滚其他成功 Section。
- [已实现] `generic-ui-finalize` 校验最终 Block 顺序、根节点、节点数和文档 Revision。
- [已实现] Design Root、背景、Block Root 和子节点稳定 ID；旧 Block 不因后续 Section 交付而重建。
- [已实现] 插入、删除、重排 Block 时自动 Patch 受影响的后继布局，并引入响应式约束和稳定语义 Item Key。
- [已实现] 带 DesignSpec 的画板 Resize/Reposition 自动 Reflow，稳定生成节点 ID 并保留普通手工节点。
- [已实现] Agent 受限 DesignSpec Patch Tool；支持 Block 插入、删除、更新、移动及 Runtime/Renderer 双重 Revision 校验。
- [已实现] 默认 mobile/tablet/desktop breakpoint、窄屏响应式 Reflow 和工具栏多尺寸预览。
- [已实现] DesignSpecPatch 三方安全自动重基；触碰目标 Block、ID 或锚点的并发修改仍拒绝。
- [已实现] 自定义断点编辑、同屏只读并排预览和节点级结构冲突解决 UI。
- [已实现] 断点级主题/布局 Override、跨断点差异提示和可持久化视觉树 fingerprint 基线。
- [已实现] 跨断点批量 Token、稳定 Block 差异定位、Playwright Chrome/Electron 375/768/1440 六图像素基线。
- [后续] Windows/Linux 像素基线、失败 Diff 图归档、PR 评论和基线审核工作流。

## 12. 验收标准

1. 普通图片计划不包含 `design.blueprint`，规划耗时接近零。
2. 未指定组件时不读取 `componentsJson`。
3. 后台、普通 Web/H5 页面进入通用 DesignSpec 工作流。
4. Spec 缺字段时自动修复或 fallback，不中断任务。
5. 新增业务组件不修改 Agent 核心代码。
6. 通用设计可编辑节点覆盖率不低于 95%。
7. 每次失败都能定位到 Tool、错误码、修复和 Canvas ACK。
