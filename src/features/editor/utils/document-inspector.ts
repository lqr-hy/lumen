import type { DesignDocument } from '../types'
import { resolveComponentInstance } from './component-instances'

export type InspectorScope = 'selection' | 'artboard' | 'document'

export function createInspectorSnapshot(
  document: DesignDocument,
  scope: InspectorScope,
  selectedElementIds: string[],
  activeArtboardId?: string,
) {
  let value: unknown = document
  if (scope === 'selection') {
    const elements = document.elements.filter((element) => selectedElementIds.includes(element.id))
    value = {
      elements,
      componentInstance: resolveComponentInstance(document, selectedElementIds),
    }
  } else if (scope === 'artboard') {
    const artboard = document.artboards.find((item) => item.id === activeArtboardId)
    value = artboard ? {
      artboard,
      elements: document.elements.filter((element) => element.artboardId === artboard.id),
      componentInstances: Object.fromEntries(Object.entries(
        document.componentInstances ?? {},
      ).filter(([, instance]) => instance.artboardId === artboard.id)),
    } : null
  }

  return summarizeDataUris(value, document)
}

export function stringifyInspectorSnapshot(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function summarizeDataUris(value: unknown, document: DesignDocument): unknown {
  const assetsBySource = new Map(document.assets.map((asset) => [asset.src, asset]))
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item !== 'string' || !item.startsWith('data:')) return item
    const asset = assetsBySource.get(item)
    const match = /^data:([^;,]+)[^,]*,(.*)$/s.exec(item)
    return {
      src: asset ? `asset://${asset.id}` : 'asset://embedded',
      mime: match?.[1] ?? 'application/octet-stream',
      size: formatBytes(estimateDataUriBytes(item)),
    }
  }))
}

function estimateDataUriBytes(value: string) {
  const comma = value.indexOf(',')
  if (comma < 0) return value.length
  const payload = value.slice(comma + 1)
  return value.slice(0, comma).includes(';base64')
    ? Math.floor(payload.length * 0.75)
    : decodeURIComponent(payload).length
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  return `${Math.max(1, Math.round(bytes / 1024))}KB`
}
