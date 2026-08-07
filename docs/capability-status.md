# AI 设计工程能力实施状态

> 最后更新：2026-08-07

本文是项目能力状态的唯一索引。领域协议仍以对应技术文档为准；只有标记为“已实现”且列出验证入口的能力，才能作为当前产品能力使用。

## 1. 当前完整流程

```text
本地 Provider / Skill Runtime
  -> Agent Session / Plan / Checkpoint
  -> KV、原型、组件 JSON Reference Contract
  -> Page Blueprint
  -> 用户确认
  -> 动态 Component Section Step[]
  -> Visual Shell + Props Slot + RuntimePlaceholder
  -> 页面质量门禁
  -> 可编辑 DesignDocument
  -> 组件包 / 页面开发包 / PNG
```

## 2. 已实现能力

| 能力 | 当前行为 | 验证入口 |
| --- | --- | --- |
| 本地 Runtime 上下文 | Electron 主进程读取本地环境变量，Renderer 不接触 API Key | `runtime-context.md`、生产构建 |
| 双模型 Provider 路由 | 对话/规划与生图模型独立选择；`gpt-image-2` 支持 Generation、Edit、并发多素材和 Raster Artifact | `runtime-context.md`、`test:image-provider` |
| 通用 Skill Runtime | 开发目录和 DMG Resources 自动发现 Skill，支持 Runtime Tool | `test:component-design`、DMG |
| Agent Loop | Session、Plan、Step、Observation、Artifact、取消、超时和工具重试 | `test:agent-design`、`test:agent-reliability` |
| 受约束 ReAct Loop | 每轮基于 Observation 选择一个 Ready Tool；支持 Inspect、澄清暂停、失败恢复、循环预算和固定 Plan fallback | `test:agent-upgrades`、`natural-language-conversation-agent.md` |
| 页面组件增量交付 | 每个页面组件完成后通过 IPC 写入 Renderer；ACK 验证 root/instance/画板/Section，Repair 原位替换，最终交付去重 | `test:page-agent`、`test:component-canvas` |
| page-shell 增量交付 | 组件生成前写入页面外壳；Repair 和最终交付保留 elementId，强制画板只有一个 page-shell | `test:page-agent`、`test:component-canvas` |
| CanvasSnapshot | 请求开始发送无 Base64 的节点摘要；ACK 后合并真实写入节点，供 canvas.inspect、Conversation 和 ReAct 使用 | `test:agent-upgrades`、`test:page-agent` |
| 结构化 Intent Router | Planner 消费版本化 Intent；中文规则作为离线降级；建议类请求不执行画布任务 | `test:agent-upgrades` |
| 自然语言 Conversation Agent | Codex、Responses API、Claude Code、Copilot 基于会话/画布/选择/参考摘要输出结构化 Decision；模型优先、规则 fallback | `test:agent-upgrades`、`natural-language-conversation-agent.md` |
| 画布写入后置条件 | 组件验证根节点与目标画板；页面验证组件数量与 Page Shell，失败时禁止报告成功 | `build`、`test:component-canvas` |
| Decision / Repair Loop | Review 按 targetId 失效 page-shell 或指定组件，最多自动修订两次 | `test:page-agent` |
| 检查点恢复 | 已完成 Step 从 Artifact Repository 恢复，失败 Step 继续执行 | `test:agent-reliability` |
| 精确缓存失效 | Step 保存 inputHash、依赖输出哈希和 outputHash | `test:agent-reliability` |
| 组件设计契约 | 从组件 JSON 提取 Profile、设计属性、Slot 和 Props 白名单 | `test:component-design` |
| 组件可编辑图层 | Section、Image、Shape、Text、RuntimePlaceholder 与 ComponentBinding | `test:component-canvas` |
| Props Patch 同步 | Region 的位置、尺寸、颜色、图片和显隐写回完整 Props Path | `test:component-canvas` |
| Slot 局部重生成 | 属性面板和图片右键菜单原位替换素材，不重建组件 | `test:component-actions`、`test:component-design` |
| 页面级 Agent | 多组件动态 Section Step、共享页面 Blueprint、page-shell 和页面质量门禁 | `test:page-agent` |
| Blueprint 执行确认 | 支持确认前排序、删除、修改高度；Override 会精确失效旧确认检查点 | `test:page-agent`、`test:e2e` |
| Section 锁定 | 右键锁定/解锁整个页面组件实例，并同步 Page Blueprint | `test:component-canvas` |
| Section 局部修订 | 选中页面组件 Root 后原位替换该实例，保留 pageSectionId 和其他模块 | `test:component-canvas` |
| page-shell 局部修订 | 页面视觉外壳具有独立 EditScope，可右键原位重生成 | `test:agent-upgrades`、生产构建 |
| Vision Review 协议 | 合成页面快照；Codex 输出分数和 targetId Issue；禁用时明确 unsupported | `test:agent-upgrades` |
| 页面/组件质量门禁 | 检查结构、主题色距离、可读性、完整性和开发可用性 | `test:component-design`、`test:page-agent` |
| 组件开发包 | Props Patch、Diff、Blueprint、素材、校验和、质量和 Runtime 报告 | `test:component-export` |
| 页面开发包 v3 | Blueprint、组件包、SHA-256 去重、资源清单、交付状态和 1x/2x 预览 | `test:component-export` |
| Runtime Adapter / Sandbox | 支持自定义 Adapter 和 Electron HTML Bundle Sandbox | `test:design-pipeline` |
| 内容寻址存储 | 项目图片、Agent 参考图和 Artifact 按 SHA-256 落盘 | `test:agent-reliability` |
| 项目迁移与恢复 | Schema v1→v2、损坏备份、最近版本回退和 30 个版本快照 | `test:agent-reliability` |
| 专业编辑基础 | Auto Layout、Crop 焦点、阴影、裁剪和文字溢出检查 | `build`、`test:component-export` |
| 浏览器 E2E | 桌面 Chrome 与 390px 设备兼容性视口覆盖默认画板和横向溢出；设计画板仍为 375px | `test:e2e` |

