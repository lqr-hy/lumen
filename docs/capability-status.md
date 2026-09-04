# AI 设计工程能力实施状态

> 最后更新：2026-08-26

本文是项目能力状态的唯一索引。领域协议仍以对应技术文档为准；只有标记为“已实现”且列出验证入口的能力，才能作为当前产品能力使用。

> 2026-08-13：生图链已增加任务级参考图策略、Prompt 合并、PNG 像素分析、目标比例归一化、Raster 主题评分和页面背景约束。语义级对象识别仍依赖可选 Vision Review。

> 2026-08-14：产品主架构调整为通用 Design Catalog。普通整图生图不再依赖模型 Blueprint；业务组件仅在明确指定组件 JSON、组件名称或 Props 导出时作为可选 Component Pack 启用。详见 `universal-ai-design-architecture.md`。
>
> 2026-08-18：组件入口升级为结构化 `@组件` 引用，增加组件解析降级保护、Pending Design Task 和项目级 JSON 导入。详见 `component-mention-and-import.md`。

## 1. 当前完整流程

```text
本地 Provider / Skill Runtime
  -> Agent Session / Plan / Checkpoint
  -> KV、原型、组件 JSON Reference Contract
  -> Page Blueprint
  -> 用户确认
  -> 动态 Component Section Step[]
  -> Editable Scene + 必要 Props 图片 Slot + Page Shell
  -> 页面质量门禁
  -> 可编辑 DesignDocument
  -> 组件包 / 页面开发包 / PNG
```

## 2. 已实现能力

