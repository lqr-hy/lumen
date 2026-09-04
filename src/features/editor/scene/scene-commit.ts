import type { DesignElement } from '../types'
import { sceneNodeToDesignElement } from './design-element-adapter'
import type { SceneCommit, SceneGraph } from './scene-graph'
import { assertSceneGraph } from './scene-validator'

export function compileSceneCommit(
  graph: SceneGraph,
  options: { artboardId?: string } = {},
): SceneCommit {
  const validation = assertSceneGraph(graph)
  const elements: DesignElement[] = graph.nodes.map((node) =>
    sceneNodeToDesignElement(node, options.artboardId),
  )
  const root = graph.nodes.find((node) => node.id === graph.rootNodeId)
  if (!root) throw new Error(`Scene Root 不存在：${graph.rootNodeId}`)
  return {
    graphId: graph.id,
    rootNodeId: graph.rootNodeId,
    elements,
    contentHeight: graph.surface.height,
    sourceAdapterId: root.source.adapterId,
    diagnostics: validation.diagnostics,
  }
}
