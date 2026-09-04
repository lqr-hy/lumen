import type { Artboard, DesignBreakpoint, DesignElement, DesignSpec } from '../types'
import { resolveDesignBlockColumns, resolveDesignSpecBreakpoint } from './generic-ui-compiler'
import { compileDesignSpecToSceneCommit } from '../scene/design-spec-adapter'

export interface ResponsivePreviewResult {
  breakpoint: DesignBreakpoint
  schema: DesignSpec
  elements: DesignElement[]
  contentHeight: number
  fingerprint: string
  blockColumns: Record<string, number>
  hints: ResponsiveDifferenceHint[]
}

export interface ResponsiveDifferenceHint {
  code: string
  label: string
  blockIds: string[]
  elementIds: string[]
}

export function compileResponsivePreviews(
  spec: DesignSpec,
  artboard: Artboard,
): ResponsivePreviewResult[] {
  const breakpoints = spec.responsive?.breakpoints ?? []
  const previews = breakpoints.map((breakpoint) => {
    const schema = resolveDesignSpecBreakpoint(spec, breakpoint.id)
    const previewArtboard = {
      ...artboard,
      x: 0,
      y: 0,
      width: schema.viewport.width,
      height: schema.viewport.height,
    }
    const { commit } = compileDesignSpecToSceneCommit(schema, previewArtboard)
    const blockColumns = Object.fromEntries(
      schema.blocks
        .filter((block) => ['stats', 'content-grid', 'form'].includes(block.kind))
        .map((block) => [block.id, resolveDesignBlockColumns(block, schema)]),
    )
    return {
      breakpoint,
      schema,
      elements: commit.elements,
      contentHeight: commit.contentHeight,
      fingerprint: createResponsiveVisualFingerprint(schema, commit.elements, commit.contentHeight),
      blockColumns,
      hints: [] as ResponsiveDifferenceHint[],
    }
  })
  const reference = previews
    .slice()
    .sort((a, b) => b.schema.viewport.width - a.schema.viewport.width)[0]
  return previews.map((preview) => ({
    ...preview,
    hints: createDifferenceHints(preview, reference),
  }))
}

export function createResponsiveVisualFingerprint(
  schema: DesignSpec,
  elements: DesignElement[],
  contentHeight: number,
) {
  const visualTree = {
    viewport: schema.viewport,
    theme: schema.theme,
    layout: schema.layout,
    contentHeight,
    elements: elements.map((element) => ({
      id: element.id,
      type: element.type,
      visible: element.visible !== false,
      bounds: [element.x, element.y, element.width, element.height],
      fill: element.type === 'shape' ? element.fill : undefined,
      stroke: element.type === 'shape' ? element.stroke : undefined,
      radius: 'borderRadius' in element ? element.borderRadius : undefined,
      content: element.type === 'text' ? element.content : undefined,
      textStyle: element.type === 'text' ? element.style : undefined,
    })),
  }
  return `rvb-${fnv1a(JSON.stringify(visualTree)).toString(36)}`
}

function createDifferenceHints(
  preview: ResponsivePreviewResult,
  reference?: ResponsivePreviewResult,
) {
  if (!reference || preview.breakpoint.id === reference.breakpoint.id)
    return [hint('reference', '参考尺寸')]
  const hints: ResponsiveDifferenceHint[] = []
  const referenceBlocks = new Set(reference.schema.blocks.map((block) => block.id))
  const currentBlocks = new Set(preview.schema.blocks.map((block) => block.id))
  const hidden = [...referenceBlocks].filter((id) => !currentBlocks.has(id))
  if (hidden.length) hints.push(hint('hidden-blocks', `隐藏 ${hidden.length} 个区块`, hidden))
  const sidebar = preview.schema.blocks.find((block) => block.kind === 'sidebar')
  const sidebarRoot =
    sidebar &&
    preview.elements.find(
      (element) => element.designBlockId === sidebar.id && element.designRole === 'design-block',
    )
  const referenceSidebar = reference.schema.blocks.find((block) => block.kind === 'sidebar')
  const referenceSidebarRoot =
    referenceSidebar &&
    reference.elements.find(
      (element) =>
        element.designBlockId === referenceSidebar.id && element.designRole === 'design-block',
    )
  if (
    Boolean(sidebarRoot?.visible !== false && sidebarRoot?.width) !==
    Boolean(referenceSidebarRoot?.visible !== false && referenceSidebarRoot?.width)
  ) {
    hints.push(
      hint(
        'sidebar-visibility',
        sidebarRoot?.visible !== false && sidebarRoot?.width ? '展开侧栏' : '折叠侧栏',
        sidebar ? [sidebar.id] : [],
        sidebarRoot ? [sidebarRoot.id] : [],
      ),
    )
  }
  const changedColumns = Object.entries(preview.blockColumns).filter(
    ([id, columns]) =>
      reference.blockColumns[id] !== undefined && reference.blockColumns[id] !== columns,
  )
  if (changedColumns.length) {
    const blockIds = changedColumns.map(([id]) => id)
    hints.push(
      hint(
        'block-columns',
        `${changedColumns.length} 个区块换列`,
        blockIds,
        preview.elements
          .filter(
            (element) =>
              element.designRole === 'design-block' &&
              element.designBlockId &&
              blockIds.includes(element.designBlockId),
          )
          .map((element) => element.id),
      ),
    )
  }
  if (preview.schema.theme.radius !== reference.schema.theme.radius)
    hints.push(hint('theme-radius', '圆角覆盖'))
  if (preview.schema.theme.colors[3] !== reference.schema.theme.colors[3])
    hints.push(hint('theme-primary', '主色覆盖'))
  if (preview.schema.layout?.contentPadding !== reference.schema.layout?.contentPadding)
    hints.push(hint('content-padding', '内容边距变化'))
  if (preview.schema.layout?.blockGap !== reference.schema.layout?.blockGap)
    hints.push(hint('block-gap', '区块间距变化'))
  return hints.length ? hints : [hint('viewport-only', '仅尺寸变化')]
}

function hint(
  code: string,
  label: string,
  blockIds: string[] = [],
  elementIds: string[] = [],
): ResponsiveDifferenceHint {
  return { code, label, blockIds, elementIds }
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
