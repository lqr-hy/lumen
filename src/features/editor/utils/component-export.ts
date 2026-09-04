import type { ComponentInstance, DesignDocument, StructuralInstance } from '../types'
import { createZip, type ZipEntry } from './zip'
import { sha256Bytes } from './sha256'

export function buildComponentExportPackage(document: DesignDocument, instanceId: string) {
  const instance = document.componentInstances?.[instanceId]
  if (!instance) throw new Error(`组件实例不存在：${instanceId}`)
  const elements = document.elements.filter(
    (element) => element.componentBinding?.instanceId === instanceId,
  )
  const entries: ZipEntry[] = []
  const propsPatch = structuredClone(instance.design.propsPatch)
  const exportedAssets: Array<{
    slotId: string
    propPath?: string
    fallbackPath?: string
    designOnly?: boolean
    file: string
    checksum: string
    bytes: number
  }> = []

  for (const task of instance.design.assetTasks) {
    const element = elements.find((item) => item.componentBinding?.slotId === task.slotId)
    if (!element || element.type !== 'image' || !element.src.startsWith('data:')) continue
    const file = task.designOnly
      ? `design/background.${extensionForDataUri(element.src)}`
      : `assets/${assetFileName(task.label || task.slotId, element.src)}`
    const data = decodeDataUri(element.src)
    entries.push({ name: file, data })
    if (task.propPath) setNestedValue(propsPatch, task.propPath, file)
    if (task.fallbackPath) setNestedValue(propsPatch, task.fallbackPath, file)
    exportedAssets.push({
      slotId: task.slotId,
      propPath: task.propPath,
      fallbackPath: task.fallbackPath,
      designOnly: task.designOnly,
      file,
      checksum: checksum(data),
      bytes: data.length,
    })
  }

  const manifest = {
    schemaVersion: 3,
    componentPackId: instance.design.packId,
    componentName: instance.componentName,
    profile: instance.profile,
    instanceId: instance.id,
    artboardId: instance.artboardId,
    rootElementId: instance.rootElementId,
    sourceHash: instance.design.sourceHash,
    generatedAt: new Date().toISOString(),
    compatibility: {
      propsMode: 'merge-patch',
      runtimeValidated: instance.design.runtimeValidation?.status === 'passed',
    },
    deliveryStatus:
      instance.design.runtimeValidation?.status === 'passed'
        ? 'runtime-verified'
        : instance.design.runtimeValidation?.status === 'failed'
          ? 'blocked'
          : instance.design.qualityReview?.passed === false
            ? 'diagnostic-only'
            : 'design-ready',
    assets: exportedAssets,
    resources: {
      remoteImages: Array.from(
        new Set(
          elements.flatMap((element) =>
            element.type === 'image' && /^https?:\/\//i.test(element.src) ? [element.src] : [],
          ),
        ),
      ),
      fonts: Array.from(
        new Set(
          elements.flatMap((element) =>
            element.type === 'text' && element.style.fontFamily ? [element.style.fontFamily] : [],
          ),
        ),
      ),
    },
  }
  entries.unshift(
    jsonEntry('manifest.json', manifest),
    jsonEntry('props.patch.json', propsPatch),
    jsonEntry('props.diff.json', createPropsDiff(propsPatch)),
    jsonEntry('blueprint.json', instance.design.blueprint),
    jsonEntry('theme.tokens.json', instance.design.blueprint.visualTheme ?? null),
    jsonEntry('quality.review.json', instance.design.qualityReview ?? null),
    jsonEntry(
      'runtime.validation.json',
      instance.design.runtimeValidation ?? {
        status: 'unsupported',
        consoleErrors: [],
        unknownProps: [],
        missingAssets: [],
        message: '未配置真实组件 Runtime Adapter。',
      },
    ),
    jsonEntry('component.structure.json', {
      instance: withoutDesign(instance),
      elements: elements.map((element) => summarizeElementSource(element)),
    }),
  )
  return createZip(entries)
}

function createPropsDiff(propsPatch: Record<string, unknown>) {
  const operations: Array<{ op: 'set'; path: string; value: unknown }> = []
  walkProps(propsPatch, '', operations)
  return { schemaVersion: 1, mode: 'merge-patch', operations }
}