| 能力 | 当前行为 | 验证入口 |
| --- | --- | --- |
| 本地 Runtime 上下文 | Electron 主进程读取本地环境变量，Renderer 不接触 API Key | `runtime-context.md`、生产构建 |
| 双模型 Provider 路由 | 对话/规划与生图模型独立选择；`gpt-image-2` 支持 Generation、Edit、并发多素材和 Raster Artifact | `runtime-context.md`、`test:image-provider` |
| Pi 原生 Runtime | Pi Agent 直接通过 URL/Key 请求 Models/ImagesModels；Codex 网关协议映射、原生 Tool Call、SQLite Session、Abort 和确定性设计工作流已落地，无 CLI/Legacy 路径 | `pi-runtime-refactor.md`、`test:pi-direct`、`test:pi-runtime` |
| 通用 Skill Runtime | 开发目录和 DMG Resources 自动发现 Skill，支持 Catalog、自动选择、显式激活、渐进资源读取和 Runtime Tool | `test:pi-runtime`、`test:component-design`、DMG |
| Agent Loop | Session、Plan、Step、Observation、Artifact、取消、超时和工具重试 | `test:agent-design`、`test:agent-reliability` |
| 确定性 Workflow Graph | Pi 选择高层工作流后，领域执行器按依赖图执行 Ready Step；支持工具级重试、Observation 和 Checkpoint 恢复 | `test:agent-upgrades`、`natural-language-conversation-agent.md` |
| 页面组件增量交付 | 每个页面组件完成后通过 IPC 写入 Renderer；ACK 验证 root/instance/画板/Section，Repair 原位替换，最终交付去重 | `test:page-agent`、`test:component-canvas` |
| page-shell 增量交付 | 组件生成前写入页面外壳；Repair 和最终交付保留 elementId，强制画板只有一个 page-shell | `test:page-agent`、`test:component-canvas` |
| CanvasSnapshot | 请求开始发送无 Base64 的画板、节点、组件和 Page Shell 摘要；ACK 后合并真实写入节点 | `test:agent-upgrades`、`test:page-agent` |
| 结构化 Intent Router | Planner 消费版本化 Intent；中文规则作为离线降级；建议类请求不执行画布任务 | `test:agent-upgrades` |
| Pi 原生会话 Agent | Pi 基于 RuntimeContext 和 Skill Catalog 直接回复或调用高层设计工具；没有独立 Decision 请求和规则回退 | `test:pi-runtime`、`natural-language-conversation-agent.md` |
| Pi 唯一在线意图源 | Workflow Tool 结构化输出 action、taskKind、placement、surfaceKind、designArchetype、outputKind 和 referenceBindings；Planner 不再读取自然语言或历史文本重判 | `test:pi-runtime`、`agent-planner.mjs` |
| 聊天执行时间线 | 回复与 Run 分离，逐 Tool 展示标题、输入/输出摘要、attempt、耗时、错误码和 Canvas ACK，支持事件去重、持久化中断和点击定位 | `test:chat-run`、`chat-agent-run-ui.md` |
| Design Eval | 页面、组件和导出统一输出主题、布局、组件完整性、可编辑覆盖率、可读性及加权总分 | `test:design-eval`、`design-eval-and-repair.md` |
| 局部 Repair Target | 主题修外壳、Section 问题修单组件、缺失素材修 Slot；Runtime 错误禁止错误生图修复 | `test:design-eval`、`test:page-agent` |
| 画布写入后置条件 | 组件验证根节点与目标画板；页面验证组件数量与 Page Shell，失败时禁止报告成功 | `build`、`test:component-canvas` |
| Decision / Repair Loop | Review 按 targetId 失效 page-shell 或指定组件，最多自动修订两次 | `test:page-agent` |
| 检查点恢复 | 已完成 Step 从 Artifact Repository 恢复，失败 Step 继续执行 | `test:agent-reliability` |
| 精确缓存失效 | Step 保存 inputHash、依赖输出哈希和 outputHash | `test:agent-reliability` |
| 组件设计契约 | 从组件 JSON 提取 Profile、设计属性、Slot 和 Props 白名单 | `test:component-design` |
| 通用组件设计树方案 | 已实现 Contract、Thumbnail Vision、Theme/Color Binding、Canonical Tree 合并，以及 Vue 2/React 19 UMD Runtime DOM Inspect；其他框架安全回退 Thumbnail Vision | `universal-component-design-tree.md`、`test:component-design`、`test:component-runtime-inspector` |
| Scene Graph / Source Adapter 重构 P5.1 | Prompt、单组件和组件页面均使用统一 Source/Scene 阶段；Component Design 通过 Canonical Scene Validator 与 Scene Commit 原子写入；组件全尺寸 Visual Shell 的生成、传输、画布和导出契约已删除，仅保留页面级 Page Shell | `scene-graph-adapter-architecture.md`、`test:scene-graph`、`test:component-canvas`、`test:component-design`、`test:component-export`、`test:page-agent` |
| 确定性组件计划 | 模型只提供 VisualTheme；Runtime 从组件 JSON 生成 version、Region、Slot 和 Props 绑定，不再请求自由 Component Blueprint | `reliable-ai-design-generation.md`、`test:component-design` |
| Thumbnail 基础布局契约 | 已校准组件通过 Skill Sidecar 固化 Profile、区域层级、Slot 边界和状态显隐；EraLottery 已还原奖品轮播、双按钮操作行与中奖名单基础结构，无 Sidecar 组件使用通用 fallback | `component-design-capability.md`、`test:component-design` |
| 节点级组件生图 | 只为明确 Props 图片 Slot 独立请求和重试；无 Slot 组件为 0 次生图；失败叶子使用可局部替换的主题 SVG fallback，完整组件由原生 Scene 节点构成 | `test:component-design`、`test:page-agent` |
| 组件可编辑图层 | Section、Image、Shape、Text、RuntimePlaceholder 与 ComponentBinding | `test:component-canvas` |
| Props Patch 同步 | Region 的位置、尺寸、颜色、图片和显隐写回完整 Props Path | `test:component-canvas` |
| Slot 局部重生成 | 属性面板和图片右键菜单原位替换素材，不重建组件 | `test:component-actions`、`test:component-design` |
| Schema-driven Inspector | 画板、单节点、多选和组件信息使用统一字段 Schema；支持类型分组、混合值、单位、颜色、图片预览与暗色模式 | `npm run lint`、`npm run build`、浏览器交互检查 |
| 高级布局属性 P1 | Fixed/Hug/Fill、四边 Padding、四角 Radius、九宫格对齐、Reset、Property Transaction 与 AI `semantic-update` | `test:design-patch`、`npm run lint`、`npm run build` |
| 固有尺寸与布局传播 P1.2 | Text/Button/Section Hug、Min/Max Size、嵌套 Auto Layout 重排与数字标签拖动 | `test:inspector-layout`、浏览器 Undo/Redo 检查 |
| 上下文属性可见性 P1.3 | 响应式锚点按场景显示、Auto Layout 隐藏坐标、Hug/Fill 能力限制；Min/Max 仅面向响应式非 Fixed 维度，Stretch 使用左右/上下固定语义 | `test:inspector-schema`、浏览器 Inspector 检查 |
| 页面级 Agent | 多组件动态 Section Step、共享页面 Blueprint、page-shell 和页面质量门禁 | `test:page-agent` |
| Blueprint 执行确认 | 支持确认前排序、删除、修改高度；Override 会精确失效旧确认检查点 | `test:page-agent`、`test:e2e` |
| Section 锁定 | 右键锁定/解锁整个页面组件实例，并同步 Page Blueprint | `test:component-canvas` |
| Section 局部修订 | 选中页面组件 Root 后原位替换该实例，保留 pageSectionId 和其他模块 | `test:component-canvas` |
| page-shell 局部修订 | 页面视觉外壳具有独立 EditScope，可右键原位重生成 | `test:agent-upgrades`、生产构建 |
| Vision Review 协议 | Renderer 导出级 PNG 画板快照；输出分数和 targetId Issue；失败时降级本地门禁 | `test:agent-upgrades`、`test:page-agent` |
| 页面/组件质量门禁 | 检查结构、主题色距离、可读性、完整性和开发可用性 | `test:component-design`、`test:page-agent` |
| 组件开发包 | Props Patch、Diff、Blueprint、素材、校验和、质量和 Runtime 报告 | `test:component-export` |
| 页面开发包 v3 | Blueprint、组件包、SHA-256 去重、资源清单、交付状态和 1x/2x 预览 | `test:component-export` |
| Runtime Adapter / Sandbox | 支持自定义 Adapter 和 Electron HTML Bundle Sandbox | `test:design-pipeline` |
| 内容寻址存储 | 项目图片、Agent 参考图和 Artifact 按 SHA-256 落盘 | `test:agent-reliability` |
| 项目迁移与恢复 | Schema v1→v2、损坏备份、最近版本回退和 30 个版本快照 | `test:agent-reliability` |
| 专业编辑基础 | Auto Layout、Crop 焦点、阴影、裁剪和文字溢出检查 | `build`、`test:component-export` |
| 浏览器 E2E | 桌面 Chrome 与 390px 设备兼容性视口覆盖默认画板和横向溢出；设计画板仍为 375px | `test:e2e` |
| 结构化聊天输入 | Lexical 管理 IME、光标和不可拆分 Mention；多图片附件以稳定 ID 精确引用，失败恢复 Draft | `ai-chat-canvas-interaction.md`、生产构建 |
| 网关空响应恢复 | Codex HTTP 200 空 Body 最多重试两次，使用新请求 ID，最终错误脱敏 | `ai-chat-canvas-interaction.md`、`test:pi-runtime` |
| Pi 后决策画布目标 | Pi/同层 fallback 是唯一高层设计意图来源；Tool Call 后通过 Target Request/ACK 自动创建或复用 375×812 自适应画板，重试复用线程目标，显式新增只创建一次 | `test:canvas-target`、`test:pi-runtime`、`agent-canvas-transaction-architecture.md` |
| 统一 Canvas Deliverable/ACK | 图片、素材集、组件、组件 Slot、Page Shell、页面组件和页面终态均由 Runtime 发出 Deliverable，Renderer 校验真实写入后 ACK；未 ACK 不得完成 | `test:component-canvas`、`test:component-design`、`test:page-agent` |
| 当前轮工具授权 | 当前消息是执行设计的唯一授权；历史 Session 只提供上下文，独立寒暄不暴露设计工具，避免自动续跑上一轮组件任务 | `test:pi-runtime` |
| 通用节点 DesignPatch | 选中普通节点后支持自然语言更新、移动、新增、删除和图片替换；Runtime 属性白名单、Renderer 原子提交、revision 冲突拒绝 | `design-patch-capability.md`、`test:design-patch` |
| 局部编辑 Action Compiler | 简单文本替换在模型前直接编译；Patch 统一解析；非图片 Patch 动态跳过生图；重试重新冻结当前 Scope 和 Revision | `design-action-compiler.md`、`test:design-patch` |
| 统一 AI SelectionScope | 单节点、多节点、文本 Range、图片矩形 Mask、组件实例、组件 Slot 与 Page Shell 使用冻结 Scope；Runtime/Renderer 目标白名单与 Hash 双重校验，跨画板和组件混选禁止降级 | `selection-scoped-ai-editing.md`、`test:design-patch`、`test:component-actions`、`test:pi-runtime` |
| 图片 Mask 局部重绘 | 普通图片右键进入矩形/画笔/擦除 Mask 工作台，支持笔刷大小与羽化；Provider 接收 edit-base 与 mask；Runtime 本地合成并逐像素保护 Mask 外内容，缺少 Mask 禁止整图降级 | `selection-scoped-ai-editing.md`、`test:component-actions`、`test:image-provider`、`test:raster-analysis` |
| 局部编辑诊断与冲突恢复 | Timeline 展示冻结 Scope、工具、Patch Operation、影响节点、Revision 和文本/图片前后对比；过期 Scope 冲突引导重新选择，不复用旧任务重试 | `selection-scoped-ai-editing.md`、`test:chat-run`、`test:design-patch` |
| Component Pack Loader | Manifest 驱动组件发现、Skill Tool、design/structural 类型与 Pack 来源；普通请求不扫描组件目录，支持开发目录和 DMG Resources | `component-pack-architecture.md`、`test:component-packs` |
| 用户扩展与 Style Pack | 用户目录安装、启停和删除；浏览器声明式风格；Style Pack 注入 Pi、领域工作流与生成工具；用户 Skill 禁止执行代码 | `user-skill-and-style-pack.md`、`test:user-extensions` |
| 设计语言包与分轴发散 | 六种内置设计语言各自声明圆角、描边、深度、材质和母题 Token；六条发散轴独立控制 Direction 与 Range；归一化按语言取基准并让 Style Pack 覆盖优先；旧 Brief 自动迁移 | `visual-direction-divergence.md`、`test:visual-brief` |
| Component Pack 导出适配器 | Electron 主进程执行可信 Pack Adapter；IPC 只传标准 ZIP 和组件标识，限制 64MB、ZIP 格式和 10 秒异步超时，失败回退标准包 | `component-pack-architecture.md`、`test:component-packs`、`test:component-export` |
| 通用 UI Section 渐进交付 | DesignSpec Block 动态生成 Step；完整 Spec 布局计算、稳定 ID Block Patch、逐 Section ACK、失败隔离、partial 时间线和最终 Block 后置条件 | `generic-ui-design-workflow.md`、`test:generic-ui-incremental` |
| 通用 UI Render First | DesignSpec 作为内容清单；模型生成静态 HTML/CSS，Electron 沙箱读取 DOM/ComputedStyle/Bounds，转换为最多 600 个 Scene 节点并通过 `generic-ui-runtime` 原子写入画布；失败才回退 Section Renderer | `generic-ui-design-workflow.md`、`test:generic-ui`、`test:generic-ui-incremental`、`build` |
| 通用 UI 参考主题继承 | 本轮 KV/视觉图先提取 VisualThemeContract；模型与结构修复结果强制合并主题，并由可编辑节点消费视觉 Token | `generic-ui-design-workflow.md`、`test:generic-ui` |
| 开放 Design Block Registry | 支持布局、内容、媒体、数据、Overlay 和后台模块；扩展可受校验注册，模型无有效节点时禁止静默后台 fallback | `generic-ui-design-workflow.md`、`test:generic-ui` |
| Component Pack Surface Contract | Pack 声明 viewport、自动高度、纵向/横向/网格组合、列数、间距和内边距；375×812 仅为活动 H5 Pack Preset | `component-pack-architecture.md`、`test:page-agent` |
| DesignSpec 结构协调 | Block 插入、删除、重排自动识别受影响后继节点；语义 Item Key 保持未变内容 ID；画板 Resize/Reposition 自动 Reflow 并保留手工节点 | `generic-ui-design-workflow.md`、`test:generic-ui-incremental` |
| Agent DesignSpec Patch | 自然语言插入、删除、更新和移动通用 UI Block；Catalog 白名单、Runtime 预演、Renderer 原子提交与双重 Revision 冲突保护 | `design-spec-patch-capability.md`、`test:design-spec-patch` |
| DesignSpec 响应式预览 | 默认 375/768/1440 三档 breakpoint；Sidebar 折叠、指标和卡片换列、移动筛选 Reflow；工具栏切换同一画板且节点 ID 稳定 | `generic-ui-design-workflow.md`、`test:generic-ui-incremental` |
| DesignSpecPatch 自动重基 | 未触碰目标 Block、插入 ID 和锚点的并发修改自动三方重放；真实结构冲突在写入前拒绝 | `design-spec-patch-capability.md`、`test:design-spec-patch` |
| 自定义断点与并排预览 | Runtime 保留合法自定义断点；工具栏管理断点；所有尺寸使用临时编译结果同屏只读预览，不污染 Revision | `generic-ui-design-workflow.md`、`test:generic-ui`、`test:generic-ui-incremental` |
| 节点级结构冲突解决 | 返回 Block/Operation/原因；时间线逐节点选择当前或 AI 版本；在最新 Revision 上原子提交 | `design-spec-patch-capability.md`、`test:design-spec-patch` |
| 断点级 Override | 不复制 Block 内容，按 breakpoint 覆盖主色、圆角、密度、边距、间距、Sidebar、显隐和列数 | `generic-ui-design-workflow.md`、`test:generic-ui`、`test:generic-ui-incremental` |
| 响应式差异与视觉树基线 | 以宽屏为参考生成跨断点差异提示；保存确定性视觉树 fingerprint 并检测受控视觉变化 | `generic-ui-design-workflow.md`、`test:generic-ui-incremental` |
| 跨断点批量 Token | 多选 breakpoint，一次原子更新主色、圆角、密度、边距、间距和 Sidebar；活动断点同步重编 | `generic-ui-design-workflow.md`、`test:generic-ui-incremental` |
| 差异节点定位 | 差异携带稳定 Block/Element ID；点击 Chip 在对应预览框选真实差异节点 | `generic-ui-design-workflow.md`、`test:generic-ui-incremental` |
| Chrome/Electron 像素基线 | 固定 DesignSpec 的 375/768/1440 六张 PNG；Locator Screenshot 阈值比较；测试进程确保关闭 | `responsive-visual.spec.ts`、`test:visual-regression` |
| 通用设计生图 Skill | 六类输出模式、参考图职责隔离、模型相关 Prompt 策略、透明素材契约，并在统一 Provider 入口实际执行 | `design-image-generation-skill.md`、`test:image-skill` |

