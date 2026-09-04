import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import {
  inspectRuntimeDomToScene,
  runtimeDomInspectionToSceneGraph,
} from '../electron/runtime/runtime-dom-adapter.mjs'

let failure
try {
  await Promise.race([
    app.whenReady(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Electron app.whenReady 超过 15 秒。')), 15_000),
    ),
  ])
  const syntheticScene = runtimeDomInspectionToSceneGraph(
    {
      designTree: {
        version: 1,
        componentName: 'SyntheticRuntime',
        width: 375,
        height: 240,
        nodes: [
          {
            id: 'root',
            type: 'container',
            role: '根节点',
            bounds: { x: 0, y: 0, width: 375, height: 240 },
            source: 'runtime-inspect',
          },
          {
            id: 'wrapper',
            parentId: 'root',
            type: 'container',
            role: '无视觉包装',
            bounds: { x: 12, y: 12, width: 351, height: 100 },
            source: 'runtime-inspect',
          },
          {
            id: 'card',
            parentId: 'wrapper',
            type: 'surface',
            role: '内容卡片',
            bounds: { x: 12, y: 12, width: 351, height: 100 },
            style: { fill: '#ffffff', radius: 8 },
            source: 'runtime-inspect',
          },
          {
            id: 'title',
            parentId: 'card',
            type: 'text',
            role: '标题',
            content: '活动标题',
            domPath: 'section > h2',
            bounds: { x: 28, y: 28, width: 160, height: 28 },
            source: 'runtime-inspect',
          },
        ],
      },
    },
    { sourceId: 'synthetic-runtime', surfaceKind: 'mobile' },
  )
  assert.equal(syntheticScene.mode, 'editable-scene')
  assert.equal(
    syntheticScene.nodes.some((node) => node.id === 'wrapper'),
    false,
  )
  assert.equal(syntheticScene.nodes.find((node) => node.id === 'card')?.parentId, 'root')
  assert.equal(
    syntheticScene.nodes.find((node) => node.id === 'title')?.bindings?.['runtime.domPath'],
    'section > h2',
  )
  assert.ok(syntheticScene.nodes.every((node) => node.source.adapterId === 'runtime-dom'))
  assert.ok(syntheticScene.nodes.every((node) => node.ownership.role === 'structure'))

  const results = []
  for (const componentName of ['EraLottery', 'EraTasklist', 'EvaPage']) {
    process.stderr.write(`[runtime-test] ${componentName} start\n`)
    const component = JSON.parse(
      await fs.readFile(
        path.resolve(import.meta.dirname, `../componentsJson/${componentName}.json`),
        'utf8',
      ),
    )
    const result = await inspectRuntimeDomToScene(
      { component, width: 375, height: 812 },
      { surfaceKind: 'mobile' },
    )
    assert.ok(
      ['passed', 'partial'].includes(result.status),
      `${componentName}: ${JSON.stringify(result.diagnostics)}`,
    )
    assert.ok(result.designTree?.nodes.length >= 1, `${componentName} Runtime DOM 没有提取到节点。`)
    assert.equal(
      result.diagnostics?.some((item) => String(item.message).includes('ERR_INVALID_URL')),
      false,
      `${componentName} 不应通过超长 data URL 加载 Runtime。`,
    )
    assert.ok(result.designTree.nodes.every((node) => node.source === 'runtime-inspect'))
    assert.ok(result.sceneGraph?.nodes.length >= 1, `${componentName} Runtime Scene 没有生成节点。`)
    assert.equal(result.sceneGraph.mode, 'editable-scene')
    assert.ok(result.sceneGraph.nodes.every((node) => node.source.adapterId === 'runtime-dom'))
    assert.ok(result.sceneGraph.nodes.every((node) => node.ownership.role === 'structure'))
    process.stderr.write(`[runtime-test] ${componentName} complete\n`)
    results.push({
      componentName,
      framework: component.framework,
      status: result.status,
      nodes: result.designTree.nodes.length,
      sceneNodes: result.sceneGraph.nodes.length,
      wrappersCompressed: result.designTree.nodes.length - result.sceneGraph.nodes.length,
      width: result.designTree.width,
      height: result.designTree.height,
      consoleErrors: result.consoleErrors?.length ?? 0,
    })
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
  await new Promise((resolve) => setTimeout(resolve, 50))
} catch (error) {
  failure = error
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
} finally {
  app.exit(failure ? 1 : 0)
}
