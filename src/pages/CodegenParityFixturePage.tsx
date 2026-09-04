import { useMemo } from 'react'
import { StaticArtboardRenderer } from '../features/editor/components/StaticArtboardRenderer'
import { buildCodeDocument } from '../features/codegen/code-ir'
import type { Artboard, DesignDocument, DesignElement } from '../features/editor/types'

/**
 * 一致性门禁 fixture：左侧是画布渲染路径，右侧是导出代码在 iframe 中的渲染。
 * 两者应逐像素接近；出现差异说明 Render IR 的某个消费者又走了第二套解释。
 */
const artboard: Artboard = {
  id: 'parity-board',
  name: '一致性画板',
  // 非零原点，用于验证坐标归一化在两条链路上一致。
  x: 1200,
  y: 640,
  width: 375,
  height: 900,
  background: '#ffffff',
  overflow: 'hidden',
}

const elements: DesignElement[] = [
  {
    id: 'shell',
    artboardId: artboard.id,
    type: 'section',
    name: '页面外壳',
    label: '页面外壳',
    designRole: 'page-shell',
    x: 1200,
    y: 640,
    width: 375,
    height: 900,
    zIndex: 1,
  },
  {
    id: 'hero-bg',
    artboardId: artboard.id,
    parentId: 'shell',
    type: 'shape',
    shape: 'rect',
    name: '主视觉底色',
    fill: '#fb7299',
    x: 1200,
    y: 640,
    width: 375,
    height: 240,
    zIndex: 2,
    cornerRadii: { topLeft: 0, topRight: 0, bottomRight: 24, bottomLeft: 24 },
  },
  {
    id: 'title',
    artboardId: artboard.id,
    parentId: 'shell',
    type: 'text',
    name: '主标题',
    content: '双十一狂欢盛典',
    x: 1224,
    y: 700,
    width: 280,
    height: 40,
    zIndex: 3,
    style: { color: '#ffffff', fontSize: 28, fontWeight: 700, lineHeight: 1.4, textAlign: 'left' },
  },
  {
    id: 'subtitle',
    artboardId: artboard.id,
    parentId: 'shell',
    type: 'text',
    name: '副标题',
    content: '这是一段会被省略号截断的很长的营销文案内容',
    x: 1224,
    y: 748,
    width: 200,
    height: 22,
    zIndex: 3,
    style: { color: '#ffe9f0', fontSize: 14, lineHeight: 1.5, overflow: 'ellipsis' },
  },
  {
    id: 'badge',
    artboardId: artboard.id,
    parentId: 'shell',
    type: 'shape',
    shape: 'circle',
    name: '圆形角标',
    fill: '#ffd700',
    x: 1500,
    y: 676,
    width: 48,
    height: 48,
    zIndex: 4,
    shadow: { x: 0, y: 4, blur: 12, color: 'rgba(0, 0, 0, 0.25)' },
  },
  {
    id: 'flow',
    artboardId: artboard.id,
    parentId: 'shell',
    type: 'section',
    name: '任务行',
    label: '任务行',
    x: 1216,
    y: 920,
    width: 343,
    height: 72,
    zIndex: 3,
    autoLayout: {
      direction: 'horizontal',
      gap: 12,
      padding: { top: 12, right: 16, bottom: 12, left: 16 },
      align: 'center',
      justify: 'start',
    },
  },
  {
    id: 'flow-a',
    artboardId: artboard.id,
    parentId: 'flow',
    type: 'text',
    name: '任务一',
    content: '每日签到',
    x: 1232,
    y: 932,
    width: 96,
    height: 48,
    zIndex: 4,
    style: { color: '#172033', fontSize: 15, fontWeight: 500, lineHeight: 1.4 },
  },
  {
    id: 'flow-b',
    artboardId: artboard.id,
    parentId: 'flow',
    type: 'text',
    name: '任务二',
    content: '分享得积分',
    x: 1340,
    y: 932,
    width: 110,
    height: 48,
    zIndex: 4,
    style: { color: '#172033', fontSize: 15, fontWeight: 500, lineHeight: 1.4 },
  },
  // autoLayout 容器内的多行文字：曾因导出改走 flex 流而堆叠。
  // 子节点坐标已由 editor-store 写回，两条链路都必须按绝对坐标渲染。
  {
    id: 'stack-card',
    artboardId: artboard.id,
    parentId: 'shell',
    type: 'section',
    name: '堆叠卡片',
    label: '堆叠卡片',
    x: 1216,
    y: 1272,
    width: 343,
    height: 130,
    zIndex: 3,
    autoLayout: {
      direction: 'vertical',
      gap: 6,
      padding: { top: 12, right: 12, bottom: 12, left: 12 },
      align: 'start',
      justify: 'start',
    },
  },
  {
    id: 'stack-line-a',
    artboardId: artboard.id,
    parentId: 'stack-card',
    type: 'text',
    name: '堆叠行一',
    content: 'bilibili热门',
    x: 1232,
    y: 1288,
    width: 300,
    height: 34,
    zIndex: 4,
    style: { color: '#d94f2b', fontSize: 24, fontWeight: 700, lineHeight: 1.4 },
  },
  {
    id: 'stack-line-b',
    artboardId: artboard.id,
    parentId: 'stack-card',
    type: 'text',
    name: '堆叠行二',
    content: '每周必看',
    x: 1232,
    y: 1330,
    width: 300,
    height: 34,
    zIndex: 5,
    style: { color: '#d94f2b', fontSize: 24, fontWeight: 700, lineHeight: 1.4 },
  },
  {
    id: 'cta',
    artboardId: artboard.id,
    parentId: 'shell',
    type: 'button',
    name: '主按钮',
    content: '立即参与',
    x: 1264,
    y: 1040,
    width: 247,
    height: 48,
    zIndex: 3,
    style: {
      background: '#fb7299',
      color: '#ffffff',
      fontSize: 16,
      fontWeight: 700,
      borderRadius: 24,
    },
  },
  {
    id: 'field',
    artboardId: artboard.id,
    parentId: 'shell',
    type: 'input',
    name: '邀请码',
    content: '请输入邀请码',
    x: 1264,
    y: 1108,
    width: 247,
    height: 44,
    zIndex: 3,
    style: {
      background: '#f5f6f8',
      color: '#78808f',
      fontSize: 14,
      borderRadius: 8,
      borderColor: '#d9dee8',
      borderWidth: 1,
    },
  },
  {
    id: 'rotated',
    artboardId: artboard.id,
    parentId: 'shell',
    type: 'shape',
    shape: 'rect',
    name: '旋转装饰',
    fill: '#8bc9ff',
    x: 1240,
    y: 1200,
    width: 60,
    height: 60,
    zIndex: 3,
    rotation: 18,
    opacity: 0.75,
  },
  {
    id: 'clipped',
    artboardId: artboard.id,
    parentId: 'shell',
    type: 'section',
    name: '裁剪容器',
    label: '裁剪容器',
    x: 1360,
    y: 1200,
    width: 120,
    height: 60,
    zIndex: 3,
    clipContent: true,
  },
  {
    id: 'clipped-child',
    artboardId: artboard.id,
    parentId: 'clipped',
    type: 'shape',
    shape: 'rect',
    name: '被裁剪块',
    fill: '#39c5bb',
    x: 1400,
    y: 1220,
    width: 160,
    height: 30,
    zIndex: 4,
  },
]

