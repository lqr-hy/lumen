import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { inspectStaticHtmlRuntime } from '../electron/runtime/component-runtime-inspector.mjs'
import { runtimeDomInspectionToSceneGraph } from '../electron/runtime/runtime-dom-adapter.mjs'

const testUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'static-ui-runtime-test-'))
app.setPath('userData', testUserData)
let exitCode = 0
try {
  await Promise.race([
    app.whenReady(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Electron app.whenReady 超过 15 秒。')), 15_000),
    ),
  ])
  const input = process.argv[2]
    ? await readSessionDraft(process.argv[2])
    : {
        name: 'Static Runtime Fixture',
        width: 1200,
        height: 800,
        html: '<body class="app-shell"><header data-region-id="header">工具栏</header><aside data-region-id="sidebar">页面 图层 物料</aside><main data-region-id="workspace"><h1>可视化编辑器</h1><button>发布</button><input placeholder="搜索组件"></main></body>',
        css: '.app-shell{width:1200px;height:800px;display:grid;grid-template:56px 744px/240px 960px;background:#f3f4f6}.app-shell>header{grid-column:1/3;background:#111827;color:white}.app-shell>aside{background:white}.app-shell>main{background:#eef2f7;padding:24px}button,input{height:36px}',
      }
  const inspection = await inspectStaticHtmlRuntime(input, { captureSnapshot: false })
  assert.equal(
    inspection.status,
    'passed',
    inspection.diagnostics?.map((item) => item.message).join('；'),
  )
  assert.ok(inspection.designTree.height >= input.height * 0.65)
  assert.ok(
    inspection.designTree.nodes.some((node) =>
      /sidebar|侧栏|图层|物料/i.test(`${node.id} ${node.content || ''}`),
    ),
  )
  assert.ok(
    inspection.designTree.nodes.some((node) =>
      /workspace|编辑器/i.test(`${node.id} ${node.content || ''}`),
    ),
  )
  const graph = runtimeDomInspectionToSceneGraph(inspection, {
    sourceId: input.name,
    surfaceKind: 'desktop-web',
    maxNodes: 600,
  })
  assert.ok(graph.surface.height >= input.height * 0.65)
  assert.ok(graph.nodes.length > 8)
  console.log(
    JSON.stringify(
      {
        title: input.name,
        viewport: { width: input.width, height: input.height },
        inspectedSize: { width: inspection.designTree.width, height: inspection.designTree.height },
        nodeCount: graph.nodes.length,
        types: graph.nodes.reduce((result, node) => {
          result[node.type] = (result[node.type] || 0) + 1
          return result
        }, {}),
      },
      null,
      2,
    ),
  )
} catch (error) {
  exitCode = 1
  console.error(error instanceof Error ? error.stack : String(error))
} finally {
  await fs.rm(testUserData, { recursive: true, force: true })
  await new Promise((resolve) => setTimeout(resolve, 50))
  app.exit(exitCode)
}

async function readSessionDraft(file) {
  const session = JSON.parse(await fs.readFile(file, 'utf8'))
  const draft = session.genericUiRuntimeDraft
  if (!draft?.html || !draft?.css) throw new Error('Session 没有保存 Runtime Draft。')
  return {
    name: draft.title,
    width: draft.viewport.width,
    height: draft.viewport.height,
    html: draft.html,
    css: draft.css,
  }
}
