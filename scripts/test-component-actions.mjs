import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(path.join(tmpdir(), 'component-actions-test-'))
const outputFile = path.join(outputDirectory, 'component-actions.mjs')

try {
  await build({
    entryPoints: ['src/features/editor/utils/component-edit-scope.ts'],
    outfile: outputFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  })

  const actions = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`)
  const root = createElement('section', 'root', {})
  const slot = createElement('image', 'generated-asset', { image: 'styleConfig.drawOne.image' })
  const shell = createElement('image', 'shell', {})
  const ordinaryImage = { ...slot, componentBinding: undefined }

  assert.equal(actions.isComponentRootElement(root), true)
  assert.equal(actions.isComponentRootElement(slot), false)
  assert.equal(actions.canRegenerateComponentSlot(slot), true)
  assert.equal(actions.canRegenerateComponentSlot(shell), false)
  assert.equal(actions.canRegenerateComponentSlot(ordinaryImage), false)
  assert.equal(actions.createComponentSlotRegenerationText(slot), '仅重新生成选中的 draw-one 素材')

  console.log(JSON.stringify({
    rootOwnsPropsPatch: true,
    imageSlotRegeneration: true,
    shellExcluded: true,
    ordinaryImageExcluded: true,
  }, null, 2))
} finally {
  await rm(outputDirectory, { recursive: true, force: true })
}

function createElement(type, renderMode, bindings) {
  return {
    id: `${renderMode}-element`,
    type,
    name: renderMode,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    zIndex: 1,
    componentBinding: {
      instanceId: 'instance-1',
      componentName: 'EraLottery',
      profile: 'default',
      regionId: renderMode === 'generated-asset' ? 'draw-one' : renderMode,
      slotId: renderMode === 'root' ? undefined : `${renderMode}-slot`,
      renderMode,
      rootElementId: 'root-element',
      propPaths: Object.values(bindings),
      bindings,
    },
  }
}
