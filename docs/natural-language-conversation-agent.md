# Pi 原生会话与设计工作流技术方案

## 1. 目标

应用只保留一条生产调用链：

```text
Renderer
  -> Electron IPC
  -> RuntimeContextAssembler
  -> Pi Agent
     -> 普通文本回复
     -> skill_activate / skill_read_resource
     -> studio_run_design_workflow
  -> Design Workflow Graph
  -> Tool Registry
  -> Artifact / DesignDocument / Canvas ACK
```

Pi Agent 负责理解自然语言和选择高层工具；领域工作流负责可靠执行。应用不再维护 Conversation
Decision JSON、NextAction JSON、模型驱动 ReAct Loop、正则意图降级或 CLI 文件协议。

## 2. Pi Agent 职责

Pi Agent 接收 RuntimeContext、Skill Catalog 和 Pi Messages，并执行以下决策：

- 普通咨询直接回复。
- 任务匹配 Skill 时调用 `skill_activate`。
- 需要 Skill 附件时调用 `skill_read_resource`。
- 用户要求实际生成或修改时调用 `studio_run_design_workflow`。
- 目标不明确时直接追问，不调用写工具。

模型不能直接构造 DesignDocument、Props Patch、Artifact 或 Canvas ACK，也不能声明未发生的画布写入。

## 3. RuntimeContext

`electron/runtime/pi/context-runtime.mjs` 统一提供：

- Session ID、Project ID、任务状态和组件目标。
- 当前画板 ID、尺寸和放置模式。
- CanvasSnapshot：节点数、组件数、Page Shell 状态、选择和截断状态。
- EditScope：组件实例、Slot、元素和页面外壳。
- 引用图名称、角色和 MIME，不在 System Prompt 中放 Base64。
- 已选 Skill 名称。最近对话只保留在 Pi Messages，不在 RuntimeContext 中重复注入。

RuntimeContext 是 Pi 会话决策的唯一项目上下文入口。

## 3.1 上下文预算与压缩

`electron/runtime/pi/context-policy.mjs` 通过 Pi Agent 的 `transformContext` 接入
`estimateContextTokens`、`shouldCompact` 和 `generateSummary`：

- System Prompt 不重复写入当前用户消息或最近历史。
- 达到模型窗口减去 24000 Token 预留量时压缩旧 Turn。
- 默认保留最近约 20000 Token 的完整 Turn。
- 摘要保留设计目标、DesignSpec/组件、画板、选择、引用职责、交付和错误。
- 大型 Tool Result 在进入模型前截断，摘要失败时退化为确定性裁剪。

压缩只影响本次模型上下文，不修改 DesignDocument、领域 Session 或聊天 UI 中的原始记录。

## 4. 高层工具契约

Pi Agent 只暴露三个工具：

```text
skill_activate
skill_read_resource
studio_run_design_workflow
```

`studio_run_design_workflow` 接受受限 action：

```text
continue
create-artboard
create-page
create-component
create-assets
create-image
revise-page
revise-page-shell
revise-component
regenerate-slot
```

Tool Call 被转换为 `workflowDecision`，包含 action、taskKind、组件目标和来源。领域执行器不再请求
模型补充 Decision，也不会切换到旧 Runtime。

## 5. 确定性 Workflow Graph

`runDesignWorkflow()` 根据 action 创建或恢复领域 Run。`workflow-graph.mjs` 只计算依赖图中可执行的
Ready Step，执行器按图选择第一个就绪步骤。页面中的独立组件 Step 可以处于同一 Ready 集合，但
写入仍采用顺序 ACK，保证画布状态一致。

领域执行器保留：

- Page、Component、Asset、Slot 和 Page Shell Plan。
- Blueprint 确认和继续恢复。
- Tool Registry 白名单。
- Step Checkpoint 和 Artifact 外置存储。
- 工具超时、最多两次工具级重试和取消信号。
- Observation、失败状态和 Repair 失效传播。
- 页面组件和 Page Shell 增量 Deliverable。
- Renderer Canvas ACK 与后置条件校验。

它不再保留：

- Conversation Agent。
- `decide_agent_action`。
- `decide_agent_next_action`。
- Inspect Tool 插队。
- 模型控制循环次数和失败恢复。
- 首个 Ready Step 的“模型失败 fallback”概念。

## 6. 页面与组件交付

页面组件生成完成后立即发送 `page-component` Deliverable。Renderer 按 Blueprint bounds 写入实例，
返回 artboardId、rootElementId、instanceId、pageSectionId 和节点计数。Page Shell 使用相同 ACK 协议。

只有 ACK 成功后 Step 才完成。最终页面汇总复用增量写入的实例；Repair 使用相同 pageSectionId 或
elementId 原位替换，不能产生重复组件或重复 Page Shell。

## 7. Session 与恢复

Pi SQLite 镜像保存模型消息和 Tool Call/Result；领域 Session 保存 Goal、Plan、Observation、
CanvasSnapshot、Checkpoint 和 Artifact 引用。应用重启后 `running` 统一转为 interrupted/failed，
用户调用 `continue` 后从最后有效 Checkpoint 恢复，不声称后台仍在运行。

## 8. 错误与安全

- Provider 失败返回结构化错误，不调用旧 Runtime。
- Tool 参数必须通过 TypeBox 和应用白名单校验。
- Skill 只能读取自身 `references/` 和文本型 `assets/`。
- 不向 Pi Agent 注册 Bash、任意文件、任意 URL 或凭证读取工具。
- Key 不进入 Renderer、RuntimeContext、Session 和日志。
- Props Patch 只允许设计契约中的图片、颜色、尺寸、位置和显隐字段。

## 9. 验收标准

1. 普通咨询不进入领域工作流。
2. 生成或修改请求必须产生 Pi Tool Call。
3. 每个领域 Step 由 Workflow Graph 确定，不发生二次模型 Decision 请求。
4. 页面和组件只有 Canvas ACK 成功后才能回复完成。
5. 工具瞬时失败在工具层重试，最终失败可通过 `continue` 从 Checkpoint 恢复。
6. 生产代码中不存在 Conversation Agent、NextAction 或 Legacy Runtime 引用。

专项测试：

```bash
npm run test:pi-runtime
npm run test:agent-upgrades
npm run test:agent-reliability
npm run test:page-agent
```
