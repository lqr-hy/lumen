# Agent 基础 Demo

这些 Demo 不依赖真实模型，用确定性函数模拟模型决策，适合复习 Agent 的工程流程。

## 运行

在项目根目录执行：

```bash
node demos/agent-basics/01-react-loop.mjs
node demos/agent-basics/02-checkpoint-recovery.mjs
node demos/agent-basics/03-guardrail-ack.mjs
```

## Demo 对照面试概念

| Demo | 对应概念 | 面试表达 |
| --- | --- | --- |
| `01-react-loop` | ReAct、Tool、Observation | 模型选择动作，应用执行工具，再把结构化结果交给下一轮 |
| `02-checkpoint-recovery` | Step、Checkpoint、Retry、Continue | 失败后只恢复首个未完成步骤，不整条链路重跑 |
| `03-guardrail-ack` | Tool 白名单、参数校验、后置条件 | 模型不能越权，真实副作用通过 ACK 验证后才算成功 |

## 面试时如何扩展

1. 把 `fakeModel` 换成真实 LLM Tool Calling。
2. 把 `Map` 换成 SQLite 或项目 Artifact Repository。
3. 把 `canvasPresent` 换成 Electron IPC + Renderer ACK。
4. 增加 `AbortController`、超时、重试次数和 Token 预算。
5. 增加 Trace 记录：runId、toolCallId、stepId、耗时、错误码和结果摘要。
