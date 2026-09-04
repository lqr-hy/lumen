import type { Artboard, DesignSpec } from '../types'
import { compileDesignSpec } from '../utils/generic-ui-compiler'
import { designElementsToSceneGraph } from './design-element-adapter'
import { compileSceneCommit } from './scene-commit'

export const DESIGN_SPEC_ADAPTER_ID = 'design-spec'

export function compileDesignSpecToSceneCommit(
  schema: DesignSpec,
  artboard: Artboard,
  options: { includeBlockIds?: ReadonlySet<string> } = {},
) {
  const compiled = compileDesignSpec(schema, { artboard, includeBlockIds: options.includeBlockIds })
  const elements = compiled.elements
  const graph = designElementsToSceneGraph(elements, {
    graphId: `scene:${DESIGN_SPEC_ADAPTER_ID}:${artboard.id}`,
    rootNodeId: compiled.rootId,
    artboard: { ...artboard, width: schema.viewport.width },
    surfaceKind: schema.surfaceKind,
    contentHeight: compiled.contentHeight,
    adapterId: DESIGN_SPEC_ADAPTER_ID,
  })
  return {
    graph,
    commit: compileSceneCommit(graph, { artboardId: artboard.id }),
  }
}