## 3. 部分实现

| 能力 | 已有部分 | 仍缺少 |
| --- | --- | --- |
| Blueprint 人工控制 | 已支持排序、删除和高度修改 | 组件替换、插入普通 Section、自由拖拽布局 |
| 页面局部 Repair | 组件、Slot 和 page-shell 可局部修订 | 页面普通文字/Shape Section EditScope |
| 页面质量评审 | 确定性检查与可选 Vision Review 已接入 Repair | OCR 专用引擎和真实数据集标定 |
| Runtime 验证 | Adapter、Electron Sandbox、截图/控制台/Props 对比协议 | 实际业务 React/Vue Bundle 清单 |
| 专业编辑 | Auto Layout、Crop、阴影、裁剪和文本溢出已实现 | 自由 Mask、渐变编辑器、混合模式、响应式约束 |
| Provider 路由 | Provider 能力会阻止不支持的任务；位图 Generation、Image Edit 已接入 | Animation Provider、真实接口兼容性持续验证 |
| 实时画布同步 | 请求开始和 Deliverable ACK 后会更新 CanvasSnapshot | 用户在工具执行期间的手动编辑和选择变化尚未主动推送；超大画布摘要上限为 80 个节点 |

## 4. 未实现与外部依赖

以下能力不得在产品中声称已经可用：

1. 经过真实 KV 数据集标定的 Vision/OCR 分数阈值。
2. 经过真实业务数据集验收的人物、商品和 3D 位图生成质量基线。
3. 动画 Slot 生成和动画 Runtime 验证。
4. 实际业务 React/Vue Bundle 注册；Sandbox 引擎已实现。
5. Props Patch 写回线上活动组件实例。
6. 图片内部像素的自动语义分层。
7. Electron 主进程 E2E 和跨版本视觉回归基线；浏览器 E2E 已实现。

## 5. 下一步顺序

1. Blueprint 组件替换、普通 Section 插入和自由布局。
2. 页面 Text/Shape EditScope 与 Design Token 批量更新。
3. 注册真实业务组件 Bundle 并执行 Sandbox 回归。
4. 建立真实 KV/thumbnail Vision、OCR 和视觉回归数据集。
5. 自由 Mask、渐变编辑器、混合模式和响应式约束。
6. Animation Provider 和位图视觉质量数据集。
7. Electron 主进程 E2E、真实 Codex 冒烟和运行遥测。

## 6. 回归命令

```bash
npm run test:all
npm run test:e2e

# 或分别运行：
npm run test:agent-design
npm run test:agent-reliability
npm run test:agent-upgrades
npm run test:image-provider
npm run test:component-actions
npm run test:component-canvas
npm run test:component-design
npm run test:component-export
npm run test:design-pipeline
npm run test:page-agent
npm run test:e2e
npm run lint
npm run build
```
