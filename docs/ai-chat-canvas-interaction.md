# AI 聊天输入与画布自动决策技术方案

> 状态：结构化输入与 Pi 后决策 Target Handshake 已完成；完整聊天 Controller 待收敛  
> 更新日期：2026-08-10

## 1. 目标

用户只描述需求，应用自动判断这是普通咨询还是设计写入任务，并自动选择当前节点、线程画板、激活
画板或新建 375px 标准移动端画板。输入框支持多图片附件和内联 `@` 精确引用，不再依赖手写
`contentEditable`、文件名匹配或发送前的五段放置模式选择。

## 2. 输入数据模型

`ComposerDraft` 将文本、附件、Mention 和画布引用分开保存：

```text
ComposerDraft
  text                 纯文本及 Mention 的可读文本
  editorState          Lexical 可恢复状态
  attachments[]        图片本体与稳定 ID
  mentions[]           type、resourceId、label、start、end
  textReferences[]     画布文字/节点引用
  placementOverride    可选高级覆盖，不在主界面常驻
```

一张图片由附件 Chip 管理预览、删除和排序；句子中的 `@图1` 是不可拆分的 Lexical
`PromptMentionNode`。两者通过稳定 `resourceId` 关联，重命名和排序不会破坏关系。

多图请求规则：

1. 没有图片 Mention 时，全部附件作为全局参考。
2. 存在图片 Mention 时，优先按 Mention 出现顺序提交对应图片。
3. 删除附件时同步删除指向该 `resourceId` 的 Mention。
4. 请求失败后恢复发送前的文本、附件、Mention 和文本引用。

## 3. 输入框实现

采用 `Lexical + PromptMentionNode + 附件 Chips`：

- Lexical 管理 Selection、中文 IME、撤销重做、复制粘贴和节点序列化。
- React 不再向 `innerHTML` 回写内容，不再手工保存 DOM Range。
- `@` 菜单统一承载图片、组件 JSON、画板和画布节点；当前版本已接入图片，其他类型使用同一协议扩展。
- Enter 发送，Shift+Enter 换行；运行时保留停止入口。
- `PromptComposer` 对外仍输出可读文本，同时输出结构化 `mentions` 和 `editorState`。

## 4. Pi 后决策 Canvas Target Handshake

常驻的“自动 / 新页面 / 当前画板 / 新变体 / 素材”控件已删除。Renderer 提交消息时不再用正则提前
判断 `chat/design`，也不会预创建画板。Pi 或同层离线 fallback 选择高层设计工具后，Runtime 发出
`CanvasTargetRequest`，Renderer 再执行确定性目标解析并返回 ACK：

```text
Pi Tool Call
  -> placement(operation, scope, targetArtboardId)
  -> CanvasTargetRequest(operationId, placement, baseDocumentRevision)
  -> Renderer 校验目标属于当前文档
  -> create 时新建/复用完全空白初始画板
  -> CanvasTargetResolution ACK
  -> 领域 Workflow 执行
```

普通聊天没有 Tool Call，因此不会触发目标请求。重试和继续只能使用有效的上一任务 Lease；显式
`create-artboard` 强制新建。创建出的移动端标准画板宽 375、高 812，
并保持 `autoHeight=true`，后续由实际内容扩展高度。

典型行为：

| 输入 | 行为 |
| --- | --- |
| “分析一下这个页面有什么问题” | 普通咨询，不创建画板 |
| “生成一个抽奖页面” | 新建 375px 页面画板 |
| 选中按钮后说“改成黄色” | 当前节点所在画板原位修改 |
| “继续往下增加任务区” | Agent 选择明确目标画板后追加；目标不明确则询问 |
| “再做一个版本” | 复制当前画板为 Variant |
| “单独生成抽一次按钮素材” | 素材画板 |

## 5. Agent 与画布边界

Renderer 只负责编辑上下文、目标解析和真实画布写入；Pi Agent 负责自然语言与高层工具选择；确定性
Design Workflow 负责页面、组件、素材和局部修订。目标在 Pi 决策后通过 Handshake 获得，不再要求
聊天组件预判。所有设计类型统一使用 Deliverable ACK 验证写入结果。

页面任务保持增量交付：组件和 Page Shell 完成后立即写入，单组件失败不撤销已成功区域。选中节点通过
`EditScope` 进入 RuntimeContext。Selection 是 Agent 的高优先级观察信息，但 Runtime 不再维护线程默认
画板回退。

## 6. 失败与重试

Codex HTTP 200 空 Body 被归类为 `gateway-empty-response`：

- 最多重试两次，指数退避并加入 jitter。
- 重试保持 Session ID，每次生成新的 `x-client-request-id`。
- 最终失败显示简洁中文错误，不显示底层 502 JSON。
- 输入框恢复发送前 Draft，用户可直接重新发送。
- 不伪造完成事件，Run 保持 failed 状态。

## 7. 代码边界

| 模块 | 职责 |
| --- | --- |
| `src/features/ai/composer-draft.ts` | Draft、附件和 Mention 协议 |
| `src/components/ui/PromptComposer.tsx` | Lexical、附件 Chips、@ 菜单和序列化 |
| `workflow-canvas-target.ts` | Pi 决策后的目标创建、复用和 Target ACK |
| `design-turn-canvas-bridge.ts` | 两个聊天入口共享的目标握手、Deliverable 应用和 Canvas ACK |
| `ChatPanel.tsx`、`AiCanvasChat.tsx` | Draft、线程和 Runtime 接入；待继续抽取统一 Controller |
| `agent-chat-run-controller.ts` | Run 更新和用户可读错误 |
| `electron/runtime/pi/model-runtime.mjs` | Pi Provider 空响应有限重试 |

## 8. 当前状态与后续

已完成：

- Lexical 替换裸 `contentEditable`。
- 图片附件 Chips 与稳定 ID Mention。
- Mention 驱动的多图选择。
- 常驻放置模式删除。
- 普通聊天不预创建画板，Pi Tool Call 后才解析目标。
- 无目标时自动创建 375×812 自适应画板。
- 选中节点、线程、Runtime 推荐目标和激活画板自动解析。
- 重试复用目标，显式新增只创建一个画板。
- 图片、素材、组件、Slot 和页面统一经过 Renderer ACK。
- 空响应有限重试和失败 Draft 恢复。

下一阶段：

- 将组件 JSON、画板和节点加入统一 `@` 菜单数据源。
- 低置信度目标确认卡。
- 抽取完整 `DesignChatController`，统一 Draft、线程、请求和恢复。
- 持久化 Mutation Ledger，并处理运行期间用户编辑冲突。
- 运行期间消息排队和单 Run 取消。
- Variant/Checkpoint 的显式 UI 和按 Run 回滚。
- Electron 真实输入法、多图片拖拽和线程切换 E2E。

## 9. 验证

```bash
npm run test:canvas-target
npm run test:chat-run
npm run lint
npm run build
```
