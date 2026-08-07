# 技术文档索引

本目录按 Runtime 基础设施、Agent 执行和组件设计领域能力拆分，避免在多份文档中重复维护同一协议。

| 文档 | 职责 |
| --- | --- |
| [`capability-status.md`](capability-status.md) | 当前已实现、部分实现、未实现能力及对应验证入口，作为项目进度唯一索引 |
| [`ai-design-generation.md`](ai-design-generation.md) | AI 设计稿 Blueprint、质量审查、自动修正、生成元数据与导出闭环 |
| [`../agent.md`](../agent.md) | Agent Session、Planner、Loop、Tool、事件和 Artifact 总体架构 |
| [`runtime-context.md`](runtime-context.md) | 本地环境变量、Provider Registry、Electron IPC 与安全边界 |
| [`runtime-skills.md`](runtime-skills.md) | Skill 发现、选择、Session 保留、Job 暂存、Runtime Tool 和 DMG 打包 |
| [`component-design-capability.md`](component-design-capability.md) | 组件 JSON 设计契约、Profile、继承、Blueprint、素材 Slot 和 Props Patch |
| [`page-composition-capability.md`](page-composition-capability.md) | KV、原型图、页面视觉外壳与多个组件实例的完整页面组合方案 |
| [`design-to-development-pipeline.md`](design-to-development-pipeline.md) | KV 到页面设计、质量闭环、Runtime 验证和开发交付的总方案与实施路线 |
| [`agent-engineering-runtime.md`](agent-engineering-runtime.md) | 项目持久化、Artifact 仓库、检查点恢复和取消传播 |
| [`natural-language-conversation-agent.md`](natural-language-conversation-agent.md) | 模型主导的自然语言决策、上下文摘要、Schema、fallback 与画布后置条件 |

## 阅读顺序

1. 先阅读 `capability-status.md`，确认能力是否已经实现，再进入对应领域文档。
2. 阅读 `runtime-context.md`，理解浏览器 Renderer 为什么不能直接读取本地密钥。
3. 再阅读 `../agent.md`，理解一次对话如何变成可恢复的工具循环。
4. 实现设计稿生成时阅读 `ai-design-generation.md`。
5. 扩展 Skill 时阅读 `runtime-skills.md`。
6. 实现组件原型和独立素材生成时阅读 `component-design-capability.md` 及 `.agents/skills/component-design-assets/SKILL.md`。
7. 实现项目持久化、Agent 检查点、取消和生产可靠性时阅读 `agent-engineering-runtime.md`。
8. 设计由多个组件组合的完整页面时阅读 `page-composition-capability.md`。
9. 扩展自然语言意图、实体引用和动态 Tool Loop 时阅读 `natural-language-conversation-agent.md`。

## 状态约定

- “已实现”表示代码已接入正式 Runtime 链路并完成验证。
- “已注册”表示能力可被 Registry 发现和直接调用，但 Planner 未必会自动生成对应 Step。
- “规划中”表示仅有接口或技术方案，不能作为当前产品能力承诺。
