# 可靠 AI 设计生成架构

> 状态：已实施  
> 基线：2026-08-10

> 边界说明：确定性组件计划、节点级生图、fallback、自动目标画板和统一 Canvas Deliverable/ACK 已实施；
> 持久化 Mutation Ledger、跨存储事务恢复及 Generation/Delivery Hash 分离仍按
> [`agent-canvas-transaction-architecture.md`](agent-canvas-transaction-architecture.md) 的 P4 继续实施。

## 1. 问题

旧组件流程要求推理模型一次性返回完整 Component Blueprint。模型输出中的版本、坐标、尺寸或
Slot 映射只要有一个字段不符合严格协议，组件还没有进入生图阶段就会失败。相同请求随后被整体
重试，已经完成的内部结果不能复用，结构化 JSON 和校验错误还会通过聊天流暴露给用户。

用户真正需要的是设计稿和可编辑配置，不是 Blueprint、工具名和协议诊断。因此新流程遵循：

1. 模型负责视觉意图，不负责组件事实结构。
2. 组件 JSON、Profile、Props 和 Slot 是唯一结构事实源。
3. 每个图片任务独立执行、独立重试、独立保存。
4. 任一模型失败不能伪装为完成；只有 Canvas ACK 可以确认交付。
5. 聊天只展示用户阶段，完整诊断保留在 Runtime 日志和 Session Observation。

## 2. 目标架构

```text
Prompt / KV / Thumbnail / Component JSON
  -> ReferenceResolver
  -> ComponentContract
  -> DesignIntent (模型可选，仅包含视觉主题)
  -> DeterministicComponentPlanBuilder
  -> ArtifactTaskGraph
       -> visual-shell
       -> prop-slot-1
       -> prop-slot-n
  -> Artifact Validation / Local Fallback
  -> Component Renderer / Preview Composer
  -> Props Patch
  -> Canvas Deliverable
  -> Renderer ACK
```

### 2.1 DesignIntent

DesignIntent 只允许包含色板、材质、字体倾向、装饰语言和参考图来源。模型不得决定 Component 名称、
Profile、Props 路径、Slot ID、version、Region 绑定、画布节点或 Canvas 写入结果。

当没有 KV，或视觉意图模型不可用时，Runtime 从组件颜色属性和任务文字建立默认主题，流程继续。

### 2.2 Deterministic Component Plan

Runtime 根据组件契约生成 `ComponentBlueprint` 兼容结构，供现有编辑器、导出器和预览合成器消费：

- 固定 `version=1`、逻辑宽度优先 375。
- 从 Profile 的宽高、位置、显隐和颜色属性生成 Property Values。
- 每个 `generationPolicy=generate` Slot 必须且只能生成一个 Region。
- 优先使用 Props 中的宽高位置；缺失时使用角色布局规则。
- 自动添加 Runtime Region，承载奖品、任务列表等动态业务区域。
- 所有自动补全记录 Diagnostic，但不阻断生图。

## 3. Artifact Task Graph

组件视觉外壳和每个 Props 图片 Slot 是独立节点：

```text
pending -> running -> succeeded
                   -> fallback
                   -> failed
```

图片 Provider 的网络错误只重试当前节点。重试仍失败时生成本地 SVG fallback，保证组件仍可合成并写入
画布；fallback 在诊断中标记，用户可通过局部重生成替换。页面中的组件继续作为更高层独立节点，
因此单组件失败不会重跑 Page Shell 或其他组件。

## 4. 终态协议

```text
understanding -> preparing -> generating -> composing -> delivering
  -> completed | partial | failed | cancelled | interrupted
```

- `failed/cancelled/interrupted` 不能被后续 Pi `agent_end` 覆盖为 completed。
- Tool 抛错必须传播到 Renderer，不允许 Pi 在错误后用自然语言声明完成。
- 页面和组件的最终回复只引用真实 Deliverable 和 Observation。
- 最终 completed 必须建立在成功 Canvas ACK 上。

## 5. 聊天 UI

