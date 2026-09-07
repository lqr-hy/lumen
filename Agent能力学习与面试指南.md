# Agent 能力学习与面试指南

## 1. 先建立一个正确认识

Agent 不是“会聊天的大模型”，也不是简单把 Prompt 发给模型。一个可用于生产的 Agent，通常由以下部分组成：

```text
模型（Reasoning）
  + 上下文（Context）
  + 工具（Tools）
  + 任务状态（State）
  + 规划/执行循环（Loop）
  + 记忆与持久化（Memory）
  + 权限与安全（Guardrail）
  + 观测、评估与恢复（Evaluation & Recovery）
```

项目经理面试时，不需要把自己包装成算法工程师，但必须能回答三件事：Agent 如何完成任务、为什么会失败、产品如何控制失败成本。

## 2. Agent 与普通 Chatbot 的区别

| 对比项 | 普通 Chatbot | Agent |
| --- | --- | --- |
| 目标 | 生成一段回复 | 完成一个目标 |
| 输出 | 文本 | 文本、工具调用、文件、画布变更等可验证结果 |
| 状态 | 通常只保留聊天历史 | 有 Goal、Plan、Step、Observation、Artifact、Run 状态 |
| 行动 | 不能或很少产生副作用 | 可调用工具、读写系统、修改业务对象 |
| 失败处理 | 返回错误或重新提问 | 重试、回滚、恢复、人工确认 |
| 验收 | 看文字是否合理 | 检查副作用是否真实发生并满足后置条件 |

本项目的关键设计是：**模型负责理解和选择高层动作，应用负责确定性执行和验收。**

## 3. Agent 的完整工作流程

### 3.1 用户输入

用户可以输入文字、上传参考图、引用 `@组件`、选择画布元素或提出局部修改。例如：

> 根据这张 KV 和原型图生成一个移动端活动页，使用 EraLottery 组件，并把按钮文案改成“立即抽奖”。

输入层需要完成：文本解析、附件角色识别、组件引用解析、当前项目和画布读取、选区识别。

### 3.2 上下文组装

RuntimeContext 通常包括：

- Session ID、Project ID、当前 Run 状态。
- 当前画板尺寸、选择范围和 EditScope。
- CanvasSnapshot：节点数量、组件实例、Page Shell 状态。
- 参考图名称、角色和 MIME，不把大段 Base64 直接塞进 Prompt。
- 已激活 Skill、最近对话和相关历史摘要。

上下文不是越多越好。项目通过 Token 估算、旧 Turn 摘要和大型 Tool Result 截断来控制窗口，避免模型被无关历史淹没。

### 3.3 意图判断

Agent 先判断用户是在：

1. 普通咨询。
2. 补充信息或上传参考图。
3. 创建新任务。
4. 继续、重试已有任务。
5. 修改页面、组件或某个选区。
6. 等待用户确认 Blueprint。

例如“怎么优化这个页面”是咨询，“优化一下这个页面”是执行。只有执行类意图才允许调用写工具。

### 3.4 规划 Plan

Plan 是任务的步骤清单，不是模型的隐藏思考过程。以页面设计为例：

```text
reference.prepare
→ page.resolve-components
→ page.blueprint
→ page.generate-shell
→ page.generate-component（每个组件独立）
→ page.review
→ page.repair（必要时）
→ canvas.present-page
```

Plan 要说明每一步的目标、工具、依赖、输入、输出、超时和验收条件。

### 3.5 工具调用

工具是 Agent 连接真实系统的边界。项目中 Pi Agent 只暴露受控高层工具：

- `skill_activate`：激活合适的设计 Skill。
- `skill_read_resource`：渐进读取 Skill 资源。
- `studio_run_design_workflow`：启动或恢复设计工作流。

领域工作流内部再调用白名单工具，如 `reference.prepare`、`design.generate`、`artifact.validate` 和 `canvas.present`。

### 3.6 观察 Observation

工具执行后不能只返回“完成”，而要返回结构化 Observation，例如：

```json
{
  "status": "success",
  "artifactId": "artifact_123",
  "targetId": "section-lottery",
  "warnings": [],
  "postcondition": {
    "canvasAck": true,
    "elementCount": 18
  }
}
```

