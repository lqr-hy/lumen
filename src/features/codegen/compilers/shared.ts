import type { CodeDocument, CodeNode, CodeSourceMap } from '../types'

/**
 * 导出产物的基础样式。字体栈必须与编辑器 `_reset.scss` 一致 ——
 * 设计稿的文本尺寸和换行都基于该字体度量，缺失会让导出页面回退到衬线字体，
 * 与画布产生整体性偏差。
 */
export const CODEGEN_RESET_CSS = `*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; min-width: 0; }
body {
  overflow-x: hidden;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
button, input, textarea, select { margin: 0; font: inherit; color: inherit; }
button { padding: 0; border: 0; appearance: none; -webkit-appearance: none; background: none; }
img { display: block; max-width: none; }
`

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
/** IR 的 css 已是 kebab-case 且带单位，直接序列化即可。 */
export function cssStyle(css: Record<string, string>) {
  return Object.entries(css)
    .map(([property, value]) => `  ${property}: ${value};`)
    .join('\n')
}

/**
 * 节点的 CSS class。由 `assignClassNames` 预先分配并保证全局唯一 ——
 * 不能在此处按名称/id 哈希现算：哈希截断会让相似 id 碰撞，
 * 多个元素共用一条规则后互相覆盖，表现为元素堆叠或消失。
 */
export function boxClass(node: CodeNode) {
  if (!node.meta.className) throw new Error(`节点缺少 class 分配：${node.key}`)
  return node.meta.className
}

export function cssForNode(node: CodeNode) {
  return `.${boxClass(node)} {\n${cssStyle(node.css)}\n}`
}
export function sourceMapFor(
  document: CodeDocument,
  nodeIds: Array<{ id: string; file: string; line: number; kind: CodeSourceMap['kind'] }>,
) {
  return nodeIds.map((item) => ({
    nodeId: item.id,
    file: item.file,
    line: item.line,
    column: 1,
    kind: item.kind,
  }))
}
export function runtimePropsJson(name: string, props: Record<string, unknown>) {
  return `${name}Props = ${JSON.stringify(props, null, 2)}`
}