默认只显示“理解设计需求、生成设计内容、添加到画布”三个用户阶段。不在聊天正文展示 Blueprint JSON、
Props JSON、协议字段、工具名、重试堆栈和 Provider 原文。失败时显示可行动的中文摘要；完整错误码、
原始 Observation 和结构化结果只进入开发者诊断。

## 6. 开源方案借鉴

- OpenUI：生成后立即预览，并基于结果继续修改。
- Onlook：组件事实结构、画布对象映射、Checkpoint 和局部编辑。
- ComfyUI：节点任务图、局部重跑、部分结果和异步队列。
- Penpot：组件、Design Token 和开放结构作为事实源。

本项目不引入它们的完整 Runtime，只吸收执行模型；Pi 继续负责自然语言和高层工具选择。

## 7. 实施清单

- [x] Pi Agent 与领域工作流保持隔离。
- [x] Canvas Deliverable 和 ACK 已存在。
- [x] 图片、素材、组件、Slot、Page Shell 和页面终态统一经过 Renderer ACK。
- [x] Pi 决策后自动创建或复用 375×812 自适应目标画板。
- [x] 内部结构化任务不再流入聊天正文。
- [x] 组件结构改为确定性 Plan Builder。
- [x] 已校准 thumbnail 布局通过数据 Sidecar 进入 Plan Builder，状态素材默认显隐不破坏基础 UI。
- [x] Component Blueprint 模型生成入口删除。
- [x] 图片 Slot 节点级重试和本地 fallback。
- [x] 失败终态不可被 Pi 完成事件覆盖。
- [x] 聊天时间线改为用户阶段。
- [x] 组件、页面、导出、Agent 和构建回归通过。

## 8. 验收标准

1. 生产流程不再请求模型生成完整 Component Blueprint。
2. KV 色板进入 Visual Shell、Props 颜色和独立素材提示。
3. 单个 Slot 生图失败时仍生成可见组件设计稿，并可局部重生成。
4. 组件结果包含 Preview、Visual Shell、独立素材、Props Patch 和质量报告。
5. 页面使用相同组件流水线，并增量写入同一目标画板。
6. 聊天中不出现内部 JSON 和字段校验原文。
7. 任务只有收到画布成功 ACK 后才显示完成。

## 9. Raster 生图可靠性升级

2026-08-13 已完成以下适配：

