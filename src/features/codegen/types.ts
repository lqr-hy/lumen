import type { DesignDocument, DesignElement } from '../editor/types'
import type { RenderBox } from '../editor/render/render-box'

export type CodeFramework = 'html' | 'react' | 'vue'
export type CodeLanguage = 'html' | 'tsx' | 'vue' | 'css' | 'ts' | 'json'

export interface CodeFile {
  path: string
  language: CodeLanguage
  content: string
}
export interface CodeAsset {
  id: string
  source: string
  path: string
  kind: 'data-uri' | 'remote'
  bytes?: number
}
export interface CodeDependency {
  name: string
  kind: 'runtime-component' | 'stylesheet' | 'script' | 'font'
  source?: string
  required: boolean
}
export interface CodeDiagnostic {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  nodeId?: string
  path?: string
}
export interface CodeSourceMap {
  nodeId: string
  file: string
  line: number
  column: number
  kind: 'native' | 'runtime-component'
}

/**
 * 代码节点即 Render IR 的 box。样式真源在 `render-box.ts`，此处不再维护
 * 独立的样式白名单 —— 白名单会让新增视觉属性被静默丢弃。
 */
export type CodeNode = RenderBox

/** `meta.runtime` 存在即 Runtime Component 实例根节点。 */
export function isRuntimeNode(node: CodeNode): boolean {
  return Boolean(node.meta.runtime)
}

export interface CodeDocument {
  version: 1
  framework: CodeFramework
  entryFile: string
  files: CodeFile[]
  root: CodeNode
  assets: CodeAsset[]
  dependencies: CodeDependency[]
  diagnostics: CodeDiagnostic[]
  sourceMap: CodeSourceMap[]
  meta: {
    documentId: string
    artboardId: string
    title: string
    surface: { width: number; height: number }
  }
}

export interface CodegenOptions {
  framework: CodeFramework
  artboardId?: string
  assetMode?: 'remote' | 'download'
  selectionIds?: string[]
}
export interface CodegenResult {
  document: CodeDocument
  zip: Uint8Array
}
export type CodegenInput = Pick<
  DesignDocument,
  'id' | 'title' | 'artboards' | 'elements' | 'assets' | 'componentInstances'
>
export type CodegenElement = DesignElement
