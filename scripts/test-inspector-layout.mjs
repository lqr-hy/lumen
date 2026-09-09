import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumen-inspector-layout-'))
const bundle = path.join(root, 'auto-layout.mjs')

try {
  await build({
    stdin: {
      contents:
        "export { layoutSection, layoutSectionChildren } from './src/features/editor/utils/auto-layout.ts'",
      resolveDir: process.cwd(),
      sourcefile: 'inspector-layout-test-entry.ts',
    },
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
  })
  const { layoutSection, layoutSectionChildren } = await import(
    `${pathToFileURL(bundle).href}?t=${Date.now()}`
  )
  const section = {
    id: 'section',
    type: 'section',
    name: '容器',
    label: '容器',
    x: 0,
    y: 0,
    width: 400,
    height: 100,
    zIndex: 1,
    autoLayout: {
      direction: 'horizontal',
      gap: 10,
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      align: 'center',
      justify: 'start',
    },
  }
  const children = [
    {
      id: 'fixed',
      parentId: 'section',
      type: 'shape',
      name: '固定',
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      zIndex: 2,
      shape: 'rect',
      fill: '#fff',
    },
    {
      id: 'fill',
      parentId: 'section',
      type: 'shape',
      name: '填充',
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      zIndex: 3,
      shape: 'rect',
      fill: '#fff',
      layoutSizing: { widthMode: 'fill', heightMode: 'fill' },
    },
  ]
  const patches = layoutSectionChildren(section, [section, ...children])
  assert.deepEqual(patches[0].patch, { x: 10, y: 30, width: 100, height: 40 })
  assert.deepEqual(patches[1].patch, { x: 120, y: 10, width: 270, height: 80 })

  const hugSection = {
    ...section,
    id: 'hug-section',
    width: 300,
    height: 300,
    layoutSizing: { widthMode: 'hug', heightMode: 'hug' },
    autoLayout: { ...section.autoLayout, direction: 'vertical' },
  }
  const hugText = {
    id: 'hug-text',
    parentId: 'hug-section',
    type: 'text',
    name: '标题',
    content: '五个字标题',
    x: 0,
    y: 0,
    width: 200,
    height: 50,
    zIndex: 2,
    layoutSizing: { widthMode: 'hug', heightMode: 'hug' },
    style: { fontSize: 20, color: '#111827' },
  }
  const hugLayout = layoutSection(hugSection, [hugSection, hugText])
  assert.equal(Math.round(hugLayout.sectionPatch.width * 10) / 10, 80)
  assert.equal(hugLayout.sectionPatch.height, 48)
  assert.equal(Math.round(hugLayout.childPatches[0].patch.width * 10) / 10, 60)
  assert.equal(hugLayout.childPatches[0].patch.height, 28)

  console.log(
    JSON.stringify(
      {
        fourEdgePadding: true,
        fillRemainingSpace: true,
        crossAxisAlignment: true,
        intrinsicHugSizing: true,
      },
      null,
      2,
    ),
  )
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
