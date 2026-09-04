import type { IncrementalCanvasDeliverable } from './types'
import type { DesignDocument, DesignElement } from '../editor/types'

export interface CanvasLeaseSnapshot {
  revision: number
  elementHashes: Record<string, string>
}

export function createCanvasLeaseSnapshot(
  document: DesignDocument,
  artboardId: string,
): CanvasLeaseSnapshot {
  return {
    revision: document.version,
    elementHashes: Object.fromEntries(
      document.elements
        .filter((element) => element.artboardId === artboardId)
        .map((element) => [element.id, hashElement(element)]),
    ),
  }
}

export function findChangedLeaseElements(
  document: DesignDocument,
  artboardId: string,
  snapshot: CanvasLeaseSnapshot,
  targetIds?: string[],
) {
  const allowed = targetIds?.length ? new Set(targetIds) : undefined
  const current = new Map(
    document.elements
      .filter((element) => element.artboardId === artboardId)
      .map((element) => [element.id, hashElement(element)]),
  )
  const ids = new Set([...Object.keys(snapshot.elementHashes), ...current.keys()])
  return Array.from(ids).filter((id) => {
    if (allowed && !allowed.has(id)) return false
    return snapshot.elementHashes[id] !== current.get(id)
  })
}

export function getDeliverableTargetIds(deliverable: IncrementalCanvasDeliverable) {
  if (deliverable.kind === 'component-slot') return deliverable.editScope.targetElementIds
  if (deliverable.kind === 'component-slot-batch') return deliverable.editScope.targetElementIds
  if (deliverable.kind === 'page-shell-edit') return deliverable.editScope.targetElementIds
  if (deliverable.kind === 'design-patch') {
    return Array.from(
      new Set(
        deliverable.patch.operations.flatMap((operation) =>
          'elementId' in operation && operation.elementId
            ? [operation.elementId]
            : 'element' in operation && operation.element?.id
              ? [operation.element.id]
              : [],
        ),
      ),
    )
  }
  if (deliverable.kind === 'design-spec-patch') return undefined
  if (deliverable.kind === 'image' || deliverable.kind === 'asset-set') return undefined
  return undefined
}

function hashElement(element: DesignElement) {
  const copy = structuredClone(element) as unknown as Record<string, unknown>
  delete copy.id
  return JSON.stringify(copy)
}