## 3. 部分实现

| 能力 | 已有部分 | 仍缺少 |
| --- | --- | --- |
| Blueprint 人工控制 | 已支持排序、删除和高度修改 | 组件替换、插入普通 Section、自由拖拽布局 |
| 页面局部 Repair | 组件、Slot、page-shell 及通用 Text/Shape/Button/Image/Section 均可局部修订 | 超大画布跨截断节点 Patch 和冲突自动重基 |
| 页面质量评审 | 确定性检查与默认单次 Vision Review 已接入 Repair | OCR 专用引擎和真实数据集标定 |
| Runtime 验证 | Adapter、Electron Sandbox、截图/控制台/Props 对比协议 | 实际业务 React/Vue Bundle 清单 |
| 专业编辑 | Auto Layout、Crop、阴影、裁剪和文本溢出已实现 | 自由 Mask、渐变编辑器、混合模式、响应式约束 |
| Provider 路由 | Provider 能力会阻止不支持的任务；位图 Generation、Image Edit 已接入 | Animation Provider、真实接口兼容性持续验证 |
| 实时画布同步 | 请求开始和 Deliverable ACK 后会更新 CanvasSnapshot | 用户在工具执行期间的手动编辑和选择变化尚未主动推送；超大画布摘要上限为 80 个节点 |
| 统一引用菜单 | 图片 Mention 和附件 Chips 已接入 | 组件 JSON、画板、节点数据源及低置信度确认卡 |
| 聊天执行入口 | ChatPanel 与底部 Composer 共用 `DesignChatController` 执行层，统一 Run、目标握手、Deliverable 应用、ACK 和错误状态；Draft/线程消息仍由 UI 负责 | Draft 构造、线程创建和失败恢复策略仍待进一步下沉为 Store Command |
| Mutation Ledger | 项目级持久化；稳定 Delivery ID；ACK 前保存 DesignDocument 与 Ledger；DesignPatch 已有 document revision 冲突检测 | 跨存储 Reconciler 和冲突自动重基待实现 |
| Turn Budget | Agent、Workflow、推理和生图共享总耗时、步骤、工具重试、模型请求和生图请求预算；超限返回不可重试错误并保留检查点 | 预算面板和按 Provider 的持久化统计待实现 |
| Canvas Target Lease | 画布目标携带当前 Document Revision；每次增量交付成功后刷新 Lease；无关节点修改可自动重基，目标节点或整页结构修改会拒绝后续写入；时间线展示冲突节点并支持定位，确认后可用最新版本重新执行 | 普通 Deliverable 的 current/incoming 逐节点合并待实现；DesignSpec Patch 已支持 Block 合并 |
| 多框架代码编译方案 | 已实现 DesignDocument -> Normalize/Layout/Semantic/Component/Asset Pass -> Code IR -> HTML/CSS、React 19、Vue 3；支持画板原点归一化、根节点坐标防重复偏移、孤儿节点提升、嵌套相对坐标、Auto Layout Flex、语义 class、Prettier 自动格式化、合法文本 DOM、选中模块局部编译、HTML 结构预览、预览 iframe 加载状态与弹窗滚动隔离、导出快照与 Code IR 共享视觉契约、Runtime Component 黑盒引用、Props 文件、资源清单、诊断、Source Map、编辑器导出 ZIP | Preview Build、真实业务 Component Adapter、InteractionSpec 编译、远程资源实际下载待实现；画布交互渲染器保持独立，避免导出样式污染编辑器；入口为 `src/features/codegen/compiler-registry.ts`，测试为 `npm run test:codegen` |

