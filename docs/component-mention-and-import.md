# 组件引用、任务保护与项目级导入技术方案

## 1. 目标

组件设计必须以结构化组件身份为事实来源，图片只承担视觉参考职责。系统支持在同一条消息中使用 `@组件`、`@图片` 和 `@画布节点`，并保证组件任务不会静默降级为普通整图。

核心原则：

1. Prompt 文本只用于表达意图，不用于保存组件 JSON。
2. 组件引用使用 `packId + componentName`，Runtime 再读取可信 Component Pack。
3. 一个组件引用进入 `create-component`；多个组件只有在明确页面意图下进入 `create-page`。
4. 组件解析失败立即返回结构化错误，禁止执行 `create-image` 或 `create-ui`。
5. “开始生成”只恢复 Session 中已建立的 Pending Task。
6. 外部 JSON 必须经过导入、校验和项目级注册，不能从聊天代码块执行。

## 2. 结构化 Mention

```ts
interface ComponentMention {
  type: 'component'
  resourceId: string
  label: string
  packId: string
  componentName: string
}
```

Lexical 节点、Composer Draft、聊天消息和 Agent Request 均保存上述字段。显示文本可以是 `@EraLottery`，但路由与读取不得重新解析显示文本。

统一 `@` 菜单按“组件 / 图片 / 画布”分组。图片显示缩略图，组件显示组件图标、业务标签和 Pack 名称。搜索同时匹配 name、label 和 aliases。

## 3. Runtime 请求

```json
{
  "question": "根据 EraLottery 生成设计稿，使用黄色KV作为视觉主题",
  "componentReferences": [
    {
      "packId": "campaign-components",
      "componentName": "EraLottery"
    }
  ],
  "uploads": [
    { "name": "黄色KV.png", "role": "kv" }
  ]
}
```

`componentReferences` 决定结构与 Props，`uploads` 决定视觉主题。组件 JSON 不进入模型上下文，只将经过 Skill 提取的契约交给领域工作流。

## 4. 路由与降级保护

Runtime 在 Pi Tool Call 之后执行不可绕过的路由校验：

- 当前消息携带一个组件引用时，将错误的 `create-image`/`create-ui` 修正为 `create-component`。
- 携带多个组件且明确要求组合页面时使用 `create-page`。
- 多组件但没有页面意图时返回 `COMPONENT_REFERENCE_AMBIGUOUS`。
- `component.resolve` 必须按结构化身份读取 Pack；失败返回 `COMPONENT_RESOLVE_FAILED`。
- 一旦 Session 进入组件约束模式，不允许普通图片工具接管本轮。

## 5. Pending Design Task

```ts
interface PendingDesignTask {
  id: string
  kind: 'component-design' | 'page-design' | 'generic-ui'
  status: 'prepared' | 'running' | 'failed'
  componentReferences: ComponentReference[]
  goal?: string
  createdAt: string
  updatedAt: string
}
```

选择组件并发送消息后建立 `prepared` 任务。用户明确要求生成时变为 `running`；失败保留为 `failed` 供“继续/重试”恢复；成功后清除。没有 Pending Task 时，“开始生成”返回可操作提示，不得由 Pi 自行创建图片任务。

## 6. 项目级组件导入

导入入口只接受 `.json`，Renderer 读取文本后通过受限 IPC 发送：

```text
runtime:importProjectComponent(projectId, fileName, source)
```

主进程校验：

- 最大 2MB、合法 JSON、对象根节点。
- `name` 使用稳定 ASCII 标识，`props` 必须为对象。
- 限制对象深度、节点数和字符串长度。
- 禁止脚本、Adapter 和路径声明。
- 设计组件必须提供可信 HTTPS thumbnail。
- 不允许覆盖内置 Pack 的 name、file 或 alias。

通过后写入：

```text
userData/project-component-packs/<projectHash>/project-imports/
  manifest.json
  components/<ComponentName>.json
```

项目 Pack 固定使用平台内置 `component-design-assets` Skill，不加载用户脚本。导入成功后刷新 `@组件` 数据源并自动插入结构化 Mention。

## 7. 兼容与安全

- 旧图片 Mention 保持不变；旧 `component-json` 文本引用只展示，不作为可信组件身份。
- 浏览器独立模式无法访问本地 Pack，组件列表和导入入口显示 Runtime 不可用。
- DMG 内置 Pack 为只读资源；项目导入写入 `userData`。
- 所有文件路径由主进程生成，Renderer 不能提交绝对路径。

## 8. 验收条件

1. 输入 `@` 同时看到组件、图片和画布分组。
2. `@EraLottery + @黄色KV` 能生成组件设计，图片只影响主题。
3. 即使 Pi 请求 `create-image`，Runtime 仍执行 `create-component`。
4. 未注册组件返回“组件未解析”，画布没有新增普通整图。
5. 没有 Pending Task 时输入“开始生成”不会生成任何设计。
6. 导入合法 JSON 后无需重启即可从 `@组件` 选择。
7. 非法、超限、重名或包含不可信 thumbnail 的 JSON 被拒绝。

