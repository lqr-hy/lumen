# 通用设计生图 Skill

## 结论

当前项目不直接安装第三方生图 CLI，而是采用 Agent Skills 开放格式新增 `design-image-generation`。Skill 复用成熟项目的方法论，并通过项目已有 Pi Runtime、Provider、画布事务和 Raster 质量门禁执行。

## 开源方案评估

| 项目 | 可借鉴能力 | 不直接接入的原因 |
| --- | --- | --- |
| [OpenAI imagegen](https://github.com/openai/skills/tree/main/skills/.system/imagegen) | 生成/编辑分类、参考图角色、准确文案、透明素材检查、单点迭代 | 默认依赖 Codex 内置 `image_gen` 或 Python CLI，不是应用内 Pi Tool |
| [RunComfy AI Image Generation](https://github.com/prime-skills/runcomfy-agent-skills) | 按文字、写实、多参考图和速度选择模型；区分 T2I/I2I | 依赖 RunComfy CLI、账号和另一套模型路由，会绕过当前 Provider 与日志 |
| [ByteDance DeerFlow image-generation](https://github.com/bytedance/deer-flow) | 结构化 Prompt、多参考图职责、场景/产品模板 | Python 路径和环境变量属于 DeerFlow；公开审计中存在未通过项，不能原样打包 |
| [Anthropic canvas-design](https://github.com/anthropics/skills/tree/main/skills/canvas-design) | 视觉哲学、构图与二次精修 | 偏艺术海报，强调极少文字，不适合需要还原真实组件和业务 UI 的主流程 |

## 架构

```text
用户消息 / 页面工作流 / 组件工作流
            |
            v
design-image-generation.compile-brief
  - 判定输出模式
  - 标注参考图职责
  - 添加模型相关 Prompt 策略
  - 编译任务级尺寸与透明度契约
            |
            v
requestProvider(generate_image / generate_assets)
            |
            v
Pi ImagesModels -> 当前应用生图 Provider
            |
            v
Raster 归一化 -> 透明度/比例检查 -> Canvas Artifact
```

## 已实现能力

- 完整 UI、页面背景、独立素材、图片编辑、KV/海报和普通图片六类输出模式。
- Prototype、KV、Visual、Edit Base 的职责隔离。
- `gpt-image-2` 准确文字和布局策略。
- `nano-banana-pro` 多参考图与不变量策略。
- 独立素材单对象、紧边界和真实 Alpha 契约。
- 所有 `generate_image` / `generate_assets` 请求统一编译，不只影响外层聊天。
- DMG 通过现有 `extraResources` 自动打包 Skill。

## 边界

- Skill 不替用户切换生图模型。
- Skill 不执行外部 Shell、Python 或 RunComfy/ComfyUI 工作流。
- Skill 不替代 Raster 像素检查和 Vision Review。
- 当前模型只有统一 Provider 支持的尺寸枚举，任意逻辑尺寸仍由生成后归一化完成。

## 验证

```bash
npm run test:image-skill
npm run test:image-provider
```
