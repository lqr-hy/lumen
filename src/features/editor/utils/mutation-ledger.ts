import type { CanvasWriteObservation, IncrementalCanvasDeliverable } from '../../ai/types'

export interface MutationLedgerEntry {
  deliveryId: string
  runId: string
  stepId: string
  kind: IncrementalCanvasDeliverable['kind']
  artboardId?: string
  observation: CanvasWriteObservation
  committedAt: string
}

const MAX_LEDGER_ENTRIES = 500

export function normalizeMutationLedger(value: unknown): MutationLedgerEntry[] {
  if (!Array.isArray(value)) return []
  const byDelivery = new Map<string, MutationLedgerEntry>()
  for (const item of value) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.deliveryId !== 'string' ||
      typeof item.runId !== 'string' ||
      typeof item.stepId !== 'string' ||
      typeof item.kind !== 'string' ||
      !item.observation ||
      item.observation.status !== 'success'
    )
      continue
    byDelivery.set(item.deliveryId, item as MutationLedgerEntry)
  }
  return Array.from(byDelivery.values()).slice(-MAX_LEDGER_ENTRIES)
}

export function appendMutationLedger(
  ledger: MutationLedgerEntry[],
  deliverable: IncrementalCanvasDeliverable,
  observation: CanvasWriteObservation,
) {
  if (observation.status !== 'success') return ledger
  const next = ledger.filter((entry) => entry.deliveryId !== deliverable.id)
  next.push({
    deliveryId: deliverable.id,
    runId: deliverable.runId,
    stepId: deliverable.stepId,
    kind: deliverable.kind,
    artboardId: observation.data?.artboardId ?? deliverable.target?.artboardId,
    observation,
    committedAt: new Date().toISOString(),
  })
  return next.slice(-MAX_LEDGER_ENTRIES)
}

export function findMutationObservation(ledger: MutationLedgerEntry[], deliveryId: string) {
  return ledger.find((entry) => entry.deliveryId === deliveryId)?.observation
}
