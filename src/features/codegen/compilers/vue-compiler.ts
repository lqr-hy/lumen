import type { CodeDocument, CodeNode } from '../types'
import { boxClass, cssForNode, escapeHtml, sourceMapFor, CODEGEN_RESET_CSS } from './shared'

export function compileVue(document: CodeDocument) {
  const maps: Array<{
    id: string
    file: string
    line: number
    kind: 'native' | 'runtime-component'
  }> = []
  const template = render(document.root, 1)
  const allNodes = flatten(document.root)
  const runtimeNodes = allNodes.filter((node) => node.meta.runtime)
  const props = runtimeNodes
    .map(
      (node) =>
        `const ${safeIdent(node.meta.runtime!.componentName)}Props = ${JSON.stringify(
          node.meta.runtime!.props,
          null,
          2,
        )} as const`,
    )
    .join('\n')
  const files = [
    {
      path: 'src/App.vue',
      language: 'vue' as const,
      content: `<script setup lang="ts">\n${props}\n</script>\n\n<template>\n${template}\n</template>\n\n<style>\n${CODEGEN_RESET_CSS}${allNodes.map(cssForNode).join('\n')}\n</style>\n`,
    },
    {
      path: 'package.json',
      language: 'json' as const,
      content: JSON.stringify(
        {
          private: true,
          type: 'module',
          scripts: { dev: 'vite', build: 'vite build' },
          dependencies: { vue: '^3.5.0' },
          devDependencies: { vite: 'latest', '@vitejs/plugin-vue': 'latest' },
        },
        null,
        2,
      ),
    },
    ...runtimeNodes.map((node) => ({
      path: `props/${boxClass(node)}.json`,
      language: 'json' as const,
      content: JSON.stringify(node.meta.runtime!.props, null, 2),
    })),
  ]
  return { files, sourceMap: sourceMapFor(document, maps) }

  function render(node: CodeNode, depth: number): string {
    maps.push({
      id: node.meta.elementId ?? node.key,
      file: 'src/App.vue',
      line: depth + 5,
      kind: node.meta.runtime ? 'runtime-component' : 'native',
    })
    const indent = ' '.repeat(depth * 2)
    const className = boxClass(node)
    if (node.meta.runtime) {
      const runtime = node.meta.runtime
      return `${indent}<div class="${className}" data-runtime-component="${escapeHtml(runtime.componentName)}" :data-runtime-props="JSON.stringify(${safeIdent(runtime.componentName)}Props)" />`
    }
    const attrs = Object.entries(node.attrs ?? {})
      .filter(([key]) => key !== 'data-element-id' && key !== 'data-artboard-id')
      .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
      .join('')
    if (node.tag === 'img' || node.tag === 'input')
      return `${indent}<${node.tag} class="${className}"${attrs} />`
    const child = node.children.length
      ? node.children.map((item) => render(item, depth + 1)).join('\n')
      : node.text
        ? `${indent}  ${escapeHtml(node.text)}`
        : ''
    return `${indent}<${node.tag} class="${className}"${attrs}>${child ? `\n${child}\n${indent}` : ''}</${node.tag}>`
  }
}

function flatten(node: CodeNode): CodeNode[] {
  return [node, ...node.children.flatMap(flatten)]
}
function safeIdent(value: string) {
  const name = value.replace(/[^a-zA-Z0-9_$]/g, '_')
  return /^[a-zA-Z_$]/.test(name) ? name : `Component_${name}`
}