- Provider 请求合并全局设计约束与单素材 Prompt，避免 VisualTheme、组件名和参考图职责在传输层丢失。
- `ImageTask.referencePolicy` 按任务筛选参考图：组件外壳可读取 KV、视觉图和 thumbnail；独立 Slot 默认只读取 KV/视觉图；局部重生成读取当前素材、KV 和视觉图；页面背景不读取组件 thumbnail。
- 未标注图片不再因“单图设计请求”自动提升为视觉来源。只有文件名、`@` 附近上下文或用户明确使用 KV、主视觉、风格参考、原型图等语义时才赋予角色；其余保持 `unknown`，避免把结构原型配色误当主题。
- 图片任务先按 `edit-base > kv > visual > prototype` 排序并筛选实际附件，再从最终附件重建 Manifest。Prompt 中的“图片 N”始终与 Provider 收到的附件顺序一致。
- PNG 结果进入像素分析和确定性目标尺寸归一化，分别保留 `source` 原始分析与 `normalized` 归一化分析，记录目标比例误差、内容比例误差、Alpha 覆盖、白底覆盖、边缘接触率、内容包围盒、色彩复杂度和主导色。
- 透明独立素材使用内容包围盒等比 `contain`，居中放入透明目标画布；页面背景使用 `cover`。透明素材不再为了匹配目标尺寸而拉伸变形。
- Raster 主题评分使用真实主导色，不再固定返回通过或 0.8 分。
- Raster 门禁先检查 Provider 原始制品，再检查归一化结果；原始比例偏差记录警告，归一化画幅比例错误、原始或归一化大面积白底会阻断交付。
- Raster 像素分析检测多尺度、双方向周期性灰白棋盘格。命中时标记 `IMAGE_FAKE_TRANSPARENCY`：当前素材使用纠正 Prompt 单节点重生一次，仍失败则使用本地 fallback；最终门禁继续阻止伪透明制品进入画布。
- 独立素材将真实 Alpha 作为请求和交付契约：图片接口同时发送 `output_format=png`、`background=transparent`，Prompt 明确要求主体外像素 `alpha=0`。门禁检查模型原图而非只看归一化结果；原图透明像素不足、白底或棋盘格都会触发当前节点纠正重生，避免后处理增加透明边距后误判为成功。
- Raster 按钮底图先通过原始像素门禁，再由 Runtime 包装为 SVG 并叠加准确文字，避免 SVG 包装绕过 Raster 校验，也避免生图模型生成错误文案。
- 页面视觉外壳收敛为无文字、无组件主体的整页背景底图；组件和业务内容由画布原生图层覆盖。
- 页面 Vision Review 在 Page Shell 和全部组件收到 Renderer ACK 后请求目标画板快照；Renderer 使用与导出相同的隐藏画板渲染器生成 PNG，不受当前缩放、选中框和可视区域影响。
- Vision Provider 只接收 KV、视觉/原型参考和最终 PNG 快照，不再接收 SVG。PNG 握手缺失、超时、失败或超过体积限制时评审标记为 `degraded`，继续使用本地确定性门禁交付页面。
- 生图后处理并发收敛为 `1`；PNG 解码、像素分析和缩放已迁移到一次任务一个 Worker Thread，主进程只负责调度和接收结果。
- Raster Worker 使用二进制 Transfer List 避免大图跨线程重复拷贝，支持请求取消和 20 秒处理超时；Worker 启动或崩溃时使用同步算法降级，取消和处理超时直接终止，不会重新阻塞主进程。
- Worker 入口位于 `electron/runtime`，由 Electron Builder 的 `electron/**/*` 规则随应用一起打包，不依赖外部脚本目录或本地开发环境。
- Artifact Repository 的原子写入临时文件使用 UUID；同一内容以原图和包装图并发外置时不会发生临时文件重名。

新增验证：`npm run test:raster-analysis` 与扩展后的 `npm run test:image-provider`。

### 9.1 当前边界与下一步

- JPEG/WebP 保留为用户参考图输入格式。生图请求固定要求 PNG；Provider 若违约返回 JPEG/WebP，Runtime 以 `IMAGE_OUTPUT_FORMAT_INVALID` 拒绝交付，不能绕过 PNG 像素门禁。
- 不为违约输出引入 `sharp` 等 Electron 原生解码依赖，避免增加 DMG 多架构打包风险；未来只有在产品明确支持 JPEG/WebP 生图输出时再引入统一解码器。

## 10. 持久化画布 Mutation Ledger

2026-08-13 已完成 P4 第一阶段：

- Deliverable ID 从时间戳改为 `runId + stepId` 的稳定哈希，同一 Run 恢复后重放相同步骤仍使用同一幂等键。
- 成功画布 Mutation 记录 `deliveryId`、Run、Step、类型、画板、Renderer Observation 和提交时间，最多保留最近 500 条。
- Mutation Ledger 与 DesignDocument、ChatThread 一起进入 Project Repository 和项目版本快照，应用重启后重新 hydrate 到 Store。
- Renderer 收到重复 Delivery 时直接返回已持久化 Observation，不再次创建节点。
- 成功 ACK 前强制保存最新 DesignDocument 和 Ledger；保存失败返回 `CANVAS_MUTATION_PERSIST_FAILED`，并回滚本次内存 Document Mutation 与 Ledger，Runtime 不会错误完成 Step，也不会在重试时累积半提交节点。
- 老项目没有 Ledger 时自动迁移为空数组，不影响加载。
- 同一项目的事务保存与 800ms 自动保存由 Project Repository 串行化；原子临时文件使用 UUID，避免并发保存的临时文件冲突。

当前仍未完成：Generation Hash 与 Delivery Hash 完整分离、文档 revision 冲突检测、Agent Session 与 Project Repository 的启动 Reconciler。
