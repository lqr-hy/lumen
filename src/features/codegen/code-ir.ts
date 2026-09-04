import type { DesignDocument } from '../editor/types'
import { collectAssets } from './asset-pass'
import { assignClassNames } from './class-pass'
import { collectComponentDependencies } from './component-pass'
import { normalizeLayout } from './layout-pass'
import { normalizeScene } from './normalize-scene'
import { validateSemantics } from './semantic-pass'
import type { CodeDocument, CodegenOptions } from './types'
import { compileHtml } from './compilers/html-compiler'
import { compileReact } from './compilers/react-compiler'
import { compileVue } from './compilers/vue-compiler'

export function buildCodeDocument(document: DesignDocument, options: CodegenOptions): CodeDocument {
  const scene = normalizeScene(document, options.artboardId, options.selectionIds)
  normalizeLayout(scene.nodes)
  // 必须在任何 compiler 读取 class 之前分配，且保证唯一。
  assignClassNames(scene.root)
  const component = collectComponentDependencies(scene.nodes)
  const asset = collectAssets(
    document.elements.filter(
      (item) => (item.artboardId ?? scene.artboard.id) === scene.artboard.id,
    ),
    options.assetMode,
  )
  const assetPaths = new Map(asset.assets.map((item) => [item.source, item.path]))
  for (const node of scene.nodes) {
    if (node.tag === 'img' && node.attrs?.src)
      node.attrs.src = assetPaths.get(node.attrs.src) ?? node.attrs.src
  }
  const diagnostics = [
    ...scene.diagnostics,
    ...component.diagnostics,
    ...asset.diagnostics,
    ...validateSemantics(scene.nodes),
  ]
  const base: CodeDocument = {
    version: 1,
    framework: options.framework,
    entryFile:
      options.framework === 'html'
        ? 'index.html'
        : options.framework === 'react'
          ? 'src/App.tsx'
          : 'src/App.vue',
    files: [],
    root: scene.root,
    assets: asset.assets,
    dependencies: [...component.dependencies, ...asset.dependencies],
    diagnostics,
    sourceMap: [],
    meta: {
      documentId: document.id,
      artboardId: scene.artboard.id,
      title: document.title,
      surface: { width: scene.artboard.width, height: scene.artboard.height },
    },
  }
  const compiled =
    options.framework === 'html'
      ? compileHtml(base)
      : options.framework === 'react'
        ? compileReact(base)
        : compileVue(base)
  return { ...base, ...compiled }
}
