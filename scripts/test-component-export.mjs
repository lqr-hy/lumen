import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(path.join(tmpdir(), 'component-export-test-'))
const outputFile = path.join(outputDirectory, 'component-export.mjs')

try {
  await build({
    stdin: {
      contents: `
        export * from './src/features/editor/utils/component-export.ts'
        export * from './src/features/editor/utils/component-instances.ts'
        export * from './src/features/editor/utils/document-inspector.ts'
        export * from './src/features/editor/utils/page-delivery.ts'
        export * from './src/features/editor/utils/sha256.ts'
      `,
      resolveDir: process.cwd(),
      sourcefile: 'component-export-test-entry.ts',
    },
    outfile: outputFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  })
  const {
    buildComponentExportPackage,
    createInspectorSnapshot,
    resolveComponentInstance,
    buildPageDeliveryPackage,
    reviewPageDelivery,
    sha256Bytes,
  } = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`)
  const document = createDocument()
  assert.equal(
    sha256Bytes(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'SHA-256 实现不正确',
  )

  assert.equal(resolveComponentInstance(document, ['slot-element'])?.id, 'instance-1')
  const bytes = buildComponentExportPackage(document, 'instance-1')
  assert.deepEqual(Array.from(bytes.slice(0, 2)), [0x50, 0x4b], '组件包必须是 ZIP')
  const archiveText = new TextDecoder().decode(bytes)
  for (const file of [
    'manifest.json',
    'props.patch.json',
    'blueprint.json',
    'component.structure.json',
    'props.diff.json',
    'theme.tokens.json',
    'quality.review.json',
    'runtime.validation.json',
    'design/visual-shell.png',
    'assets/抽一次.png',
  ]) assert.ok(archiveText.includes(file), `ZIP 缺少 ${file}`)
  assert.ok(archiveText.includes('styleConfig.drawOne.image'))
  assert.ok(archiveText.includes('assets/抽一次.png'))
  assert.ok(archiveText.includes('sha256:'))
  assert.ok(archiveText.includes('"schemaVersion": 3'))
  assert.equal(archiveText.includes('data:image/png;base64'), false, '导出 JSON 不得残留 Data URI')

  const snapshot = createInspectorSnapshot(document, 'document', [], 'artboard-1')
  const inspectorJson = JSON.stringify(snapshot)
  assert.equal(inspectorJson.includes('data:image/png;base64'), false, '检查器不得渲染 Base64')
  assert.ok(inspectorJson.includes('asset://'))

  const pageReview = reviewPageDelivery(document, 'artboard-1')
  assert.equal(pageReview.passed, true, '页面交付质量审查不应拒绝完整组件')
  const pageBytes = buildPageDeliveryPackage(document, 'artboard-1', {
    previews: {
      oneX: Uint8Array.from([137, 80, 78, 71, 1]),
      twoX: Uint8Array.from([137, 80, 78, 71, 2]),
    },
  })
  const pageArchiveText = new TextDecoder().decode(pageBytes)
  for (const file of [
    'manifest.json',
    'design-document.json',
    'page.blueprint.json',
    'theme.tokens.json',
    'quality.review.json',
    'runtime.validation.json',
    'components/instance-1/component.zip',
    'previews/page@1x.png',
    'previews/page@2x.png',
  ]) assert.ok(pageArchiveText.includes(file), `页面开发包缺少 ${file}`)
  assert.ok(pageArchiveText.includes('component-section-export'), '页面开发包没有写入 Page Blueprint')
  assert.ok(pageArchiveText.includes('sha256:'), '页面素材清单缺少 SHA-256 内容校验和')
  assert.ok(pageArchiveText.includes('"schemaVersion": 3'), '页面开发包 Schema 没有升级')
  assert.ok(pageArchiveText.includes('"deliveryStatus": "design-ready"'), '未接 Runtime 时应标记 design-ready')
  assert.ok(pageArchiveText.includes('"deliverable": false'), '未接 Runtime 时不得标记开发验证完成')
  assert.equal(pageArchiveText.includes('data:image/png;base64'), false, '页面 JSON 不得残留 Data URI')

  console.log(JSON.stringify({
    childSelectionResolution: true,
    zipPackage: true,
    relativePropsAssets: true,
    visualShellExport: true,
    inspectorDataUriSummary: true,
    pageDeliveryPackage: true,
    pageQualityReview: true,
    pagePreviews: true,
    pageAssetChecksums: true,
  }, null, 2))
} finally {
  await rm(outputDirectory, { recursive: true, force: true })
}

function createDocument() {
  const image = 'data:image/png;base64,aGVsbG8='
  const design = {
    instanceId: 'instance-1',
    componentName: 'EraLottery',
    profile: 'style-config',
    sourceHash: 'test',
    visualShell: { role: 'component-shell', generated: true },
    blueprint: {
      version: 1,
      componentName: 'EraLottery',
      profile: 'style-config',
      width: 375,
      height: 300,
      regions: [],
      propertyValues: {},
      diagnostics: [],
    },
    assetTasks: [{
      id: 'task-1',
      slotId: 'draw-one',
      label: '抽一次',
      propPath: 'styleConfig.drawOne.image',
      role: 'button',
      targetSize: { width: 100, height: 48 },
      transparent: true,
    }],
    propsPatch: { styleConfig: { drawOne: { image } } },
    unresolved: [],
    diagnostics: [],
  }
  return {
    id: 'document-1',
    title: 'Export Test',
    version: 1,
    artboards: [{
      id: 'artboard-1',
      name: '页面',
      x: 0,
      y: 0,
      width: 375,
      height: 812,
      background: '#fff',
      pageDesign: {
        blueprint: {
          version: 1,
          width: 375,
          estimatedHeight: 812,
          sections: [{
            id: 'component-section-export',
            role: '抽奖组件',
            kind: 'component-instance',
            bounds: { x: 0, y: 0, width: 375, height: 300 },
            source: 'component-thumbnail',
            component: { componentName: 'EraLottery', profile: 'style-config' },
          }],
          constraints: [],
        },
        qualityReview: {
          passed: true,
          scores: { structure: 1, theme: 0.8, readability: 1, completeness: 1, developmentReadiness: 0.8 },
          issues: [],
          repairCount: 0,
        },
      },
    }],
    elements: [
      componentElement('root-element', 'section', 'root', undefined, undefined),
      componentElement('shell-element', 'image', 'shell', undefined, image),
      componentElement('slot-element', 'image', 'generated-asset', 'draw-one', image),
    ],
    assets: [{ id: 'asset-1', type: 'image', name: '抽一次', src: image }],
    componentInstances: {
      'instance-1': {
        id: 'instance-1',
        artboardId: 'artboard-1',
        rootElementId: 'root-element',
        componentName: 'EraLottery',
        profile: 'style-config',
        design,
      },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function componentElement(id, type, renderMode, slotId, src) {
  return {
    id,
    artboardId: 'artboard-1',
    parentId: renderMode === 'root' ? undefined : 'root-element',
    type,
    name: id,
    x: 0,
    y: 0,
    width: 100,
    height: 48,
    zIndex: 1,
    ...(src ? { src, objectFit: 'fill' } : { label: 'root' }),
    componentBinding: {
      instanceId: 'instance-1',
      componentName: 'EraLottery',
      profile: 'style-config',
      regionId: id,
      slotId,
      renderMode,
      rootElementId: 'root-element',
      propPaths: [],
      bindings: slotId ? { image: 'styleConfig.drawOne.image' } : {},
    },
  }
}