## 4. 未实现与外部依赖

以下能力不得在产品中声称已经可用：

1. 经过真实 KV 数据集标定的 Vision/OCR 分数阈值。
2. 经过真实业务数据集验收的人物、商品和 3D 位图生成质量基线。
3. 动画 Slot 生成和动画 Runtime 验证。
4. 实际业务 React/Vue Bundle 注册；Sandbox 引擎已实现。
5. Props Patch 写回线上活动组件实例。
6. 图片内部像素的自动语义分层。
7. Electron 主进程 E2E 和跨版本视觉回归基线；浏览器 E2E 已实现。
8. 并行多版设计 + 用户选优。当前只有收敛 Repair 循环（最多两次定向修订），同一时刻不存在方向不同的候选。方案见 `visual-direction-divergence.md` 阶段三。

## 5. 下一步顺序

1. 完成 `DesignChatController`，收敛 Draft、线程创建、Runtime 请求和失败恢复。
2. 分离 Generation Hash 与 Delivery Hash，并增加跨存储 Reconciler 和 document revision 冲突检测。
3. Windows/Linux 像素基线、差异图归档和 PR 审核报告。
4. Blueprint 组件替换、普通 Section 插入和自由布局。
5. 页面 Text/Shape EditScope 与 Design Token 批量更新。
6. 注册真实业务组件 Bundle 并执行 Sandbox 回归。
7. 建立真实 KV/thumbnail Vision、OCR 和视觉回归数据集。
8. Electron IPC 事务 E2E、真实 Codex 冒烟和运行遥测。

