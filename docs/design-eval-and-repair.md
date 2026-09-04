# Design Eval 与局部 Repair 技术方案

## 1. 目标

Design Eval 用统一结构评估页面、组件和交付包，回答三个问题：

1. 结果是否接近 KV 和 VisualThemeContract。
2. 页面结构、组件和可编辑节点是否完整。
3. 失败时应该重做 Page Shell、某个组件、素材 Slot，还是阻止错误的自动生图修复。

评估是确定性质量门禁，不依赖模型返回“看起来不错”。可选 Vision Review 只作为附加证据。

## 2. 统一报告

```ts
interface DesignEvalReport {
  evalVersion: 1
  passed: boolean
  overall: number
  dimensions: {
    themeAlignment: number
    layoutCompleteness: number
    componentIntegrity: number
    editableCoverage: number
    readability: number
  }
  thresholds: Record<string, number>
  scores: LegacyQualityScores & { editableCoverage: number }
  issues: DesignQualityIssue[]
  repairPlan: DesignRepairTarget[]
  repairCount: number
}
```

`scores` 暂时保留原字段，保证属性面板和历史项目可以读取；新逻辑统一使用 `dimensions`。

## 3. 评分维度

| 维度 | 默认门槛 | 页面计算 | 组件计算 |
| --- | ---: | --- | --- |
| `themeAlignment` | 0.75 | Page Shell、组件主题和可选视觉评审 | Visual Shell 与主题色板亲和度 |
| `layoutCompleteness` | 0.90 | 结构合法性与 Section 完整度 | Region 边界与素材完整度 |
| `componentIntegrity` | 0.90 | Section 交付率与组件质量通过率 | Region 结构与素材 Slot 完整度 |
| `editableCoverage` | 0.80 | 组件覆盖率与独立 Page Shell 图层 | 原生文字/颜色/Runtime Region 和已绑定图片 Slot 占比 |
| `readability` | 0.85 | 文字层级、溢出和视觉评审 | 文本内容与容器高度有效性 |

总分权重：主题 25%、布局 25%、组件完整性 20%、可编辑覆盖率 20%、可读性 10%。

## 4. Repair Target

质量问题先分类，再选择最小修改范围：

| 问题 | Repair Target | 自动执行 |
| --- | --- | --- |
| KV、主题、视觉相似度 | `page-shell` / `component-shell` | 是 |
| 带 `targetId` 的页面组件问题 | `page-component` | 是 |
| 素材或组件缺失 | `failed-components` / `component-assets` | 是 |
| 文字可读性 | `page-component` / `component-region` | 是 |
| 页面或组件结构 | `page-layout` / `component-layout` | 是 |
| Runtime Bundle、Props 或真实渲染失败 | `runtime` | 否 |

Runtime 错误禁止触发生图 Repair，因为重新生成 Page Shell 无法修复组件运行错误。此类错误直接阻断并返回结构化报告。

## 5. 部分页面

页面首次生成时允许单个组件失败并交付已完成组件。此时：

- `componentIntegrity` 和 `layoutCompleteness` 保留真实低分。
- 记录 `PAGE_COMPONENT_INCOMPLETE` 警告。
- 本轮不重生成 Page Shell。
- 用户调用 `continue` 后只恢复失败组件的 Checkpoint。

这避免页面任务因为一个组件失败而重复生成全部背景和已完成组件。

## 6. 接入位置

- `electron/runtime/design-eval.mjs`：统一评分、覆盖率和 Repair 分类。
- `electron/runtime/agent-tools.mjs`：组件验证、页面评审和局部 Repair 决策。
- `src/features/editor/utils/page-delivery.ts`：导出前基于实际画布重新评分。
- `src/features/editor/components/PropertyPanel.tsx`：展示统一五维分数。
- `quality.review.json`：组件包和页面包中的完整评估结果。

## 7. 验收

```bash
npm run test:design-eval
npm run test:component-design
npm run test:page-agent
npm run test:component-export
```

验收要求：

- 主题偏离只选择视觉外壳 Repair。
- 带 Section ID 的问题只重做对应组件。
- Runtime 错误没有自动生图 Repair。
- 部分页面保留低分但不重复生成 Page Shell。
- 组件和页面导出包含 `evalVersion=1`、总分、五维评分和 Repair Plan。
