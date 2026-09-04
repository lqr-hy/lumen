import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  configureComponentPackRuntime,
  executeComponentPackExportAdapter,
  importProjectComponent,
  listComponentPacks,
  listPublicComponentPacks,
  loadComponentFromPrompt,
  resolveComponentReference,
  resolveLoadedComponentPackTool,
} from '../electron/runtime/component-packs.mjs'
import { configureSkillRuntime, resolveSkillNames } from '../electron/runtime/skills.mjs'

const appRoot = path.resolve(import.meta.dirname, '..')
const originalFetch = globalThis.fetch
const originalWarn = console.warn
const roots = []
const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'component-pack-project-import-'))
roots.push(testRoot)

try {
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    url: String(url),
    headers: new Headers({ 'content-type': 'image/png' }),
    arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
  })

  configureComponentPackRuntime({
    appRoot,
    resourcesPath: appRoot,
    userDataPath: testRoot,
    isPackaged: false,
  })
  const builtIn = await listPublicComponentPacks()
  assert.equal(
    builtIn.some((pack) => pack.id === 'campaign-components'),
    true,
  )

  const lottery = await loadComponentFromPrompt('使用 EraLottery.json 生成抽奖组件')
  assert.equal(lottery.pack.id, 'campaign-components')
  assert.equal(
    resolveLoadedComponentPackTool(lottery, 'resolveContract'),
    'component-design-assets.resolve-contract',
  )
  const imported = await importProjectComponent({
    projectId: 'component-pack-test-project',
    fileName: 'ImportedCard.json',
    source: JSON.stringify({
      name: 'ImportedCard',
      label: '导入卡片',
      thumbnail: 'https://i0.hdslb.com/bfs/activity-plat/imported-card.png',
      props: { width: 375, height: 240, backgroundImage: '' },
    }),
  })
  assert.equal(imported.packId, 'project-imports')
  const importedPacks = await listPublicComponentPacks('component-pack-test-project')
  assert.equal(
    importedPacks.some((pack) => pack.components.some((item) => item.name === 'ImportedCard')),
    true,
  )
  const importedLoaded = await resolveComponentReference(
    {
      packId: 'project-imports',
      componentName: 'ImportedCard',
    },
    { projectId: 'component-pack-test-project' },
  )
  assert.equal(importedLoaded.component.name, 'ImportedCard')
  await assert.rejects(
    () =>
      resolveComponentReference(
        { packId: 'project-imports', componentName: 'MissingCard' },
        {
          projectId: 'component-pack-test-project',
        },
      ),
    (error) => error?.code === 'COMPONENT_RESOLVE_FAILED',
  )
  await assert.rejects(
    () =>
      importProjectComponent({
        projectId: 'component-pack-test-project',
        fileName: 'EraLottery.json',
        source: JSON.stringify({ name: 'EraLottery', props: {} }),
      }),
    (error) => error?.code === 'COMPONENT_IMPORT_CONFLICT',
  )
  await assert.rejects(
    () => loadComponentFromPrompt('使用 EvaPage.json 生成组件'),
    (error) => error?.code === 'COMPONENT_STRUCTURAL_ONLY',
  )
  const structural = await importStructuralComponent('使用 EvaPage.json 生成页面')
  assert.equal(structural.component.name, 'EvaPage')
  assert.equal(structural.descriptor.kind, 'structural')

  const nativeRoot = await createNativePackFixture()
  roots.push(nativeRoot)
  configureComponentPackRuntime({
    appRoot: nativeRoot,
    resourcesPath: nativeRoot,
    isPackaged: false,
  })
  const native = await importStructuralComponent('生成 DemoContainer 组件')
  assert.equal(native.component.name, 'DemoContainer')
  assert.equal(native.pack.id, 'demo-pack')
  assert.equal(native.pack.skill.tools.resolveContract, 'demo-design.resolve-contract')
  const standardPackage = Uint8Array.from([0x50, 0x4b, 3, 4, 1])
  const adapted = await executeComponentPackExportAdapter({
    packId: 'demo-pack',
    componentName: 'DemoContainer',
    profile: 'default',
    standardPackage,
  })
  assert.equal(adapted.applied, true)
  assert.deepEqual(Array.from(adapted.package), Array.from(standardPackage))
  await assert.rejects(
    () =>
      executeComponentPackExportAdapter({
        packId: 'demo-pack',
        componentName: 'DemoContainer',
        profile: 'invalid-output',
        standardPackage,
      }),
    (error) => error?.code === 'COMPONENT_EXPORT_ADAPTER_OUTPUT_INVALID',
  )

  await fs.writeFile(path.join(nativeRoot, 'component-packs/demo-pack/components/broken.json'), '{')
  assert.equal((await listComponentPacks({ refresh: true })).length, 1)

  await createSkillFixture(nativeRoot)
  configureSkillRuntime({ appRoot: nativeRoot, resourcesPath: nativeRoot, isPackaged: false })
  assert.deepEqual(await resolveSkillNames('生成 DemoContainer 组件'), ['demo-design'])

  const unsafeRoot = await createUnsafePackFixture()
  roots.push(unsafeRoot)
  configureComponentPackRuntime({
    appRoot: unsafeRoot,
    resourcesPath: unsafeRoot,
    isPackaged: false,
  })
  console.warn = () => {}
  assert.deepEqual(await listComponentPacks(), [])
  console.warn = originalWarn

  const conflictRoot = await createConflictPackFixture()
  roots.push(conflictRoot)
  configureComponentPackRuntime({
    appRoot: conflictRoot,
    resourcesPath: conflictRoot,
    isPackaged: false,
  })
  await assert.rejects(
    () => listComponentPacks(),
    /组件选择器 democontainer 同时由 first-pack\/DemoContainer 和 second-pack\/DemoContainer 声明/,
  )

  console.log(
    JSON.stringify(
      {
        builtInDiscovery: true,
        manifestToolResolution: true,
        structuralGuard: true,
        nativePackSource: true,
        noDirectoryScan: true,
        skillActivation: true,
        pathBoundary: true,
        duplicateGuard: true,
        exportAdapter: true,
        projectComponentImport: true,
        structuredComponentResolution: true,
      },
      null,
      2,
    ),
  )
} finally {
  globalThis.fetch = originalFetch
  console.warn = originalWarn
  configureSkillRuntime({ appRoot, resourcesPath: appRoot, isPackaged: false })
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })))
}