## 6. 回归命令

```bash
npm run test:all
npm run test:e2e

# 或分别运行：
npm run test:agent-design
npm run test:agent-reliability
npm run test:agent-upgrades
npm run test:image-provider
npm run test:pi-runtime
npm run test:generic-ui-incremental
npm run test:design-patch
npm run test:design-spec-patch
npm run test:component-actions
npm run test:component-canvas
npm run test:component-design
npm run test:component-packs
npm run test:component-export
npm run test:design-pipeline
npm run test:page-agent
npm run test:render-ir
npm run test:visual-brief
npm run test:e2e
npm run lint
npm run build
```
# 当前新增能力：Generic UI

已实现 `create-ui -> DesignSpec 内容清单 -> Static HTML/CSS Runtime Draft -> Electron DOM Inspection -> Canonical Scene Graph -> 原生节点原子提交 -> Canvas ACK`。后台默认 1440×900，移动端 375×812；Runtime Draft 失败时回退 DesignSpec Section Renderer。业务组件 JSON 和多组件页面仍分别使用 `create-component`、`create-page`。模型生成脚本和复杂交互状态暂不执行。

## 2026-08-19 动态画布放置

- Pi 工作流工具必须提交结构化 `placement`，动态选择 create/insert/revise/variant/assets/resume。
- Runtime 不再根据 Action 或自然语言二次覆盖 Pi 决策，`intent-router` 仅保留离线降级用途。
- Renderer 接收完整只读画板候选上下文；用户不必手动选择画板。
- insert/revise/variant/resume 必须具有明确有效目标，禁止历史线程画板隐式回退。
- Target Request 增加 `operationId`、Lease 和 `baseDocumentRevision`，支持请求级幂等和过期版本拒绝。
- Design Session 记录画布事务的 reserved/committed/failed 状态。

