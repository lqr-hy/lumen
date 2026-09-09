# 用户 Skill 与 Style Pack

## 1. 分层

- **Skill**：为 Agent 提供工作方法和领域知识。内置 Skill 可以注册可信 Runtime Tool；用户 Skill 当前只允许指导型 `SKILL.md` 和文本参考资料。
- **Style Pack**：声明颜色、字体、表面、图像语言和设计约束，不执行代码，可在桌面端和浏览器端导入。

设计风格不通过新增 Runtime Tool 实现，避免每种风格扩大工具列表、上下文和本地执行权限。

## 2. 存储

桌面应用使用 `app.getPath('userData')`：

```text
<userData>/extensions/
  registry.json
  skills/installed/<skill-id>/
  style-packs/installed/<style-id>/
  .tmp/
```

内置资源仍为只读：开发环境读取 `.agents/skills/` 和 `style-packs/`，DMG 读取 `Resources/skills/` 和 `Resources/style-packs/`。

浏览器版只支持 Style Pack，使用 `localStorage` 的 `lumen-style-packs-v1` 保存，不安装或执行 Skill。

## 3. Style Pack 契约

最小可导入 JSON：

```json
{
  "id": "festival-red",
  "name": "节庆红",
  "version": "1.0.0",
  "colors": {
    "primary": "#e11d48",
    "background": "#7f1d1d",
    "text": "#ffffff"
  }
}
```

完整目录可以包含 `manifest.json`、`style.json` 和 `prompt.md`。支持 `colors`、`typography`、`surfaces`、`imagery`、`constraints` 和 `prompt`；至少包含两个有效颜色。

## 4. 运行时传播

```text
聊天设计风格选择
  -> IPC stylePackId
  -> Main resolveStylePack
  -> Pi RuntimeContext.stylePack
  -> Domain Session.activeStylePack
  -> Planner / Theme / Image Tool Prompt
  -> Props、Visual Shell、Slot 与质量评审
```

Style Pack 进入 Step 输入哈希，切换风格后不会复用旧风格的检查点。优先级为：

```text
本轮明确要求 > 本轮 KV / Visual Reference > Style Pack > thumbnail / 默认主题
```

存在 KV 时，Style Pack 只补充未指定的排版、间距和 Surface，不覆盖 KV 的品牌、主色与图形语言。

## 5. 用户 Skill 安全边界

用户 Skill 支持目录或 ZIP 导入，必须包含合法 `SKILL.md`：

- 不能覆盖内置 Skill。
- 禁止 `runtime/`、`scripts/`、可执行文件和符号链接。
- ZIP 最多 8MB、96 个文件，解压后最多 12MB。
- 禁止 ZIP 路径穿越。
- 可启用、停用和删除，修改后立即刷新 Skill 缓存。

若未来开放可执行第三方 Skill，必须先增加签名、发布者身份、权限 Manifest、隔离执行环境和安装确认。

## 6. 产品能力

“能力与风格”页面支持 Style Pack 色板预览、桌面端目录/JSON/ZIP 导入、浏览器 JSON 导入、标准 JSON 导出、用户扩展启停和删除。底部聊天及右侧聊天面板均可选择设计风格。

验证命令：

```bash
npm run test:user-extensions
```
