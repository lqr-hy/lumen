# Agent 工程化运行时实施方案

> 通用 Agent Loop 与模型 Provider 正在迁移到 Pi，领域检查点和 Artifact Repository 保留。
> 最终架构及版本约束见 [`pi-runtime-refactor.md`](pi-runtime-refactor.md)。

## 1. 目标与边界

将当前设计工作流升级为可持久化、可恢复、可取消、可审计的 Agent Runtime。Pi Agent 只选择高层设计工作流，领域任务由确定性依赖图执行 Ready Step；真实图片能力通过可插拔 Provider 接入，不使用语言模型生成 SVG 冒充图片模型。

本阶段交付：

1. 项目、DesignDocument 和聊天线程持久化。
2. Agent Step 输出检查点和失败 Step 恢复。
3. Run 取消、超时传播和 Codex 子进程终止。
4. Artifact 文件仓库与原子写入。
5. 对应 IPC、类型、自动保存和回归测试。

Vision Review 接口、Electron Sandbox 和浏览器 E2E 已实现；真实位图 Provider、业务组件 Bundle、线上实例写回和任意图片像素分层仍需要外部能力。

## 2. 存储布局

```text
<userData>/projects/<projectHash>/
  project.json
  versions/<versionId>.json

<userData>/content-assets/<hashPrefix>/<sha256>

<userData>/artifacts/<artifactHash>/
  metadata.json
  content.svg | content.json | content.txt

<userData>/agent-sessions/
  <sessionHash>.json

<userData>/agent-checkpoints/<sessionHash>/<runId>/
  <stepId>.json

<userData>/agent-assets/<hashPrefix>/<sha256>
```

`project.json` 保存 `schemaVersion`、项目 ID、DesignDocument、聊天线程和活动线程。图片 Data URI 按 SHA-256 外置，JSON 只保存引用。所有 JSON 使用临时文件加 `rename` 原子替换；损坏文件会备份并回退到最近版本。

## 3. 项目快照

```ts
interface ProjectSnapshot {
  schemaVersion: 2
  projectId: string
  document: DesignDocument
  chatThreads: EditorChatThread[]
  activeChatThreadId: string
  createdAt: string
  updatedAt: string
}
```

Renderer 在文档或聊天变化后 800ms 自动保存。进入 `/editor/:projectId` 时先从 Electron 加载；不存在时以路由 ID 创建空白项目。项目切换必须整体替换 Store，不能复用上一个项目的聊天和选择状态。

## 4. Agent Run 与检查点

Session 增加 `runId`。新目标创建新 Run；“继续/重试”保留当前 Run。每个完成 Step 将完整 `AgentToolResult` 写入检查点，再标记为 completed。

恢复流程：

```text
load session
  -> load completed step checkpoints
  -> 缺失输出的 Step 及下游改为 pending
  -> failed/running Step 改为 pending
  -> 从第一个 pending Step 继续
```

现已保存 `inputHash = hash(tool + input + dependency output hashes)` 和 `outputHash`。输入、模型、目标、EditScope、参考图或依赖输出变化时，从对应 Step 精确失效。

## 5. 取消与超时

每个活动 Session 对应一个 `AbortController`。`runtime:cancelAgent` 按 Session ID 取消：

```text
Renderer -> IPC -> AbortController.abort()
  -> Tool signal
  -> Provider fetch abort
  -> Codex SIGTERM
  -> 3 秒未退出则 SIGKILL
  -> Step/Session = cancelled
```

单 Step 超时使用子 AbortController，不得只 reject Promise 后留下后台进程。普通工具和单个页面组件 Step 默认超时 5 分钟，可通过 `AGENT_TOOL_TIMEOUT_MS` 配置。页面组件不再聚合为一个长 Step，每个组件独立检查点、独立重试和独立失败状态。取消不是失败，不触发自动重试。

## 6. Planner 与 Workflow Graph

保留以下依赖图模板：

- `design-image`
- `asset-set`
- `component-design`
- `component-slot-edit`
- `page-design`

Pi Agent 负责自然语言路由和调用高层 `studio_run_design_workflow`。进入领域执行器后，Workflow Graph
从固定依赖图计算 Ready Step 并确定性执行。Tool 仍来自 Registry，不允许模型生成任意领域工具名、
覆盖计划输入或直接修改 DesignDocument。失败恢复由工具级重试、Observation 和 Checkpoint 负责。

