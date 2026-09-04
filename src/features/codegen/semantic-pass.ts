import type { CodeDiagnostic, CodeNode } from './types'
export function validateSemantics(nodes: CodeNode[]): CodeDiagnostic[] {
  const diagnostics: CodeDiagnostic[] = []
  for (const node of nodes) {
    if (node.meta.runtime) continue
    const nodeId = node.meta.elementId ?? node.key
    if (node.tag === 'img' && !node.attrs?.src)
      diagnostics.push({
        code: 'IMAGE_SOURCE_MISSING',
        severity: 'error',
        message: '图片节点缺少 src。',
        nodeId,
      })
    if (node.tag === 'button' && !node.text?.trim())
      diagnostics.push({
        code: 'BUTTON_LABEL_MISSING',
        severity: 'warning',
        message: '按钮缺少可读文案。',
        nodeId,
      })
  }
  return diagnostics
}