## 2026-08-20 组件素材批量重生成

- Composer 已分离 Selection Scope、结构化 Action 和自然语言 Prompt。
- 连续选择多个组件图片 Slot 会形成 `component-region-batch`，不再显示或发送多条伪 `@` 指令。
- Runtime 使用确定性批量工作流，最多并发生成 2 个素材，并在一次 Deliverable 中交付全部目标。
- Renderer 校验 Revision、Target Hash 和组件绑定后，以单事务替换所有图片并同步各实例 Props Patch。
- 当前为严格原子提交；部分成功和仅重试失败项尚未开放。

## 7. 2026-08-14 通用设计架构重构

- 已实现普通图片 `reference.prepare -> design.brief -> generate/review/refine/validate -> canvas.present`，不再请求模型 Blueprint。
- 已增加 `DesignSpec`、Design Catalog 和编译器新主接口；`GenericUiSchema` 仅作为兼容别名。
- 普通 Web/H5/App/后台页面默认进入通用可编辑设计。
- 只有明确指定组件 JSON/Era 组件才启用组件能力；只有明确指定多个业务组件才进入组合页面。
- 通用节点级 DesignPatch、Agent DesignSpec Patch、安全自动重基、三档 breakpoint 预览、Component Pack Manifest Loader、通用 UI Section 渐进交付、稳定编译 ID、Block 节点 Patch、结构协调和响应式 Reflow 均已完成。

## 2026-08-26 稳定性收敛

- 新增 `electron/runtime/pi/turn-budget.mjs`，统一限制一轮任务的总耗时、执行步骤、工具尝试、推理请求和生图请求。
- 预算状态沿 Pi -> Workflow -> Tool -> Provider 传递，避免多层重试放大请求。
- 预算超限使用不可重试错误码，并保留已完成的检查点和画布节点。
