# 技术文档索引

本目录按 Runtime 基础设施、Agent 执行和组件设计领域能力拆分，避免在多份文档中重复维护同一协议。

| 文档 | 职责 |
| --- | --- |
| [`capability-status.md`](capability-status.md) | 当前已实现、部分实现、未实现能力及对应验证入口，作为项目进度唯一索引 |
| [`multi-framework-codegen-runtime-components.md`](multi-framework-codegen-runtime-components.md) | 基于 Canonical Scene Graph 的 HTML/CSS、React、Vue 编译层，以及 Runtime Component 黑盒引用和 Props 导出方案 |
| [`unified-render-ir.md`](unified-render-ir.md) | 用 Render IR 收敛画布、快照、版本对比与代码导出的样式真源，消除代码产物与画布视觉不一致 |
| [`agent-canvas-transaction-architecture.md`](agent-canvas-transaction-architecture.md) | 聊天到 Pi 决策、自动目标画板、设计事务、统一 Deliverable/ACK、恢复和迁移的总重构方案 |
| [`reliable-ai-design-generation.md`](reliable-ai-design-generation.md) | DesignIntent、确定性组件计划、节点级生图、终态和用户级执行 UI |
| [`ai-design-generation.md`](ai-design-generation.md) | AI 设计稿 Blueprint、质量审查、自动修正、生成元数据与导出闭环 |
| [`../agent.md`](../agent.md) | Agent Session、Planner、Loop、Tool、事件和 Artifact 总体架构 |
| [`runtime-context.md`](runtime-context.md) | 本地环境变量、Provider Registry、Electron IPC 与安全边界 |
| [`runtime-skills.md`](runtime-skills.md) | Skill 发现、Catalog、激活、渐进资源读取、Runtime Tool 和 DMG 打包 |
| [`component-design-capability.md`](component-design-capability.md) | 组件 JSON 设计契约、Profile、继承、Blueprint、素材 Slot 和 Props Patch |
| [`universal-component-design-tree.md`](universal-component-design-tree.md) | 不依赖组件源码的通用组件设计树、Thumbnail 节点识别、Theme/Color Binding 和 visual-only 节点 |
| [`scene-graph-adapter-architecture.md`](scene-graph-adapter-architecture.md) | 将组件专用流水线迁移为通用 Scene Graph、Source Adapter 和可选 Component Plugin 的目标架构 |
| [`page-composition-capability.md`](page-composition-capability.md) | KV、原型图、页面视觉外壳与多个组件实例的完整页面组合方案 |
| [`design-to-development-pipeline.md`](design-to-development-pipeline.md) | KV 到页面设计、质量闭环、Runtime 验证和开发交付的总方案与实施路线 |
| [`agent-engineering-runtime.md`](agent-engineering-runtime.md) | 项目持久化、Artifact 仓库、检查点恢复和取消传播 |
| [`natural-language-conversation-agent.md`](natural-language-conversation-agent.md) | Pi 原生会话、RuntimeContext、高层 Tool 与确定性 Workflow Graph |
| [`design-eval-and-repair.md`](design-eval-and-repair.md) | 页面/组件统一质量评分、可编辑覆盖率与局部 Repair |
| [`chat-agent-run-ui.md`](chat-agent-run-ui.md) | 聊天执行时间线、Run 状态机、事件协议与恢复 |
| [`ai-chat-canvas-interaction.md`](ai-chat-canvas-interaction.md) | Lexical 多图引用、结构化 Draft、画布自动决策与空响应恢复 |
| [`pi-runtime-refactor.md`](pi-runtime-refactor.md) | Pi 生态选型、混合 Agent 架构、版本约束、迁移阶段与验收标准 |
| [`generic-ui-design-workflow.md`](generic-ui-design-workflow.md) | 通用后台、Dashboard、移动端 UI 的 Schema、原生节点编译与 ACK 交付 |
| [`design-patch-capability.md`](design-patch-capability.md) | 通用节点自然语言局部修改、受限 DesignPatch、图片替换和 revision 原子事务 |
| [`selection-scoped-ai-editing.md`](selection-scoped-ai-editing.md) | 单节点、多节点、文本 Range、图片 Mask 与组件 Slot 的统一 AI 局部编辑边界 |
| [`design-spec-patch-capability.md`](design-spec-patch-capability.md) | 通用 UI Block 的自然语言插入、删除、更新、移动及原子结构事务 |
| [`component-pack-architecture.md`](component-pack-architecture.md) | 可选业务组件 Pack、Manifest Loader、Skill Tool 绑定、结构组件边界和 DMG 打包 |
| [`user-skill-and-style-pack.md`](user-skill-and-style-pack.md) | 用户 Skill、声明式 Style Pack、安装目录、安全边界和设计运行时传播 |
| [`visual-direction-divergence.md`](visual-direction-divergence.md) | 设计语言包、分轴 Direction/Range 发散意图，以及并行多版选优路线 |

