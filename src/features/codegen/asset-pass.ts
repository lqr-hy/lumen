import type { DesignElement } from '../editor/types'
import type { CodeAsset, CodeDependency, CodeDiagnostic } from './types'
import { sha256Bytes } from '../editor/utils/sha256'

export function collectAssets(elements: DesignElement[], mode: 'remote' | 'download' = 'remote') {
  const assets: CodeAsset[] = []
  const dependencies: CodeDependency[] = []
  const diagnostics: CodeDiagnostic[] = []
  const seen = new Set<string>()
  for (const element of elements) {
    if (element.type !== 'image' || !element.src || seen.has(element.src)) continue
    seen.add(element.src)
    if (element.src.startsWith('data:')) {
      const bytes = decodeDataUri(element.src)
      const path = `assets/${element.id}-${sha256Bytes(bytes).slice(
        0,
        12,
      )}.${extension(element.src)}`
      assets.push({
        id: element.id,
        source: element.src,
        path,
        kind: 'data-uri',
        bytes: bytes.length,
      })
    } else if (/^https?:\/\//i.test(element.src)) {
      assets.push({
        id: element.id,
        source: element.src,
        path: element.src,
        kind: 'remote',
      })
      diagnostics.push({
        code: mode === 'download' ? 'REMOTE_ASSET_NOT_DOWNLOADED' : 'REMOTE_ASSET',
        severity: 'warning',
        message: mode === 'download'
          ? `图片 ${element.id} 使用远程地址，当前导出不会伪造本地文件；需要联网或接入资源下载器。`
          : `图片 ${element.id} 使用远程地址，导出包可能无法离线复现。`,
        nodeId: element.id,
      })
    } else
      diagnostics.push({
        code: 'ASSET_SOURCE_UNKNOWN',
        severity: 'warning',
        message: `无法识别图片资源：${element.id}`,
        nodeId: element.id,
      })
  }
  return { assets, dependencies, diagnostics }
}
function decodeDataUri(value: string) {
  const comma = value.indexOf(',')
  const body = value.slice(comma + 1)
  if (!value.slice(0, comma).includes(';base64'))
    return new TextEncoder().encode(decodeURIComponent(body))
  const binary = atob(body)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}
function extension(value: string) {
  const mime = /^data:([^;,]+)/.exec(value)?.[1] ?? ''
  return mime.includes('jpeg')
    ? 'jpg'
    : mime.includes('svg')
      ? 'svg'
      : mime.includes('webp')
        ? 'webp'
        : 'png'
}
