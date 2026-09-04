import type { Artboard } from '../types'
import type { SceneGraph } from './scene-graph'
import { assertSceneGraph } from './scene-validator'

export function prepareRuntimeSceneForArtboard(graph: SceneGraph, artboard: Artboard): SceneGraph {
  assertSceneGraph(graph, { maxNodes: 1_000 })
  const prefix = `${artboard.id}:runtime:`
  const idMap = new Map(graph.nodes.map((node) => [node.id, `${prefix}${node.id}`]))
  const offsetX = artboard.x - (graph.surface.originX ?? 0)
  const offsetY = artboard.y - (graph.surface.originY ?? 0)
  const prepared: SceneGraph = {
    ...graph,
    id: `${prefix}${graph.id}`,
    rootNodeId: idMap.get(graph.rootNodeId) ?? `${prefix}${graph.rootNodeId}`,
    surface: {
      ...graph.surface,
      originX: artboard.x,
      originY: artboard.y,
    },
    nodes: graph.nodes.map((node) => ({
      ...node,
      id: idMap.get(node.id)!,
      parentId: node.parentId ? idMap.get(node.parentId) : undefined,
      bounds: {
        ...node.bounds,
        x: node.bounds.x + offsetX,
        y: node.bounds.y + offsetY,
      },
      ownership: {
        ...node.ownership,
        regionId: `${prefix}${node.ownership.regionId}`,
      },
      metadata: {
        ...node.metadata,
        artboardId: artboard.id,
      },
    })),
  }
  assertSceneGraph(prepared, { maxNodes: 1_000 })
  return prepared
}