Observation 会影响下一步是否可执行，也是失败恢复和审计的依据。

### 3.7 画布交付与后置条件

生成结果先成为 Artifact，再通过 Canvas Transaction 写入 Renderer。Renderer 返回 ACK，验证目标画板、root、instance、Section 和节点数量。ACK 成功后，Step 才能标记为 completed。

这解决了一个常见问题：模型或后端返回了成功文本，但前端实际没有写入画布。

### 3.8 评审与修复

质量评审检查结构、主题、可读性、完整性、可编辑覆盖率和开发可用性。修复要遵循最小影响原则：页面问题修 Page Shell，组件问题修 Section，素材问题修 Slot，Runtime 问题修结构或 Props。

### 3.9 完成、失败与恢复

Run 可能进入 completed、failed、cancelled、waiting-confirmation 或 interrupted。应用重启后，running 不被伪装成仍在执行；用户输入“继续”时，系统从最后有效 Checkpoint 恢复。

## 4. Agent 的核心概念词典

### Model / Provider

Model 是具体推理或生图模型，Provider 是连接模型服务的适配层。本项目将推理模型和图片模型分开路由，API Key 只在 Electron 主进程使用。

### Agent

负责理解目标、读取上下文、选择工具并根据工具结果继续推进的运行单元。

### Tool

Agent 可以调用的受控能力。好的 Tool 应有清晰输入输出、权限边界、超时、错误码和幂等策略。

### Plan / Step

Plan 是任务计划，Step 是可执行步骤。Step 应尽量小到可以独立重试、检查点保存和验收。

### Observation

工具执行后的结构化观察结果，不等同于模型自然语言总结。

### Artifact

Agent 产生的可持久化制品，如 SVG、PNG、DesignDocument、代码包、资源清单和评审报告。

### Memory

包括短期上下文、会话历史、项目状态、领域 Checkpoint 和长期知识。不同记忆应分开存储，不能把所有内容都塞进 Prompt。

### ReAct

Reason + Act 的循环：模型选择动作，系统执行工具，返回观察，再决定下一步。本项目保留“模型选择高层工作流 + 领域确定性执行”的混合方式，避免让模型直接控制所有底层步骤。

### RAG

Retrieval-Augmented Generation，先检索知识再生成答案。当前项目的 Skill Catalog、组件 JSON、参考图和 Runtime Context 都可以看作受控上下文来源，但不能把 RAG 与 Agent 等同。

### Guardrail

输入校验、工具白名单、权限限制、输出 Schema、预算、超时和敏感信息脱敏等安全控制。

### Human-in-the-loop

在高风险或不可逆操作前让用户确认。本项目在 Blueprint 确认、预算超限和无法自动修复时保留人工介入点。

## 5. 本项目的 Agent 架构怎么讲

```text
React Renderer
  ↓ Electron IPC
RuntimeContextAssembler
  ↓
Pi Agent（文本回复 / Skill / 高层设计工具）
  ↓
DesignWorkflowEngine
  ↓
Workflow Graph + Tool Registry
  ↓
Artifact Repository / DesignDocument / Canvas ACK
  ↓
Quality Gate / Codegen / Export
```

架构分层的理由：

- Pi 负责通用 Agent 能力，不直接依赖 DesignDocument。
- Studio Runtime 作为防腐层，未来可以替换模型或 Agent 框架。
- Workflow Graph 负责业务流程确定性。
- Renderer 只接受结构化 Deliverable，不接受模型随意执行前端代码。
- Artifact、Session 和 Checkpoint 支持审计、恢复和重复执行保护。

## 6. 可靠性与安全的面试重点

### 幂等

使用 `runId + toolCallId + targetId` 形成幂等键，重复调用时返回已有 Observation，避免重复插入组件。

### 重试

区分 Provider 瞬时失败、工具业务失败和参数不可重试错误；限制工具级重试次数，避免多层重试放大成本。

### 超时与取消

AbortController 从 Renderer 传到 IPC、Tool、Provider 和子进程；取消状态不触发自动重试。

### 上下文控制

