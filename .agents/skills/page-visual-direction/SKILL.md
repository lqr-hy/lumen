---
name: page-visual-direction
description: 为完整页面设计建立页面外壳、组件表面、色板、视觉密度和主视觉焦点的分层契约，避免同一 KV 构图在页面与组件中重复。
---

# 页面视觉方向

## 目标

在生成页面图片之前，把用户目标、KV 主题和页面结构编译为稳定的视觉方向。该 Skill 只负责视觉决策，不生成 HTML，也不替代组件 Runtime、Props 图片 Slot 或画布节点。

## 核心原则

1. 先判断页面类型、受众、主题和信息密度，再选择视觉语言，禁止套用固定模板。
2. 同一页面只设置一个主视觉焦点。大胆视觉集中在页面外壳的一个区域，其余区域保持克制。
3. KV 可以在页面和组件之间共享颜色、材质与字体气质，但不得共享完整构图。
4. 页面外壳拥有主构图、跨模块节奏、顶部与底部装饰、章节连接和大面积背景。
5. 页面内嵌组件只使用安静或轻微的 Surface，不能重复页面的放射、主图形、全幅纹理和高饱和光效。
6. 组件 Runtime 与 Props 节点拥有业务文字、按钮、卡片、进度、列表和业务图片；页面外壳不得烘焙这些内容。
7. 颜色必须形成明确角色：页面背景、组件表面、主文字、次文字、强调色。禁止把所有 KV 色等权铺满。
8. 视觉审查必须检查层级、可读性、重复构图、组件与页面的边界，以及页面是否因装饰过多而影响业务内容。

## 输出契约

Runtime Tool `page-visual-direction.compile` 输出 `PageVisualDirection`：

```json
{
  "concept": "一句话视觉概念",
  "palette": {
    "background": "#000000",
    "surface": "#111111",
    "text": "#ffffff",
    "mutedText": "#cccccc",
    "accent": "#ffcc00"
  },
  "signature": {
    "owner": "page-shell",
    "placement": "hero",
    "description": "唯一主视觉焦点"
  },
  "density": {
    "pageShell": "medium",
    "componentSurface": "quiet"
  },
  "regions": [
    { "range": "0-22%", "density": "high", "role": "signature" },
    { "range": "22-85%", "density": "low", "role": "content-bed" },
    { "range": "85-100%", "density": "medium", "role": "footer-transition" }
  ],
  "surfaceTreatment": {
    "mode": "tonal-card",
    "opacity": 0.88,
    "borderOpacity": 0.26,
    "highlightOpacity": 0.12
  },
  "pageShellRules": [],
  "embeddedComponentRules": [],
  "antiPatterns": []
}
```

## 适用边界

- 完整 H5、活动页面、后台页面、App 页面和多组件页面使用本 Skill。
- 单个独立组件生成仍可拥有自身氛围背景，不强制使用页面内嵌 Surface。
- 无 KV 时从用户目标与 Style Pack 推导；有 KV 时以 KV 色彩证据为准。
- 页面中组件失败时不得用整张装饰图伪装成已交付组件。
- 页面内嵌组件的 Surface 覆盖率默认不低于 0.8；KV 颜色可以延续，但页面高密度纹理不得穿透组件内容区。

本 Skill 的视觉推理规则参考了 Anthropic `frontend-design`、Leonxlnx `taste-skill` 和 Superdesign 的公开设计工作流，并针对本项目的可编辑 Canvas 与位图分层协议重新实现。许可证与来源见项目根目录 `THIRD_PARTY_NOTICES.md`。
