# 聊天 Agent 执行过程 UI

> 状态：P0-P4 核心能力已完成  
> 更新日期：2026-08-10

## 1. 目标

聊天消息正文与 Agent 执行过程分离。普通问答继续使用流式文本；页面、组件、素材和局部修订任务通过
可折叠时间线展示计划、步骤、重试、错误、等待确认和画布交付。界面不展示模型隐藏思维链，只展示
可验证的动作和结果。

## 2. 数据模型

- `EditorChatMessage.text` 只保存自然语言回复。
- `EditorChatMessage.runId` 关联 `EditorChatThread.runs`。
- `ChatRun` 保存状态、当前步骤、计划步骤、交付目标、时间和错误。
- 工作区持久化 ChatRun；应用重启时未完成 Run 标记为 `interrupted`，用户可输入“继续”使用领域检查点恢复。

```text
understanding -> planning -> running -> delivering -> completed
                              |              |
                              +-> waiting-confirmation
                              +-> failed / cancelled / interrupted
```

## 3. 事件协议

Electron 在 Renderer 边界为 Agent 事件补充 `version: 1`、`runId`、单调递增 `sequence` 和
`timestamp`。前端 reducer 消费 `pi.agent.*`、`plan.updated`、`step.*`、
`observation.created`、`task.*` 和画布 Deliverable ACK。重复或乱序事件按 sequence 丢弃。

## 4. UI 行为

- 运行中默认展开当前步骤，显示耗时和完成数量。
- 完成后自动折叠，用户可以重新展开查看历史。
- 普通聊天没有工具步骤时，完成后不显示空时间线。
- Retry 显示次数和最近错误。
- Deliverable 显示组件或 Page Shell，点击后定位画板或根节点。
- 等待 Blueprint 确认时保留时间线和确认卡片。
- 停止、失败和重启中断使用独立终态，不伪装为成功回复。

## 5. 代码边界

| 模块 | 职责 |
| --- | --- |
| `src/features/ai/agent-run.ts` | ChatRun 类型、纯 reducer、事件顺序和交付归并 |
| `src/features/ai/agent-chat-run-controller.ts` | 两个聊天入口共享 Token、事件、完成和失败处理 |
| `AgentRunTimeline.tsx` | 折叠时间线、步骤、重试、错误和画布定位 |
| `electron/main.mjs` | IPC 事件版本、runId、sequence 和 timestamp |
| `editor-store.ts` | Run 持久化及重启中断归一化 |

## 6. 验证

```bash
npm run test:chat-run
npm run test:pi-runtime
npm run test:all
```

专项测试覆盖计划与步骤、乱序事件、Retry、画布交付目标和完成状态。
## 7. 执行过程可观测性

聊天中的执行卡片展开后展示领域工作流的真实步骤，不再只显示“理解、生成、画布”三个聚合状态。每一步包含可读标题、实际 Tool 名称、Observation 摘要、重试次数、耗时；失败时额外显示错误码和原始错误。顶部仍保留面向用户的任务状态摘要。

错误展示采用“简短分类 + 原始诊断”两层结构。原始 Blueprint、Provider、画布交付错误不得被泛化文案完全覆盖，以便确定失败发生在哪一个 Tool。
