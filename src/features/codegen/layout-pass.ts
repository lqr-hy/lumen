import type { CodeNode } from './types'

/**
 * IR 的尺寸已在 `buildRenderBox` 中统一舍入并带单位，此处只钳制透明度，
 * 避免非法值进入产物。尺寸不再二次取整 —— 那会与画布产生亚像素偏差。
 */
export function normalizeLayout(nodes: CodeNode[]) {
  for (const node of nodes) {
    const opacity = node.css.opacity
    if (opacity !== undefined) {
      const value = Number(opacity)
      if (Number.isFinite(value)) node.css.opacity = String(Math.min(1, Math.max(0, value)))
      else delete node.css.opacity
    }
    normalizeLayout(node.children)
  }
  return nodes
}
