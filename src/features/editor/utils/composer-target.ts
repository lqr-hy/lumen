export type ComposerQueueTarget = 'bottom' | 'panel'

interface ComposerReference {
  id: string
  text: string
  elementId?: string
  insertOffset?: number
  kind?: 'text' | 'component-region-regeneration'
}

interface QueuedComposerReference {
  id: string
  text: string
  elementId?: string
  kind?: 'text' | 'component-region-regeneration'
}

export function resolveComposerQueueTarget(chatPanelOpen?: boolean): ComposerQueueTarget {
  return chatPanelOpen ? 'panel' : 'bottom'
}

export function upsertQueuedComposerReference(
  references: ComposerReference[],
  queued: QueuedComposerReference,
  insertOffset: number,
): ComposerReference[] {
  const text = queued.text.trim()
  if (!text) return references
  const reference = { ...queued, text, insertOffset }
  const existingIndex = references.findIndex((item) => item.elementId === queued.elementId)
  if (existingIndex < 0) return [...references, reference]
  if (queued.kind !== 'component-region-regeneration') return references

  const next = [...references]
  next[existingIndex] = reference
  return next
}