async function importStructuralComponent(prompt) {
  const { loadComponentsFromPrompt } = await import('../electron/runtime/component-packs.mjs')
  const matches = await loadComponentsFromPrompt(prompt, { allowStructuralComponents: true })
  assert.equal(matches.length, 1)
  return matches[0]
}

async function createNativePackFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-pack-native-'))
  const packRoot = path.join(root, 'component-packs', 'demo-pack')
  await fs.mkdir(path.join(packRoot, 'components'), { recursive: true })
  await fs.writeFile(
    path.join(packRoot, 'manifest.json'),
    JSON.stringify(
      {
        version: 1,
        id: 'demo-pack',
        label: 'Demo Pack',
        source: { kind: 'pack', root: 'components' },
        skill: {
          name: 'demo-design',
          tools: { resolveContract: 'demo-design.resolve-contract' },
        },
        exportAdapter: 'export-adapter.mjs',
        components: [
          {
            name: 'DemoContainer',
            file: 'DemoContainer.json',
            kind: 'structural',
            aliases: ['演示容器'],
          },
        ],
      },
      null,
      2,
    ),
  )
  await fs.writeFile(
    path.join(packRoot, 'components', 'DemoContainer.json'),
    JSON.stringify({
      name: 'DemoContainer',
      props: { width: 375, height: 240 },
    }),
  )
  await fs.writeFile(
    path.join(packRoot, 'export-adapter.mjs'),
    [
      'export function adaptComponentExport(input) {',
      "  if (input.profile === 'invalid-output') return new Uint8Array([1, 2, 3])",
      '  return input.standardPackage',
      '}',
    ].join('\n'),
  )
  return root
}

async function createSkillFixture(root) {
  const skillRoot = path.join(root, '.agents', 'skills', 'demo-design')
  await fs.mkdir(skillRoot, { recursive: true })
  await fs.writeFile(
    path.join(skillRoot, 'SKILL.md'),
    [
      '---',
      'name: demo-design',
      'description: 处理 Demo Component Pack。',
      '---',
      '',
      '# Demo Design',
    ].join('\n'),
  )
}

async function createUnsafePackFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-pack-unsafe-'))
  const packRoot = path.join(root, 'component-packs', 'unsafe-pack')
  await fs.mkdir(path.join(packRoot, 'components'), { recursive: true })
  await fs.writeFile(
    path.join(packRoot, 'manifest.json'),
    JSON.stringify({
      version: 1,
      id: 'unsafe-pack',
      source: { kind: 'pack', root: 'components' },
      skill: { name: 'unsafe', tools: { resolveContract: 'unsafe.resolve-contract' } },
      exportAdapter: '../outside.mjs',
      components: [{ name: 'UnsafeComponent', file: 'UnsafeComponent.json', kind: 'structural' }],
    }),
  )
  return root
}

async function createConflictPackFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-pack-conflict-'))
  for (const id of ['first-pack', 'second-pack']) {
    const packRoot = path.join(root, 'component-packs', id)
    await fs.mkdir(path.join(packRoot, 'components'), { recursive: true })
    await fs.writeFile(
      path.join(packRoot, 'manifest.json'),
      JSON.stringify({
        version: 1,
        id,
        source: { kind: 'pack', root: 'components' },
        skill: { name: `${id}-skill`, tools: { resolveContract: `${id}.resolve-contract` } },
        components: [{ name: 'DemoContainer', file: 'DemoContainer.json', kind: 'structural' }],
      }),
    )
  }
  return root
}