## 阅读顺序

1. 先阅读 `capability-status.md`，确认能力是否已经实现，再进入对应领域文档。
2. 阅读 `agent-canvas-transaction-architecture.md`，理解当前交互问题和下一阶段唯一主链。
3. 阅读 `runtime-context.md`，理解浏览器 Renderer 为什么不能直接读取本地密钥。
4. 再阅读 `../agent.md`，理解一次对话如何变成可恢复的工具循环。
5. 实现设计稿生成时阅读 `ai-design-generation.md`。
6. 扩展 Skill 时阅读 `runtime-skills.md`。
7. 实现组件原型和独立素材生成时阅读 `component-design-capability.md` 及 `.agents/skills/component-design-assets/SKILL.md`。
8. 实现项目持久化、Agent 检查点、取消和生产可靠性时阅读 `agent-engineering-runtime.md`。
9. 设计由多个组件组合的完整页面时阅读 `page-composition-capability.md`。
10. 扩展自然语言意图、Skill Tool 或设计工作流时阅读 `natural-language-conversation-agent.md`。
11. 维护模型 Provider、Agent Loop 和 Session Runtime 时阅读 `pi-runtime-refactor.md`。
12. 调整聊天执行过程、步骤状态和恢复展示时阅读 `chat-agent-run-ui.md`。
13. 调整输入框、附件引用和画布目标选择时阅读 `ai-chat-canvas-interaction.md`。
14. 调整通用设计、普通生图、Design Catalog 或 Component Pack 边界时阅读 `universal-ai-design-architecture.md`。
15. 实现通用节点局部修改和并发冲突处理时阅读 `design-patch-capability.md`。
16. 实现通用 UI Block 结构修改时阅读 `design-spec-patch-capability.md`。
16. 新增或迁移业务组件包时阅读 `component-pack-architecture.md`。
17. 组件 `@` 引用、续跑保护与外部 JSON 导入阅读 `component-mention-and-import.md`。
18. 用户安装 Skill、导入设计风格和扩展安全边界阅读 `user-skill-and-style-pack.md`。
19. 设计通用组件节点树、Thumbnail 视觉识别和颜色驱动组件时阅读 `universal-component-design-tree.md`。
20. 重构组件专用流程、Runtime DOM 导入和统一 Scene Graph 时阅读 `scene-graph-adapter-architecture.md`。
21. 处理画布与导出代码视觉不一致、修改元素渲染样式或代码编译器时阅读 `unified-render-ir.md`。
22. 调整视觉优化 Brief、设计语言包或发散幅度时阅读 `visual-direction-divergence.md`。

## 状态约定

- “已实现”表示代码已接入正式 Runtime 链路并完成验证。
- “已注册”表示能力可被 Registry 发现和直接调用，但 Planner 未必会自动生成对应 Step。
- “规划中”表示仅有接口或技术方案，不能作为当前产品能力承诺。
