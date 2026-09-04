import type { CodeDocument, CodeNode } from '../types'
import { boxClass, cssForNode, escapeHtml, sourceMapFor, CODEGEN_RESET_CSS } from './shared'

export function compileHtml(document: CodeDocument) {
  const maps: Array<{
    id: string
    file: string
    line: number
    kind: 'native' | 'runtime-component'
  }> = []
  // 递归输出嵌套 DOM。不再拍平 —— 拍平会丢失 section 裁剪、autoLayout flex、
  // 父级 opacity/transform 继承，以及 z-index 的层叠上下文语义。
  const body = renderNode(document.root)
  const allNodes = flatten(document.root)
  const runtimeNodes = allNodes.filter((node) => node.meta.runtime)
  const css = document.files.find((file) => file.path === 'styles.css')?.content ?? ''
  const runtimeProps = runtimeNodes.map((node) => ({
    path: `props/${boxClass(node)}.json`,
    language: 'json' as const,
    content: JSON.stringify(node.meta.runtime?.props ?? {}, null, 2),
  }))
  const files = [
    {
      path: 'index.html',
      language: 'html' as const,
      content: `<!doctype html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(
        document.meta.title,
      )}</title><link rel="stylesheet" href="styles.css"></head><body><div id="codegen-root">${body}</div></body></html>\n`,
    },
    {
      path: 'styles.css',
      language: 'css' as const,
      content: `${CODEGEN_RESET_CSS}#codegen-root, #code-preview-root { position: relative; width: ${document.meta.surface.width}px; min-height: ${document.meta.surface.height}px; overflow: hidden; background: #fff; }\n${css}\n${allNodes
        .map(cssForNode)
        .join('\n')}\n`,
    },
    ...runtimeProps,
    {
      path: 'components.manifest.json',
      language: 'json' as const,
      content: JSON.stringify(
        {
          dependencies: document.dependencies,
          diagnostics: document.diagnostics,
        },
        null,
        2,
      ),
    },
  ]
  return { files, sourceMap: sourceMapFor(document, maps) }

  function renderNode(node: CodeNode): string {
    maps.push({
      id: node.meta.elementId ?? node.key,
      file: 'index.html',
      line: 1,
      kind: node.meta.runtime ? 'runtime-component' : 'native',
    })
    const className = boxClass(node)
    const idAttr = node.meta.elementId
      ? ` data-node-id="${escapeHtml(node.meta.elementId)}"`
      : ''
    if (node.meta.runtime) {
      const runtime = node.meta.runtime
      return `<div class="${className}"${idAttr} data-runtime-component="${escapeHtml(
        runtime.componentName,
      )}" data-props-ref="props/${className}.json"></div>`
    }
    const attrs = Object.entries(node.attrs ?? {})
      .filter(([key]) => key !== 'data-element-id' && key !== 'data-artboard-id')
      .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
      .join('')
    if (node.tag === 'img' || node.tag === 'input')
      return `<${node.tag} class="${className}"${idAttr}${attrs}>`
    const inner = node.children.length
      ? node.children.map(renderNode).join('')
      : node.text
        ? escapeHtml(node.text)
        : ''
    return `<${node.tag} class="${className}"${idAttr}${attrs}>${inner}</${node.tag}>`
  }
}

function flatten(node: CodeNode): CodeNode[] {
  return [node, ...node.children.flatMap(flatten)]
}