function walkProps(
  value: unknown,
  path: string,
  operations: Array<{ op: 'set'; path: string; value: unknown }>,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (path) operations.push({ op: 'set', path, value })
    return
  }
  for (const [key, child] of Object.entries(value)) {
    walkProps(child, path ? `${path}.${key}` : key, operations)
  }
}

function checksum(data: Uint8Array) {
  return `sha256:${sha256Bytes(data)}`
}

export function componentExportFileName(instance: ComponentInstance) {
  return `${sanitizeName(instance.componentName)}-${sanitizeName(instance.profile)}.zip`
}

export function buildStructuralExportPackage(document: DesignDocument, instanceId: string) {
  const instance = document.structuralInstances?.[instanceId]
  if (!instance) throw new Error(`结构实例不存在：${instanceId}`)
  const elements = document.elements.filter(
    (element) => element.componentBinding?.instanceId === instanceId,
  )
  const root = elements.find((element) => element.id === instance.rootElementId)
  const propsPatch = structuredClone(instance.propsPatch)
  const manifest = {
    schemaVersion: 1,
    kind: 'structural-instance',
    componentName: instance.componentName,
    nodeType: instance.nodeType,
    instanceId: instance.id,
    artboardId: instance.artboardId,
    rootElementId: instance.rootElementId,
    designPaths: instance.designPaths,
    bounds: root ? { x: root.x, y: root.y, width: root.width, height: root.height } : undefined,
    generatedAt: new Date().toISOString(),
  }
  return createZip([
    jsonEntry('manifest.json', manifest),
    jsonEntry('props.patch.json', propsPatch),
    jsonEntry('structure.json', {
      instance: structuralInstanceSummary(instance),
      elements: elements.map((element) => summarizeElementSource(element)),
    }),
  ])
}

export function structuralExportFileName(instance: StructuralInstance) {
  return `${sanitizeName(instance.componentName)}-${sanitizeName(instance.nodeType)}.zip`
}

function jsonEntry(name: string, value: unknown): ZipEntry {
  return { name, data: new TextEncoder().encode(JSON.stringify(value, null, 2)) }
}

function decodeDataUri(value: string) {
  const comma = value.indexOf(',')
  if (comma < 0) return new TextEncoder().encode(value)
  const metadata = value.slice(0, comma)
  const payload = value.slice(comma + 1)
  if (!metadata.includes(';base64')) return new TextEncoder().encode(decodeURIComponent(payload))
  const binary = atob(payload)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function assetFileName(label: string, source: string) {
  return `${sanitizeName(label) || 'asset'}.${extensionForDataUri(source)}`
}

function extensionForDataUri(value: string) {
  const mime = /^data:([^;,]+)/.exec(value)?.[1]
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/svg+xml') return 'svg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'png'
}

function sanitizeName(value: string) {
  return value
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '-')
    .replace(/^-|-$/g, '')
}

function setNestedValue(target: Record<string, unknown>, path: string, value: unknown) {
  const segments = path.split('.').filter(Boolean)
  let current = target
  for (const segment of segments.slice(0, -1)) {
    if (!current[segment] || typeof current[segment] !== 'object') current[segment] = {}
    current = current[segment] as Record<string, unknown>
  }
  if (segments.length) current[segments.at(-1)!] = value
}

function withoutDesign(instance: ComponentInstance) {
  return {
    id: instance.id,
    artboardId: instance.artboardId,
    rootElementId: instance.rootElementId,
    componentName: instance.componentName,
    profile: instance.profile,
  }
}

function structuralInstanceSummary(instance: StructuralInstance) {
  return {
    id: instance.id,
    artboardId: instance.artboardId,
    rootElementId: instance.rootElementId,
    componentName: instance.componentName,
    nodeType: instance.nodeType,
    designPaths: instance.designPaths,
  }
}

function summarizeElementSource<T extends { type: string }>(element: T) {
  if (element.type !== 'image') return element
  const image = element as T & { src: string }
  return { ...image, src: image.src.startsWith('data:') ? '[exported asset]' : image.src }
}
