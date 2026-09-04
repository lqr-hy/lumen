import type { DesignDocument } from '../editor/types'
import { buildCodeDocument } from './code-ir'
import { buildCodeExportPackage, codeExportFileName } from './export-code-package'
import { formatCodeDocument } from './format-code'
import type { CodeDocument, CodeFramework, CodegenOptions } from './types'

export interface CodeCompiler {
  framework: CodeFramework
  compile(document: DesignDocument, options?: Omit<CodegenOptions, 'framework'>): CodeDocument
}
export const codeCompilerRegistry: Record<CodeFramework, CodeCompiler> = {
  html: {
    framework: 'html',
    compile: (document, options) => buildCodeDocument(document, { ...options, framework: 'html' }),
  },
  react: {
    framework: 'react',
    compile: (document, options) => buildCodeDocument(document, { ...options, framework: 'react' }),
  },
  vue: {
    framework: 'vue',
    compile: (document, options) => buildCodeDocument(document, { ...options, framework: 'vue' }),
  },
}
export function compileForFramework(
  document: DesignDocument,
  framework: CodeFramework,
  options: Omit<CodegenOptions, 'framework'> = {},
) {
  return codeCompilerRegistry[framework].compile(document, options)
}
export { buildCodeDocument, buildCodeExportPackage }
export { formatCodeDocument }
export { codeExportFileName }
export type * from './types'