const parityDocument: DesignDocument = {
  version: 1,
  id: 'codegen-parity-fixture',
  title: '导出一致性 fixture',
  // 固定时间戳，避免 fixture 每次渲染产生无关变化。
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  artboards: [artboard],
  elements,
  assets: [],
}

export function CodegenParityFixturePage() {
  const srcDoc = useMemo(() => {
    const code = buildCodeDocument(parityDocument, {
      framework: 'html',
      artboardId: artboard.id,
    })
    const html = code.files.find((file) => file.path === 'index.html')?.content ?? ''
    const css = code.files.find((file) => file.path === 'styles.css')?.content ?? ''
    return html.replace(
      /<link[^>]+href=["']styles\.css["'][^>]*>/i,
      `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`,
    )
  }, [])

  return (
    <main
      data-parity-fixture="codegen-v1"
      style={{ display: 'flex', gap: 24, padding: 24, background: '#e9edf3' }}
    >
      <section>
        <div
          data-parity-surface="canvas"
          style={{ width: artboard.width, height: artboard.height, position: 'relative' }}
        >
          <StaticArtboardRenderer document={parityDocument} artboard={artboard} />
        </div>
      </section>
      <section>
        <iframe
          data-parity-surface="codegen"
          title="导出代码渲染"
          srcDoc={srcDoc}
          sandbox=""
          style={{ width: artboard.width, height: artboard.height, border: '0', display: 'block' }}
        />
      </section>
    </main>
  )
}
