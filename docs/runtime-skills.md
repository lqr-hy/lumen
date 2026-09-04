# Runtime Skills 打包、发现与执行方案

## 1. 目标

为 Electron 开发环境和 DMG 提供统一的 Pi Skill Runtime，使设计风格、组件知识和工作流规范可以持续沉淀，而不修改 Provider 或公共状态协议。

Skill 分为两部分：

```text
SKILL.md / references / scripts
  -> 提供 Agent 执行规范和渐进式上下文

runtime/manifest.json / runtime entry
  -> 提供 Electron 可直接执行的确定性 Runtime Tools
```

## 2. 目录规范

```text
.agents/skills/<skill-name>/
├── SKILL.md
├── agents/openai.yaml
├── references/
├── scripts/
└── runtime/
    ├── manifest.json
    └── entry.mjs
```

`runtime` 是本应用扩展，不是 Codex Skill 的必需目录。没有 Runtime Tool 的纯指导型 Skill 可以省略。

## 3. DMG 打包

`electron-builder.extraResources` 将以下目录复制到 `Contents/Resources`，保持在 `app.asar` 外部：

```text
.agents/skills -> Resources/skills
componentsJson -> Resources/componentsJson
```

开发路径：

```text
<appRoot>/.agents/skills
<appRoot>/componentsJson
```

生产路径：

```text
process.resourcesPath/skills
process.resourcesPath/componentsJson
```

## 4. Skill 发现

`electron/runtime/skills.mjs` 在应用启动后扫描 Skill 根目录：

1. 读取每个目录的 `SKILL.md`。
2. 校验目录名与 frontmatter `name` 一致。
3. 读取可选 `runtime/manifest.json`。
4. 校验工具模块路径不能越过 Skill 根目录。
5. 缓存公开元数据、触发词和工具列表。

无效 Skill 会被忽略并写入安全日志，不阻塞应用启动。

## 5. Skill 选择

每次 `agent_run` 支持两种选择方式：

1. 前端或调用方显式传入 `skillNames`。
2. Runtime 根据问题中的 `$skill-name` 或 manifest `triggers` 自动匹配。

一次任务最多自动选择 4 个 Skill，避免上下文膨胀。

选择结果会写入 Agent Session。用户发送“继续”“重试”时，即使本轮没有再次命中触发词，也会沿用上一轮已选择的 Skill；用户显式传入新的 `skillNames` 时，以本轮选择结果为准。

## 6. Pi 渐进式激活

System Prompt 只注入 Skill Catalog 的名称、简介和位置。显式选择或触发词命中只确定候选 Skill，
完整正文统一由模型调用 `skill_activate` 按需加载。引用资料通过
`skill_read_resource` 按需读取，并且只能访问当前 Skill 的 `references` 或文本型 `assets`。

`SKILL.md` 最大 64KB，单个 references/assets 文本资源最大 32KB，防止一次 Tool Result 占满模型上下文。

不复制 Skill，不创建 Job 目录，不让模型直接读取文件系统。Session 只保存 Skill 名称和脱敏后的
Tool Observation。

## 7. Runtime Tool Manifest

示例：

```json
{
  "version": 1,
  "triggers": ["组件 json", "valuetypemap"],
  "tools": [
    {
      "name": "component-design-assets.resolve-contract",
      "description": "生成组件设计契约。",
      "module": "runtime/entry.mjs",
      "export": "resolveContract"
    }
  ]
}
```

约束：

- Tool 名称在全部 Skill 中必须唯一。
- `module` 必须位于当前 Skill 根目录内。
- `export` 必须是异步或同步函数。
- Runtime Tool 只接受结构化可序列化输入并返回可序列化结果。
- Runtime Tool 作为随应用发布的受信任代码执行，不加载用户下载的未知模块。

## 8. Tool 执行

Electron 使用 `executeSkillTool(toolName, input)`：

1. 从 Skill Registry 查找 Tool。
2. 校验并解析模块路径。
3. 使用 Electron Node Runtime 动态导入模块。
4. 调用 manifest 指定导出。
5. 将结果作为 Agent Observation 返回。

因此 DMG 不依赖用户安装 `node`。Skill 中的 CLI scripts 只用于开发和调试；正式 Agent Loop 调用 Runtime Tool。

### 8.1 Planner 接入条件

注册 Runtime Tool 只解决“工具可被发现和执行”，不会自动产生业务 Plan。要让 Agent Loop 调用新工具，Planner 必须生成对应 Step：

```js
{
  id: 'resolve-component-contract',
  title: '解析组件设计契约',
  tool: 'component-design-assets.resolve-contract',
  input: { component: componentJson },
  status: 'pending'
}
```

Loop 会把 `step.input` 作为结构化输入传给 Runtime Tool，并把返回值保存为 Observation。后续 Step 必须明确从前序 Observation 读取所需数据。

当前 Planner 已接入整图生成、普通独立素材和组件设计三条流程。组件设计只在提示词同时出现组件语义、明确生成动作和可匹配的打包组件名称时启动；随后通过结构化 Step 调用 Contract、Thumbnail Blueprint、Slot Plan、独立素材、Props Patch 和组合预览工具，不依赖模型自行决定工具名。

## 9. 新增 Skill

1. 在 `.agents/skills/<name>` 创建合法 Skill。
2. 需要确定性工具时增加 `runtime/manifest.json` 和入口模块。
3. 在 manifest 中配置触发词和唯一 Tool 名称。
4. 运行 Skill 元数据、路径和 Runtime Tool 测试。
5. 重新构建 DMG；无需修改 `package.json` 的资源列表。

## 10. 安全与版本

- Skill 作为只读应用资源发布。
- Job 使用副本，禁止修改安装目录中的 Skill。
- API Key、Token 和 Session 数据不进入 Skill。
- Runtime Tool 模块禁止路径穿越。
- 后续可在 manifest 增加 `skillVersion`、Tool 输入 Schema 和校验摘要。
- 应用升级负责更新内置 Skill；用户自定义 Skill 应使用独立目录和显式信任流程，不能直接混入内置 Registry。

## 11. 运行链路

```text
Renderer agent_run
  -> resolveSkillNames
  -> Agent Session 保存 skillNames
  -> Pi Agent 注入 Skill Catalog / 按需激活所选 Skill
  -> skill_activate / skill_read_resource
  -> studio_run_design_workflow
  -> Planner 执行领域 Tool 或 Skill Runtime Tool
  -> Observation / Artifact / Agent Event
```
