import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(path.join(tmpdir(), 'ai-campaign-canvas-performance-'))
const outputFile = path.join(outputDirectory, 'canvas-performance.mjs')

try {
  await build({
    stdin: {
      contents: [
        "export * from './src/features/editor/utils/canvas-visibility.ts'",
        "export * from './src/features/editor/utils/layer-index.ts'",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'canvas-performance-test-entry.ts',
    },
    outfile: outputFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  })
  const {
    buildLayerIndex,
    rectIntersectsWorldBounds,
    resolveVisibleArtboards,
    resolveVisibleWorldBounds,
  } = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`)

  const bounds = resolveVisibleWorldBounds(
    { x: 100, y: 50, zoom: 0.5 },
    { width: 1000, height: 800 },
    100,
  )
  assert.deepEqual(bounds, { left: -400, top: -300, right: 2000, bottom: 1700 })

  const artboards = [board('visible', 0, 0), board('outside', 4000, 0), board('retained', 8000, 0)]
  assert.deepEqual(
    resolveVisibleArtboards(artboards, bounds, new Set(['retained'])).map((item) => item.id),
    ['visible', 'retained'],
  )
  assert.equal(rectIntersectsWorldBounds({ x: 1999, y: 0, width: 10, height: 10 }, bounds), true)
  assert.equal(rectIntersectsWorldBounds({ x: 2100, y: 0, width: 10, height: 10 }, bounds), false)
  assert.equal(resolveVisibleArtboards(artboards, undefined, new Set()).length, 3)

  const elements = [
    shape('root-a', 'a', undefined, 1),
    shape('child-a', 'a', 'root-a', 2),
    shape('root-b', 'b', undefined, 1),
    shape('orphan', 'a', 'missing', 3),
    shape('cross-board', 'b', 'root-a', 4),
  ]
  const index = buildLayerIndex(elements)
  assert.deepEqual(
    index.rootsByArtboard.get('a').map((item) => item.id),
    ['orphan', 'root-a'],
  )
  assert.deepEqual(
    index.rootsByArtboard.get('b').map((item) => item.id),
    ['cross-board', 'root-b'],
  )
  assert.deepEqual(
    index.childrenByParent.get('root-a').map((item) => item.id),
    ['child-a'],
  )

  console.log('Canvas performance tests passed.')
} finally {
  await rm(outputDirectory, { recursive: true, force: true })
}

function board(id, x, y) {
  return { id, name: id, x, y, width: 375, height: 812, background: '#fff' }
}

function shape(id, artboardId, parentId, zIndex) {
  return {
    id,
    artboardId,
    parentId,
    type: 'shape',
    name: id,
    label: id,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    zIndex,
    shape: 'rect',
    fill: '#fff',
  }
}
