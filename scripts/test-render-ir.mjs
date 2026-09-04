// Render IR 一致性测试：断言画布、静态快照与代码导出消费同一份视觉真源。
// 通过 esbuild 就地编译 TS，避免为测试单独维护一份 JS 实现。
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const outDir = await mkdtemp(path.join(tmpdir(), 'render-ir-'))
const outfile = path.join(outDir, 'render-box.mjs')
await build({
  entryPoints: ['src/features/editor/render/render-box.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile,
  logLevel: 'silent',
})
const ir = await import(outfile)
const { buildRenderBox, buildArtboardRenderTree } = ir

const artboard = {
  id: 'board',
  name: '页面',
  x: 1000,
  y: 500,
  width: 375,
  height: 812,
  background: '#ffffff',
}
const base = { artboardId: 'board', zIndex: 1, visible: true }
function element(overrides) {
  return { ...base, ...overrides }
}
function findByElementId(box, id, acc = []) {
  if (box.meta.elementId === id) acc.push(box)
  box.children.forEach((child) => findByElementId(child, id, acc))
  return acc
}
function cssOf(tree, id, role) {
  const found = findByElementId(tree.root, id).find((box) => box.role === role)
  assert.ok(found, `未找到 ${id} 的 ${role} 层`)
  return found.css
}

// 1. 结构等价：同一元素在 canvas 与 export 下除交互态外必须产出相同 IR。
{
  const text = element({
    id: 'title',
    type: 'text',
    name: '标题',
    content: '订单概览',
    x: 40,
    y: 30,
    width: 200,
    height: 32,
    style: { color: '#111', fontSize: 24, fontFamily: 'PingFang SC', lineHeight: 1.5 },
  })
  const canvas = buildRenderBox(text, {
    mode: 'canvas',
    origin: { x: 0, y: 0 },
    diagnostics: [],
  })
  const exported = buildRenderBox(text, {
    mode: 'export',
    origin: { x: 0, y: 0 },
    diagnostics: [],
  })
  assert.deepEqual(canvas.css, exported.css, 'box 层 CSS 必须与 mode 无关')
  assert.deepEqual(
    canvas.children[0].css,
    exported.children[0].css,
    'content 层 CSS 必须与 mode 无关',
  )
  assert.ok(canvas.meta.interactive, 'canvas 模式应带交互元信息')
  assert.equal(exported.meta.interactive, undefined, 'export 模式不应带交互元信息')
}

// 2. 字体族与省略号不再被白名单静默丢弃。
{
  const tree = buildArtboardRenderTree(
    {
      elements: [
        element({
          id: 'ellipsis',
          type: 'text',
          name: '省略',
          content: '很长的文案',
          x: 1000,
          y: 500,
          width: 100,
          height: 20,
          style: { color: '#111', fontSize: 14, fontFamily: 'Inter', overflow: 'ellipsis' },
        }),
      ],
    },
    artboard,
    { mode: 'export', structure: 'nested' },
  )
  const css = cssOf(tree, 'ellipsis', 'content')
  assert.equal(css['font-family'], 'Inter')
  assert.equal(css['text-overflow'], 'ellipsis')
  assert.equal(css.overflow, 'hidden')
}

// 3. 圆形保持 50%，四角不等圆角逐角保留。
{
  const tree = buildArtboardRenderTree(
    {
      elements: [
        element({
          id: 'dot',
          type: 'shape',
          shape: 'circle',
          name: '圆点',
          fill: '#f00',
          x: 1000,
          y: 500,
          width: 40,
          height: 40,
        }),
        element({
          id: 'card',
          type: 'shape',
          shape: 'rect',
          name: '卡片',
          fill: '#eee',
          x: 1000,
          y: 560,
          width: 100,
          height: 60,
          cornerRadii: { topLeft: 8, topRight: 2, bottomRight: 16, bottomLeft: 4 },
        }),
      ],
    },
    artboard,
    { mode: 'export', structure: 'nested' },
  )
  assert.equal(cssOf(tree, 'dot', 'content')['border-radius'], '50%')
  assert.equal(cssOf(tree, 'card', 'box')['border-radius'], '8px 2px 16px 4px')
}

// 4. 嵌套导出使用相对坐标，autoLayout 子节点走流式定位。
{
  const tree = buildArtboardRenderTree(
    {
      elements: [
        element({
          id: 'flow',
          type: 'section',
          name: '流式容器',
          label: '流式',
          x: 1040,
          y: 600,
          width: 300,
          height: 80,
          autoLayout: {
            direction: 'horizontal',
            gap: 12,
            padding: { top: 8, right: 16, bottom: 8, left: 16 },
            align: 'center',
            justify: 'start',
          },
        }),
        element({
          id: 'flow-child',
          parentId: 'flow',
          type: 'text',
          name: '子项',
          content: '左侧',
          x: 1056,
          y: 620,
          width: 100,
          height: 20,
          zIndex: 2,
          style: { color: '#111', fontSize: 14 },
        }),
        element({
          id: 'fixed',
          type: 'section',
          name: '固定容器',
          label: '固定',
          x: 1040,
          y: 700,
          width: 200,
          height: 60,
        }),
        element({
          id: 'fixed-child',
          parentId: 'fixed',
          type: 'text',
          name: '固定子项',
          content: '相对',
          x: 1070,
          y: 740,
          width: 80,
          height: 20,
          zIndex: 2,
          style: { color: '#111', fontSize: 14 },
        }),
      ],
    },
    artboard,
    { mode: 'export', structure: 'nested' },
  )
  const flowBox = findByElementId(tree.root, 'flow').find((box) => box.role === 'box')
  // autoLayout 不产出 flex 容器 CSS：画布按绝对坐标渲染，导出必须一致。
  // gap/padding 一旦写入就会与画布产生分歧（详见 4b 的堆叠回归）。
  assert.equal(flowBox.css['flex-direction'], undefined)
  assert.equal(flowBox.css.gap, undefined)
  assert.equal(flowBox.css.padding, undefined)
  assert.ok(
    findByElementId(flowBox, 'flow-child').length > 0,
    'autoLayout 子节点必须嵌套在容器内',
  )
  // 子节点保持绝对定位，坐标相对父节点：1056-1040=16、620-600=20。
  const flowChild = cssOf(tree, 'flow-child', 'box')
  assert.equal(flowChild.position, 'absolute')
  assert.equal(flowChild.left, '16px')
  assert.equal(flowChild.top, '20px')
  // 固定容器的子节点用相对父节点坐标：1070-1040=30、740-700=40。
  const fixedChild = cssOf(tree, 'fixed-child', 'box')
  assert.equal(fixedChild.left, '30px')
  assert.equal(fixedChild.top, '40px')
}

// 4b. flat 与 nested 必须把元素放到同一个屏幕位置。
// 回归：曾让 autoLayout 的子节点在导出时走 flex 流，导致 gap 取代设计坐标，
// 卡片内多行文字在导出后堆叠。autoLayout 是编辑期工具，坐标已由 store 写回。
{
  const board = { ...artboard, width: 750, height: 1400 }
  const nodes = [
    element({
      id: 'shell',
      type: 'image',
      name: '背景',
      designRole: 'page-shell',
      src: 'x.png',
      x: 1000,
      y: 500,
      width: 750,
      height: 1400,
    }),
    element({
      id: 'card',
      parentId: 'shell',
      type: 'section',
      name: '卡片',
      label: '卡片',
      x: 1190,
      y: 1095,
      width: 570,
      height: 490,
      zIndex: 5,
      autoLayout: {
        direction: 'vertical',
        gap: 8,
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
        align: 'start',
        justify: 'start',
      },
    }),
    element({
      id: 'line-a',
      parentId: 'card',
      type: 'text',
      name: '行一',
      content: 'bilibili热门',
      x: 1240,
      y: 1200,
      width: 400,
      height: 60,
      zIndex: 6,
      style: { color: '#d94f2b', fontSize: 44 },
    }),
    element({
      id: 'line-b',
      parentId: 'card',
      type: 'text',
      name: '行二',
      content: '每周必看',
      x: 1240,
      y: 1290,
      width: 400,
      height: 60,
      zIndex: 7,
      style: { color: '#d94f2b', fontSize: 44 },
    }),
  ]
  const absolute = (structure) => {
    const tree = buildArtboardRenderTree({ elements: nodes }, board, {
      mode: structure === 'flat' ? 'static' : 'export',
      structure,
    })
    const found = {}
    const walk = (box, ox = 0, oy = 0) => {
      let x = ox
      let y = oy
      if (box.meta.elementId && box.role === 'box') {
        // 所有节点都必须绝对定位，否则累加偏移不成立。
        assert.equal(
          box.css.position,
          'absolute',
          `${box.meta.elementId} 在 ${structure} 下必须绝对定位`,
        )
        x = ox + Number.parseFloat(box.css.left)
        y = oy + Number.parseFloat(box.css.top)
        found[box.meta.elementId] = [x, y]
      }
      box.children.forEach((child) => walk(child, x, y))
    }
    walk(tree.root)
    return found
  }
  const flatPos = absolute('flat')
  const nestedPos = absolute('nested')
  assert.deepEqual(nestedPos, flatPos, '同一元素在画布与导出中必须落在相同屏幕位置')
  // 两行文字的间距必须保留 90px，不能被 autoLayout 的 gap 取代。
  assert.equal(nestedPos['line-b'][1] - nestedPos['line-a'][1], 90)
}

// 5. 越界节点只诊断不改写坐标。
{
  const tree = buildArtboardRenderTree(
    {
      elements: [
        element({
          id: 'overflowing',
          type: 'shape',
          shape: 'rect',
          name: '越界块',
          fill: '#00f',
          x: 1350,
          y: 500,
          width: 200,
          height: 40,
        }),
      ],
    },
    artboard,
    { mode: 'export', structure: 'nested' },
  )
  assert.ok(tree.diagnostics.some((item) => item.code === 'OUT_OF_BOUNDS'))
  // 1350-1000=350，不被夹回 375-1。
  assert.equal(cssOf(tree, 'overflowing', 'box').left, '350px')
  assert.equal(cssOf(tree, 'overflowing', 'box').width, '200px')
}

// 6. 选区导出与整板导出对同一元素给出一致尺寸。
{
  const elements = [
    element({
      id: 'shell',
      type: 'section',
      name: '外壳',
      label: '外壳',
      x: 1000,
      y: 500,
      width: 375,
      height: 812,
    }),
    element({
      id: 'target',
      parentId: 'shell',
      type: 'button',
      name: '按钮',
      content: '立即参与',
      x: 1080,
      y: 700,
      width: 160,
      height: 44,
      zIndex: 2,
      style: { background: '#fb7299', color: '#fff', fontSize: 16, borderRadius: 22 },
    }),
  ]
  const whole = buildArtboardRenderTree({ elements }, artboard, {
    mode: 'export',
    structure: 'nested',
  })
  const partial = buildArtboardRenderTree({ elements }, artboard, {
    mode: 'export',
    structure: 'nested',
    selectionIds: ['target'],
  })
  const a = cssOf(whole, 'target', 'box')
  const b = cssOf(partial, 'target', 'box')
  assert.equal(a.width, b.width)
  assert.equal(a.height, b.height)
  assert.equal(cssOf(whole, 'target', 'content')['border-radius'], 'inherit')
  assert.equal(cssOf(whole, 'target', 'box')['border-radius'], '22px 22px 22px 22px')
}

// 7. runtime-placeholder 不进入导出产物，但保留在画布预览中。
{
  const placeholder = element({
    id: 'ph',
    type: 'runtime-placeholder',
    name: '占位',
    label: '组件占位',
    x: 1000,
    y: 500,
    width: 300,
    height: 200,
    preview: { variant: 'cards', items: ['A', 'B', 'C', 'D'] },
  })
  const diagnostics = []
  assert.equal(
    buildRenderBox(placeholder, { mode: 'export', origin: { x: 0, y: 0 }, diagnostics }),
    null,
  )
  assert.ok(diagnostics.some((item) => item.code === 'PLACEHOLDER_DROPPED'))
  const canvasBox = buildRenderBox(placeholder, {
    mode: 'canvas',
    origin: { x: 0, y: 0 },
    diagnostics: [],
  })
  assert.ok(canvasBox, '画布应保留占位节点')
  assert.equal(
    canvasBox.children[0].children[0].css['grid-template-columns'],
    'repeat(4, minmax(0, 1fr))',
    'cards 变体应在构建时产出 grid 列，不依赖 :has()',
  )
}

// 7b. 标签名不得随 mode 变化：换标签会改变浏览器文本度量，画布与导出无法对齐。
{
  const field = element({
    id: 'field',
    type: 'input',
    name: '邀请码',
    content: '请输入邀请码',
    x: 1000,
    y: 500,
    width: 240,
    height: 44,
    style: { background: '#f5f6f8', color: '#78808f', fontSize: 14, borderRadius: 8 },
  })
  const modes = ['canvas', 'static', 'export'].map((mode) =>
    buildRenderBox(field, { mode, origin: { x: 0, y: 0 }, diagnostics: [] }),
  )
  const tags = new Set(modes.map((box) => box.children[0].tag))
  assert.equal(tags.size, 1, `input 的标签在不同 mode 下必须一致，实际 ${[...tags]}`)
  assert.equal([...tags][0], 'input')
  const cssSet = new Set(modes.map((box) => JSON.stringify(box.children[0].css)))
  assert.equal(cssSet.size, 1, 'input 的视觉 CSS 必须与 mode 无关')
  // 指针事件差异只允许通过 class 表达，不得进入视觉 CSS。
  assert.ok(modes[0].children[0].classNames.includes('input-element-static'))
  assert.ok(!modes[2].children[0].classNames.includes('input-element-static'))
}

// 8. 不透明度与阴影只写在 box 层，避免子层重复叠加。
{
  const tree = buildArtboardRenderTree(
    {
      elements: [
        element({
          id: 'faded',
          type: 'text',
          name: '半透明',
          content: '文案',
          x: 1000,
          y: 500,
          width: 100,
          height: 20,
          opacity: 0.5,
          shadow: { x: 0, y: 2, blur: 8, color: 'rgba(0,0,0,0.2)' },
          style: { color: '#111', fontSize: 14 },
        }),
      ],
    },
    artboard,
    { mode: 'export', structure: 'nested' },
  )
  assert.equal(cssOf(tree, 'faded', 'box').opacity, '0.5')
  assert.equal(cssOf(tree, 'faded', 'box')['box-shadow'], '0px 2px 8px 0px rgba(0,0,0,0.2)')
  assert.equal(cssOf(tree, 'faded', 'content').opacity, undefined)
  assert.equal(cssOf(tree, 'faded', 'content')['box-shadow'], undefined)
}

// 9. 画布扁平结构忽略 parentId，仍使用世界坐标。
{
  const elements = [
    element({ id: 'p', type: 'section', name: '父', label: '父', x: 1040, y: 600, width: 200, height: 100 }),
    element({
      id: 'c',
      parentId: 'p',
      type: 'text',
      name: '子',
      content: '子项',
      x: 1070,
      y: 640,
      width: 80,
      height: 20,
      zIndex: 2,
      style: { color: '#111', fontSize: 14 },
    }),
  ]
  const flat = buildArtboardRenderTree({ elements }, artboard, {
    mode: 'static',
    structure: 'flat',
  })
  // flat 结构下子节点提到根层，坐标相对画板：1070-1000=70。
  assert.equal(flat.root.children.length, 2)
  assert.equal(cssOf(flat, 'c', 'box').left, '70px')
}

// 10. page-shell 只在拿到 surface 时铺满画板。
// 回归：画布模式曾无条件把外壳钉在 left/top: 0，元素是世界坐标的平铺兄弟节点，
// 于是外壳被画到世界原点，画板上只剩底色——整页设计稿看起来"没生成"。
{
  const board = { ...artboard, width: 375, height: 1284 }
  const shell = element({
    id: 'shell',
    type: 'image',
    name: 'page-visual-shell.png',
    designRole: 'page-shell',
    src: 'shell.png',
    objectFit: 'fill',
    x: board.x,
    y: board.y,
    width: board.width,
    height: board.height,
    zIndex: 0,
  })

  // 画布：没有 surface，必须保留世界坐标。
  const canvas = buildRenderBox(shell, {
    mode: 'canvas',
    origin: { x: 0, y: 0 },
    diagnostics: [],
  })
  assert.equal(canvas.css.left, '1000px', '画布上的 page-shell 必须留在所属画板的世界坐标')
  assert.equal(canvas.css.top, '500px', '画布上的 page-shell 必须留在所属画板的世界坐标')
  assert.equal(canvas.css.width, '375px')
  assert.equal(canvas.css.height, '1284px')

  // 静态/导出：外壳是画板容器的子节点，铺满画板并归零。
  const nested = buildArtboardRenderTree({ elements: [shell] }, board, {
    mode: 'export',
    structure: 'nested',
  })
  const nestedCss = cssOf(nested, 'shell', 'box')
  assert.equal(nestedCss.left, '0px', '导出时 page-shell 相对画板容器归零')
  assert.equal(nestedCss.top, '0px', '导出时 page-shell 相对画板容器归零')
  assert.equal(nestedCss.width, '375px')
  assert.equal(nestedCss.height, '1284px')

  // 外壳尺寸落后于画板时，静态渲染仍按 surface 撑满，避免露出底色。
  const stale = { ...shell, width: 375, height: 812 }
  const stretched = buildArtboardRenderTree({ elements: [stale] }, board, {
    mode: 'static',
    structure: 'nested',
  })
  assert.equal(cssOf(stretched, 'shell', 'box').height, '1284px', 'page-shell 必须撑满画板高度')
}

await rm(outDir, { recursive: true, force: true })
console.log('render IR tests passed')