通过 Token 估算、旧消息摘要、大结果截断和最近 Turn 保留，减少成本和上下文污染。

### 权限

不向 Agent 开放 Bash、任意文件、任意 URL 或密钥读取工具；Skill 只能访问声明范围内的资源。

### 质量评估

不只评估文本质量，还评估实际副作用、结构合法性、画布状态、可编辑覆盖率和代码导出结果。

## 7. Agent 项目指标体系

### 业务指标

- 需求到首稿平均时长。
- AI 生成稿被继续编辑和导出的比例。
- 活动页从设计到开发的整体周期。
- 使用团队、项目数和组件复用数量。

### Agent 运行指标

- Tool Call 成功率。
- Run 完成率、取消率、恢复成功率。
- 平均步骤数、平均耗时和 Token 消耗。
- Provider 错误率、重试率和超时率。

### 结果质量指标

- 结构通过率和主题一致性得分。
- 可编辑覆盖率。
- Canvas ACK 成功率。
- 重复节点率、导出代码验收通过率。
- 用户人工修改次数和修复后通过率。

## 8. 模拟面试题与参考答案

### Q1：什么是 Agent？

Agent 是以目标为中心，能够理解上下文、规划步骤、调用工具、读取结果并持续推进任务的系统。大模型只是其中的推理组件，真正的 Agent 还需要状态管理、工具执行、权限控制、记忆、评估和恢复机制。

### Q2：Agent 和 Workflow 有什么区别？

Workflow 是预先定义好的确定性流程，Agent 可以在不确定环境下根据目标和观察选择下一步。生产系统通常采用混合模式：让 Agent 负责高层决策，让 Workflow 负责关键业务步骤、权限和验收。本项目就是这种模式。

### Q3：为什么不能让模型直接修改数据库或画布？

因为模型输出可能不完整、重复或越权。项目通过 Tool Registry、Schema 校验、Canvas Transaction 和 ACK 把副作用放到应用控制范围内，模型只能提出受限动作，不能直接操作底层状态。

### Q4：一个 Agent 任务应该如何拆 Step？

按照独立目标、独立输入输出、独立失败边界和独立验收条件拆分。页面生成中，参考图准备、页面规划、Page Shell 和每个业务组件都可以成为独立 Step，这样支持并行准备、顺序写入和局部恢复。

### Q5：ReAct 有什么问题？

ReAct 灵活，但可能循环过长、工具选择错误、成本不可控和状态难恢复。因此需要最大循环次数、工具白名单、超时、重试预算、结构化 Observation 和 Checkpoint。对关键业务不能把所有控制权交给模型。

### Q6：如何判断工具设计得好不好？

看输入是否明确、输出是否结构化、是否可观测、是否幂等、是否有权限边界和超时策略，以及失败后能否重试或恢复。一个只返回自然语言“执行成功”的工具，不适合生产 Agent。

### Q7：如何减少 Agent 幻觉？

不能只依赖更长 Prompt。应减少模型需要猜测的内容，提供真实 Runtime Context；用结构化 Schema、工具白名单、后置条件校验和真实观察结果约束输出；涉及高风险写操作时要求确认。

### Q8：如何做 Agent 评估？

离线评估看意图识别准确率、工具选择准确率、参数合法率和任务完成率；在线评估看完成率、成本、延迟、重试率、人工接管率和用户满意度；结果型任务还要检查副作用是否真实发生，而不是只看文本相似度。

### Q9：如何处理上下文过长？

先分离持久化事实和本轮推理上下文，再做摘要、截断和按需检索。项目不会把图片 Base64、完整 Artifact 和重复 System Prompt 注入模型，而是传递引用、摘要和当前目标相关的结构信息。

### Q10：Agent 为什么需要 Memory？

因为多轮任务需要记住目标、参考图、已完成步骤和错误状态。Memory 不等于聊天记录：Session 保存任务状态，Artifact 保存制品，Checkpoint 保存可恢复结果，短期上下文服务当前推理。

### Q11：多 Agent 是否一定比单 Agent 好？

不一定。多 Agent 会增加通信、状态同步和调度复杂度。只有当任务天然分工、可以并行且收益大于协调成本时才采用。本项目对页面组件做领域级独立 Step，而不是盲目拆成多个互相聊天的 Agent。

