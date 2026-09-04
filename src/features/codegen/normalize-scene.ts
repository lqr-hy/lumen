import type { Artboard, DesignElement } from '../editor/types'
import { buildArtboardRenderTree, type RenderBox } from '../editor/render/render-box'
import type { CodeDiagnostic } from './types'

export interface NormalizedScene {
  root: RenderBox
  nodes: RenderBox[]
  diagnostics: CodeDiagnostic[]
  artboard: Artboard
}

/**
 * 把画板编译为 Render IR。
 *
 * 与画布、快照消费同一个 `buildArtboardRenderTree`，因此视觉规则不存在第二份实现。
 * 导出使用 nested 结构，让 autoLayout 的 flex 语义和 section 裁剪在产物中成立。
 */
export function normalizeScene(
  document: {
    artboards: Artboard[]
    elements: DesignElement[]
    componentInstances?: Record<
      string,
      {
        id: string
        artboardId: string
        rootElementId: string
        componentName: string
        profile: string
        design: { packId?: string; propsPatch: Record<string, unknown> }
      }
    >
  },
  artboardId?: string,
  selectionIds: string[] = [],
): NormalizedScene {
  const artboard =
    document.artboards.find((item) => item.id === artboardId) ?? document.artboards[0]
  if (!artboard) throw new Error('没有可编译的画板。')

  const tree = buildArtboardRenderTree(document, artboard, {
    mode: 'export',
    structure: 'nested',
    selectionIds,
  })

  return {
    root: tree.root,
    nodes: tree.boxes,
    diagnostics: tree.diagnostics.map((item) => ({
      code: `CODEGEN_${item.code}`,
      severity: item.severity,
      message: item.message,
      nodeId: item.elementId,
    })),
    artboard: {
      ...artboard,
      x: 0,
      y: 0,
      width: tree.surface.width,
      height: tree.surface.height,
    },
  }
}
