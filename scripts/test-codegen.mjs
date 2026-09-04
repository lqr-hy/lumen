import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codegen-'))
const bundle = path.join(root, 'codegen.mjs')
await build({
  stdin: {
    contents:
      "export { buildCodeDocument, buildCodeExportPackage } from './src/features/codegen/compiler-registry.ts'",
    resolveDir: process.cwd(),
    sourcefile: 'codegen-test.ts',
  },
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'silent',
})
const api = await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`)
const artboard = {
  id: 'board',
  name: '销售后台',
  x: 0,
  y: 0,
  width: 1440,
  height: 900,
  background: '#f5f7fa',
}
const image = 'data:image/png;base64,aGVsbG8='
const document = {
  id: 'doc',
  title: '销售后台',
  version: 1,
  artboards: [artboard],
  elements: [
    {
      id: 'root',
      artboardId: 'board',
      type: 'section',
      name: '页面',
      label: '页面',
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
      zIndex: 1,
    },
    {
      id: 'title',
      artboardId: 'board',
      parentId: 'root',
      type: 'text',
      name: '标题',
      content: '订单概览',
      x: 40,
      y: 30,
      width: 200,
      height: 32,
      zIndex: 2,
      style: { color: '#111', fontSize: 24 },
    },
    {
      id: 'hero',
      artboardId: 'board',
      parentId: 'root',
      type: 'image',
      name: '主视觉',
      src: image,
      x: 40,
      y: 90,
      width: 320,
      height: 180,
      zIndex: 2,
    },
    {
      id: 'lottery',
      artboardId: 'board',
      parentId: 'root',
      type: 'section',
      name: '活动组件',
      x: 400,
      y: 90,
      width: 480,
      height: 300,
      zIndex: 2,
      componentBinding: {
        instanceId: 'instance',
        componentName: 'EraLottery',
        profile: 'default',
        regionId: 'root',
        renderMode: 'root',
        rootElementId: 'lottery',
        propPaths: [],
        bindings: {},
      },
    },
    {
      id: 'inside',
      artboardId: 'board',
      parentId: 'lottery',
      type: 'text',
      name: '组件内部',
      content: '不应进入页面代码',
      x: 420,
      y: 110,
      width: 200,
      height: 20,
      zIndex: 3,
      componentBinding: {
        instanceId: 'instance',
        componentName: 'EraLottery',
        profile: 'default',
        regionId: 'label',
        renderMode: 'text',
        rootElementId: 'lottery',
        propPaths: [],
        bindings: {},
      },
    },
  ],
  assets: [],
  componentInstances: {
    instance: {
      id: 'instance',
      artboardId: 'board',
      rootElementId: 'lottery',
      componentName: 'EraLottery',
      profile: 'default',
      design: { packId: 'campaign-components', propsPatch: { title: '抽奖' } },
    },
  },
}
for (const framework of ['html', 'react', 'vue']) {
  const code = api.buildCodeDocument(document, { framework })
  assert.equal(code.framework, framework)
  assert.ok(code.files.some((file) => file.path === code.entryFile))
  assert.ok(
    code.sourceMap.some((item) => item.nodeId === 'lottery' && item.kind === 'runtime-component'),
  )
  assert.ok(code.files.every((file) => file.content.length > 0))
  const entry = code.files.find((file) => file.path === code.entryFile).content
  assert.match(entry, /EraLottery/)
  assert.doesNotMatch(entry, /不应进入页面代码/)
  assert.ok(code.assets.some((asset) => asset.id === 'hero'))
  assert.ok(code.files.some((file) => file.path.startsWith('props/')))
}
const nested = api.buildCodeDocument({
  ...document,
  elements: [...document.elements, { id: 'nested', artboardId: 'board', parentId: 'root', type: 'section', name: '嵌套容器', x: 100, y: 200, width: 300, height: 200, zIndex: 2 }, { id: 'nested-text', artboardId: 'board', parentId: 'nested', type: 'text', name: '嵌套文字', content: '相对坐标', x: 130, y: 240, width: 100, height: 20, zIndex: 3, style: { color: '#111', fontSize: 14 } }],
}, { framework: 'html' })
const nestedCss = nested.files.find((file) => file.path === 'styles.css').content
// 导出 DOM 按 parentId 嵌套，子节点坐标相对父节点：130-100=30、240-200=40。
// 早前的编译器把整棵树拍平后写绝对坐标，会丢失父级裁剪与 flex 语义。
assert.match(nestedCss, /\.嵌套文字 \{[\s\S]*left: 30px;[\s\S]*top: 40px;/)
const nestedHtml = nested.files.find((file) => file.path === 'index.html').content
assert.match(nestedHtml, /嵌套容器[\s\S]*相对坐标/)
const offset = api.buildCodeDocument({ ...document, artboards: [{ ...artboard, x: 20857, y: 3100 }], elements: document.elements.map((element) => ({ ...element, x: element.x + 20857, y: element.y + 3100 })) }, { framework: 'html' })
const offsetCss = offset.files.find((file) => file.path === 'styles.css').content
assert.match(offsetCss, /\.页面[\s\S]*left: 0px;[\s\S]*top: 0px;/)
assert.match(offsetCss, /button \{ padding: 0; border: 0; appearance: none;/)
assert.doesNotMatch(offset.files.find((file) => file.path === 'index.html').content, />页面<\/section>/)
assert.doesNotMatch(offset.files.find((file) => file.path === 'index.html').content, />container<\/section>/i)
assert.match(offsetCss, /\.标题[\s\S]*display: flex;[\s\S]*align-items: flex-start;/)
const localOffset = api.buildCodeDocument({ ...document, artboards: [{ ...artboard, x: 20857, y: 3100 }], elements: document.elements.map((element) => ({ ...element, artboardId: 'board' })) }, { framework: 'html' })
const localHtml = localOffset.files.find((file) => file.path === 'index.html').content
assert.match(localHtml, /订单概览/)
const selected = api.buildCodeDocument(document, { framework: 'html', selectionIds: ['title'] })
const selectedHtml = selected.files.find((file) => file.path === 'index.html').content
assert.match(selectedHtml, /订单概览/)
assert.doesNotMatch(selectedHtml, /主视觉/)
assert.doesNotMatch(selectedHtml, /活动组件/)
const orphan = api.buildCodeDocument({ ...document, elements: [...document.elements, { id: 'orphan', artboardId: 'board', parentId: 'missing', type: 'text', name: '孤儿', content: '应被保留', x: 20, y: 20, width: 80, height: 20, zIndex: 4, style: { color: '#111', fontSize: 14 } }] }, { framework: 'html' })
assert.match(orphan.files.find((file) => file.path === 'index.html').content, /应被保留/)
assert.ok(orphan.diagnostics.some((diagnostic) => diagnostic.code === 'CODEGEN_ORPHAN_PROMOTED'))
const remote = api.buildCodeDocument({ ...document, elements: [{ ...document.elements[2], src: 'https://example.com/hero.png' }] }, { framework: 'html', assetMode: 'download' })
assert.equal(remote.assets[0].path, 'https://example.com/hero.png')
assert.ok(remote.diagnostics.some((diagnostic) => diagnostic.code === 'REMOTE_ASSET_NOT_DOWNLOADED'))
const autoLayout = api.buildCodeDocument({
  ...document,
  elements: [
    { id: 'flow', artboardId: 'board', type: 'section', name: '流式容器', x: 40, y: 400, width: 600, height: 100, zIndex: 2, autoLayout: { direction: 'horizontal', gap: 12, padding: { top: 8, right: 16, bottom: 8, left: 16 }, align: 'center', justify: 'start' } },
    { id: 'flow-a', artboardId: 'board', parentId: 'flow', type: 'text', name: 'A', content: '左侧', x: 60, y: 420, width: 100, height: 20, zIndex: 3, style: { color: '#111', fontSize: 14 } },
  ],
}, { framework: 'html' })
const flowCss = autoLayout.files.find((file) => file.path === 'styles.css').content
// autoLayout 是编辑期工具：设置时 editor-store 已把排版结果写回子节点 x/y。
// 导出若再让子节点走 flex 流，会用 gap 取代设计坐标，与画布不一致（元素堆叠）。
const flowContainerCss = /\.流式容器 \{([\s\S]*?)\n\}/.exec(flowCss)?.[1] ?? ''
assert.doesNotMatch(flowContainerCss, /flex-direction/)
assert.doesNotMatch(flowContainerCss, /gap:/)
const flowChildCss = /\.a \{([\s\S]*?)\n\}/.exec(flowCss)?.[1] ?? ''
assert.match(flowChildCss, /position: absolute;/)
// 子节点坐标相对父节点：60-40=20、420-400=20。
assert.match(flowChildCss, /left: 20px;/)
assert.match(flowChildCss, /top: 20px;/)
// class 名必须全局唯一。此前用 `slug + 截断哈希` 现算，相似 id（仅尾部序号不同）
// 会产出相同哈希，多个元素共用一条 CSS 规则后互相覆盖，表现为元素堆叠或消失。
const collisionProbe = api.buildCodeDocument({
  ...document,
  elements: [
    ...document.elements,
    // 同名同类型、id 仅尾号不同：正是真实生成链路的命名方式。
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `artboard-board:runtime:art-title-${10 + index}`,
      artboardId: 'board',
      parentId: 'root',
      type: 'text',
      name: '标题',
      content: `第 ${index} 行`,
      x: 40,
      y: 500 + index * 30,
      width: 200,
      height: 24,
      zIndex: 10 + index,
      style: { color: '#111', fontSize: 14 },
    })),
  ],
}, { framework: 'html' })
const collisionCss = collisionProbe.files.find((file) => file.path === 'styles.css').content
const classNames = [...collisionCss.matchAll(/^\.([^\s{]+) \{/gm)].map((match) => match[1])
assert.equal(new Set(classNames).size, classNames.length,
  `导出 CSS 存在重复 class：${classNames.filter((name, index) => classNames.indexOf(name) !== index).join(', ')}`)
// 同名元素各自的 box 与 content 层都要拿到独立 class：
// 基础文档自带 1 个「标题」，加上探针的 6 个，共 7 个 box 层 + 7 个 content 层。
const titleBoxes = classNames.filter((name) => /^标题(-\d+)?$/.test(name))
const titleContents = classNames.filter((name) => /^标题-content(-\d+)?$/.test(name))
assert.equal(titleBoxes.length, 7, `标题 box 层 class: ${titleBoxes.join(', ')}`)
assert.equal(titleContents.length, 7, `标题 content 层 class: ${titleContents.join(', ')}`)

const exported = await api.buildCodeExportPackage(document, { framework: 'html', assetMode: 'download' })
assert.equal(exported.validation.valid, true)
assert.equal(exported.bytes[0], 0x50)
assert.equal(exported.bytes[1], 0x4b)
assert.match(exported.document.files.find((file) => file.path === 'index.html').content, /\n  <head>/)
assert.match(exported.document.files.find((file) => file.path === 'styles.css').content, /\n\.销售后台/)
assert.doesNotMatch(exported.document.diagnostics.find((diagnostic) => diagnostic.code === 'CODE_FORMAT_FALLBACK')?.message ?? '', /<!doctype html>/i)
console.log('codegen tests passed')
