import type { CodeDocument, CodeNode } from '../types'
import { boxClass, cssForNode, sourceMapFor, CODEGEN_RESET_CSS } from './shared'

export function compileReact(document: CodeDocument) {
  const maps: Array<{
    id: string
    file: string
    line: number
    kind: 'native' | 'runtime-component'
  }> = []
  const content = render(document.root, 2)
  const allNodes = flatten(document.root)
  const runtimeNodes = allNodes.filter((node) => node.meta.runtime)
  const props = runtimeNodes
    .map(
      (node) =>
        `const ${safeIdent(node.meta.runtime!.componentName)}Props = ${JSON.stringify(
          node.meta.runtime!.props,
          null,
          2,
        )} as const;`,
    )
    .join('\n')
  const files = [
    {
      path: 'src/App.tsx',
      language: 'tsx' as const,
      content: `import './styles.css';\n${props}\n\nfunction RuntimeComponent({ name, props }: { name: string; props: Record<string, unknown> }) {\n  return <div data-runtime-component={name} data-runtime-props={JSON.stringify(props)} />;\n}\n\nexport default function App() {\n  return (\n${content}\n  );\n}\n`,
    },
    {
      path: 'src/styles.css',
      language: 'css' as const,
      content: `${CODEGEN_RESET_CSS}${allNodes.map(cssForNode).join('\n')}`,
    },
    ...runtimeNodes.map((node) => ({
      path: `props/${boxClass(node)}.json`,
      language: 'json' as const,
      content: JSON.stringify(node.meta.runtime!.props, null, 2),
    })),
    {
      path: 'package.json',
      language: 'json' as const,
      content: JSON.stringify(
        {
          private: true,
          type: 'module',
          scripts: { dev: 'vite', build: 'tsc -b && vite build' },
          dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
          devDependencies: { vite: 'latest', typescript: 'latest' },
        },
        null,
        2,
      ),
    },
  ]
  return { files, sourceMap: sourceMapFor(document, maps) }

  function render(node: CodeNode, depth: number): string {
    maps.push({
      id: node.meta.elementId ?? node.key,
      file: 'src/App.tsx',
      line: depth + 3,
      kind: node.meta.runtime ? 'runtime-component' : 'native',
    })
    const indent = ' '.repeat(depth * 2)
    if (node.meta.runtime) {
      const runtime = node.meta.runtime
      return `${indent}<RuntimeComponent name={${JSON.stringify(
        runtime.componentName,
      )}} props={${safeIdent(runtime.componentName)}Props} />`
    }
    const attrs = Object.entries(node.attrs ?? {})
      .filter(([key]) => key !== 'data-element-id' && key !== 'data-artboard-id')
      .map(([key, value]) => `${reactAttr(key)}={${JSON.stringify(value)}}`)
    const props = [`className="${boxClass(node)}"`, ...attrs].join(' ')
    if (node.tag === 'img' || node.tag === 'input') return `${indent}<${node.tag} ${props} />`
    const child = node.children.length
      ? node.children.map((item) => render(item, depth + 1)).join('\n')
      : node.text
        ? `${indent}  {${JSON.stringify(node.text)}}`
        : ''
    return `${indent}<${node.tag} ${props}>${child ? `\n${child}\n${indent}` : ''}</${node.tag}>`
  }
}

/** JSX 保留 data- 与 aria- 前缀属性原样，其余转 camelCase。 */
function reactAttr(key: string) {
  if (key.startsWith('data-') || key.startsWith('aria-')) return key
  if (key === 'value') return 'defaultValue'
  return key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}
function flatten(node: CodeNode): CodeNode[] {
  return [node, ...node.children.flatMap(flatten)]
}
function safeIdent(value: string) {
  const name = value.replace(/[^a-zA-Z0-9_$]/g, '_')
  return /^[a-zA-Z_$]/.test(name) ? name : `Component_${name}`
}