`page-design` 在解析组件后动态插入 `page.generate-component` Step。Runtime Memory 同时按
`toolName` 和 `stepId` 保存结果，使同名组件工具不会覆盖其他实例；页面组件 Step 具有独立
检查点，最终由 `page.blueprint/page.generate-shell/page.review/canvas.present-page` 汇总。

每个成功的 `page.generate-component` 会先发送带 ACK 的 Renderer Deliverable。Renderer 按 Blueprint bounds 写入组件，并验证 root、instance、pageSectionId、目标画板和元素数量；确认结果保存为 Canvas Observation 后才执行下一 Step。Repair 使用相同 pageSectionId 原位替换，最终页面汇总也复用这些实例，避免重复节点。Renderer 未响应时超时并将当前 Step 标记为可恢复失败。

`page.generate-shell` 同样先增量写入 Renderer，Repair 和最终交付都复用 page-shell elementId。Renderer 在请求开始发送最多 80 个节点的 CanvasSnapshot，ACK 后返回本次写入节点摘要；Runtime 合并快照供 Pi RuntimeContext 和后续领域步骤使用。快照禁止包含图片 Data URI 和完整 Artifact 内容。

页面视觉主题由 `page.extract-theme` 在确认 Blueprint 后一次性提取。该 Step 只消费 KV/视觉参考，
不生成页面或组件；结果写入 Session `pageVisualTheme`，供 Page Shell 和所有组件子任务复用。

“添加到画布/画板”不得匹配“新增画板”。只有当前会话存在同名 `componentDesign` 时，Runtime
才从 Step 检查点恢复 `canvas.present-component`；新会话或名称不匹配时必须创建新的
`component-design` Run，禁止读取旧页面/旧对话节点。“只生成 EraLottery”这类省略“组件”二字的
明确组件名称指令同样进入组件 Run。只有“新增/新建/创建一个画板”等明确命令才能创建 375px 画板。

页面 Vision Review 默认启用，在全部页面节点收到 Renderer ACK 后只执行一次。Renderer 使用导出级隐藏画板
生成 PNG Snapshot；截图或远程评审失败时降级为本地确定性质量门禁，不阻断页面首次交付。调用方仍可显式传入
`enableVisionReview: false` 关闭远程评审。

设计修订属于执行意图，不属于普通聊天。已有 Goal、组件 Session 或选中组件实例时，`完善、优化、重做、重新实现、按建议修改` 创建新 Run；`怎么优化、先给方案、分析一下` 保持聊天模式。选中组件实例的整体修订结果使用 `instanceId` 原位替换，选中单个图片 Slot 时继续使用四步局部 Recipe。

## 7. Artifact 与图片 Provider

Artifact 仓库接口：

```ts
writeArtifact({ projectId, runId, kind, name, content }): ArtifactMeta
readArtifact(artifactId): ArtifactRecord
```

真实图片能力使用独立接口：

```ts
interface ImageProvider {
  generate(input: ImageGenerationInput, signal: AbortSignal): Promise<ImageArtifact>
  edit?(input: ImageEditInput, signal: AbortSignal): Promise<ImageArtifact>
}
```

未配置真实 Provider 时公开状态必须显示不支持，不得降级声称生成了真实位图。Codex SVG 继续作为结构稿、按钮和简单素材 Provider。

## 8. 验收标准

1. 应用重启后恢复画布、图层、聊天线程和目标画板。
2. 第 N 步失败后重试，不重新执行已有检查点的前 N-1 步。
3. 检查点丢失时从第一个缺失输出的 Step 重新执行。
4. 取消后 Session 状态为 cancelled，Codex 子进程退出。
5. 同一 Session 不允许并发 Run。
6. 项目、Session 和 Artifact 均不保存 API Key。
7. Repository、恢复、取消、现有 Agent/组件测试、Lint 和生产构建全部通过。

## 9. 后续阶段

1. Blueprint 组件替换、普通 Section 插入和自由布局。
2. 真实 Image/Edit/Animation Provider 与 OCR 数据集标定。
3. 注册业务组件 Bundle 并执行 Sandbox 回归。
4. 页面 Text/Shape Agent EditScope 和线上实例写回。
5. Electron 主进程 E2E、真实 Codex 冒烟和视觉回归矩阵。
