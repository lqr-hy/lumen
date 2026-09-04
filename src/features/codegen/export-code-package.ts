import type { DesignDocument } from '../editor/types'
import { createZip, type ZipEntry } from '../editor/utils/zip'
import { buildCodeDocument } from './code-ir'
import { validateCodeDocument } from './validators/code-validator'
import { formatCodeDocument } from './format-code'
import type { CodegenOptions } from './types'

export async function buildCodeExportPackage(document: DesignDocument, options: CodegenOptions) {
  const code = await formatCodeDocument(buildCodeDocument(document, options))
  const validation = validateCodeDocument(code)
  const entries: ZipEntry[] = code.files.map((file) => ({
    name: file.path,
    data: new TextEncoder().encode(file.content),
  }))
  for (const asset of code.assets)
    if (asset.kind === 'data-uri')
      entries.push({ name: asset.path, data: decodeDataUri(asset.source) })
  entries.push(
    jsonEntry('codegen.manifest.json', {
      version: 1,
      framework: options.framework,
      entryFile: code.entryFile,
      meta: code.meta,
      assets: code.assets,
      dependencies: code.dependencies,
      diagnostics: validation.diagnostics,
    }),
    jsonEntry('source-map.json', code.sourceMap),
  )
  return {
    bytes: createZip(entries),
    document: { ...code, diagnostics: validation.diagnostics },
    validation,
  }
}
export function codeExportFileName(
  document: DesignDocument,
  framework: CodegenOptions['framework'],
) {
  const name =
    document.title
      .trim()
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-')
      .replace(/^-|-$/g, '') || 'design'
  return `${name}-${framework}.zip`
}
function jsonEntry(name: string, value: unknown): ZipEntry {
  return {
    name,
    data: new TextEncoder().encode(JSON.stringify(value, null, 2)),
  }
}
function decodeDataUri(value: string) {
  const comma = value.indexOf(',')
  if (comma < 0) return new TextEncoder().encode(value)
  const meta = value.slice(0, comma)
  const body = value.slice(comma + 1)
  if (!meta.includes(';base64')) return new TextEncoder().encode(decodeURIComponent(body))
  const binary = atob(body)
  return Uint8Array.from(binary, (item) => item.charCodeAt(0))
}