### Q12：如何控制 Agent 成本？

限制上下文长度、最大步骤、工具尝试、推理次数和生图次数；对稳定流程使用确定性 Workflow，减少重复推理；缓存未变化的 Step；区分高质量模型和低成本模型；失败时保留已完成结果，避免整条链重跑。

### Q13：如何设计 Agent 的安全边界？

最小权限原则：只暴露业务必需工具，限制参数和资源范围，密钥不进入模型上下文，所有写操作可审计、可取消、可恢复。对于任意代码执行、文件删除、外部网络和批量修改，要么禁止，要么增加独立授权和人工确认。

### Q14：如果 Agent 说成功但实际没成功，你怎么解决？

引入后置条件。以画布为例，必须收到 Renderer ACK，并核验目标画板、实例 ID 和元素数量；以文件为例，必须检查 Artifact 是否真实存在、格式是否正确、引用是否完整。没有后置条件通过，就不能将任务标记为成功。

### Q15：这个项目中最体现 Agent 能力的地方是什么？

不是聊天，而是从自然语言目标开始，结合画布、参考图和组件上下文选择高层工作流，再通过工具、Observation、Checkpoint、ACK 和质量门禁形成闭环。它把不确定的模型推理包在了确定的产品执行系统里。

### Q16：如果模型不可用，产品怎么办？

普通咨询可以提示 Provider 不可用；执行任务则保留 Goal、Plan、References 和已完成 Artifact，标记明确错误并支持之后继续。可以使用规则降级或 Fixture 验证非模型链路，但必须清楚标注降级状态，不能伪装成真实生成成功。

### Q17：Agent 项目最容易被忽略的工作是什么？

通常是失败路径、数据持久化、指标、权限和人工接管。演示成功不代表生产可用，项目经理需要提前设计超时、取消、重复调用、重启恢复、上下文过长和用户不确认等情况。

### Q18：你对 Agent 下一步的判断是什么？

下一步重点不是无限增加 Agent 自主性，而是提升可控性和业务闭环：真实工具接入、可靠评估、成本治理、权限和审计、领域知识沉淀，以及在明确边界内让 Agent 自动完成更多步骤。

## 9. 建议学习路线

### 第一阶段：基础概念

掌握 LLM、Prompt、Tool Calling、Function Calling、Token、上下文窗口、Embedding、RAG、结构化输出和流式响应。

### 第二阶段：Agent 工程

理解 State、Plan、Step、Observation、ReAct、Workflow Graph、Memory、Checkpoint、幂等、重试、超时、取消和 Human-in-the-loop。

### 第三阶段：生产可靠性

学习权限控制、Prompt Injection、敏感信息脱敏、成本预算、Trace、日志、离线评估、在线指标、回放和故障恢复。

### 第四阶段：结合本项目复盘

按“输入—上下文—意图—规划—工具—观察—交付—验收—恢复”的顺序，能够不用看代码讲清每个阶段的输入、输出、失败方式和项目价值。

## 10. 面试前最后检查清单

- 能否用 30 秒说清项目不是普通 Chatbot？
- 能否区分模型、Agent、Tool、Workflow 和 Runtime？
- 能否讲清一次页面生成的完整链路？
- 能否举出一个失败、重试和恢复案例？
- 能否解释为什么需要 Canvas ACK 和后置条件？
- 能否说出至少 5 个 Agent 运行指标？
- 能否说明项目当前已实现和未实现的边界？
- 能否把技术设计翻译成用户价值、交付效率和风险控制？

## 11. 一分钟总结话术

我理解的 Agent，不是让模型自由发挥，而是让模型在明确目标和受控上下文中选择合适动作，再由工具和工作流完成真实执行。这个项目的 Agent 链路包括输入解析、上下文组装、意图判断、计划生成、工具调用、Observation、画布 ACK、质量评审和 Checkpoint 恢复。项目经理的价值在于把这条链路拆成可排期、可协作、可验收的模块，并用权限、预算、超时、重试和指标把 Agent 从 Demo 推进到可交付产品。
