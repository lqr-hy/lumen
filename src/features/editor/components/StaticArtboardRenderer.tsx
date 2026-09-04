import type { DesignDocument, Artboard } from '../types'
import { buildArtboardRenderTree } from '../render/render-box'
import { RenderBoxView } from '../render/RenderBoxView'

/**
 * 静态画板渲染：版本对比、PNG 快照和页面导出共用。
 * 与编辑画布消费同一棵 Render IR，只是不附加交互态。
 */
export function StaticArtboardRenderer({
  document,
  artboard,
}: {
  document: DesignDocument
  artboard: Artboard
}) {
  // 使用 nested 结构与代码导出保持一致：父节点的 clipContent、autoLayout 和
  // 透明度继承只有在真实嵌套下才成立。编辑画布因拖拽依赖世界坐标仍走 flat，
  // 那是交互需要的例外，不是视觉真源的分歧。
  const { root } = buildArtboardRenderTree(document, artboard, {
    mode: 'static',
    structure: 'nested',
  })
  return <RenderBoxView box={root} />
}
