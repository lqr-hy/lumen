import { useEffect, useState } from 'react'
import { renderArtboardSnapshot } from '../features/editor/utils/artboard-snapshot'
import { StaticArtboardRenderer } from '../features/editor/components/StaticArtboardRenderer'
import type { Artboard, DesignDocument, DesignElement } from '../features/editor/types'

/**
 * 快照链路 fixture：验证 `renderArtboardSnapshot` 真的画出了内容。
 *
 * 版本对比、PNG 导出和视觉评审都依赖它，而它此前有一个时序缺陷：
 * `createRoot().render()` 异步提交，单个 requestAnimationFrame 不足以等到 DOM 落地，
 * html2canvas 会截到空节点，产出"只有画板背景色"的空白图。
 * 该缺陷只在 DOM 层级较深时必现，靠人工看图容易漏过，故固化为自动断言。
 */
const artboard: Artboard = {
  id: 'snapshot-board',
  name: '快照画板',
  x: 640,
  y: 320,
  width: 320,
  height: 240,
  background: '#fef3c7',
  overflow: 'hidden',
}

// 刻意做多层嵌套：深层结构会放大 React 提交延迟，是该缺陷的触发条件。
const elements: DesignElement[] = [
  {
    id: 'shell',
    artboardId: artboard.id,
    type: 'section',
    name: '外壳',
    label: '外壳',
    x: 640,
    y: 320,
    width: 320,
    height: 240,
    zIndex: 1,
  },
  {
    id: 'panel',
    artboardId: artboard.id,
    parentId: 'shell',
    type: 'shape',
    shape: 'rect',
    name: '面板',
    fill: '#1f2937',
    x: 664,
    y: 344,
    width: 272,
    height: 120,
    zIndex: 2,
    cornerRadii: { topLeft: 10, topRight: 10, bottomRight: 10, bottomLeft: 10 },
  },
  {
    id: 'heading',
    artboardId: artboard.id,
    parentId: 'panel',
    type: 'text',
    name: '标题',
    content: '快照内容',
    x: 684,
    y: 368,
    width: 200,
    height: 34,
    zIndex: 3,
    style: { color: '#ffffff', fontSize: 24, fontWeight: 700, lineHeight: 1.3 },
  },
  // lineHeight < 1 且 height 恰好等于行盒：字形墨迹会溢出行盒上方。
  // html2canvas 会把整行下移并裁掉溢出部分，是"标题被削平"的触发条件。
  {
    id: 'tight',
    artboardId: artboard.id,
    parentId: 'panel',
    type: 'text',
    name: '紧凑行高',
    content: 'bilibili每周必看',
    x: 684,
    y: 408,
    width: 240,
    height: 30.4,
    zIndex: 5,
    style: { color: '#ffffff', fontSize: 32, fontWeight: 700, lineHeight: 0.95 },
  },
  {
    id: 'accent',
    artboardId: artboard.id,
    parentId: 'panel',
    type: 'shape',
    shape: 'circle',
    name: '圆点',
    fill: '#fb7299',
    x: 890,
    y: 360,
    width: 28,
    height: 28,
    zIndex: 4,
  },
  {
    id: 'cta',
    artboardId: artboard.id,
    parentId: 'shell',
    type: 'button',
    name: '按钮',
    content: '查看',
    x: 664,
    y: 486,
    width: 120,
    height: 40,
    zIndex: 3,
    style: { background: '#7c3aed', color: '#ffffff', fontSize: 15, fontWeight: 700, borderRadius: 8 },
  },
]

const snapshotDocument: DesignDocument = {
  version: 1,
  id: 'snapshot-fixture',
  title: '快照 fixture',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  artboards: [artboard, { ...artboard, id: 'snapshot-board-b', name: '快照画板 B' }],
  elements: [
    ...elements,
    // 第二块画板用于复刻版本对比的并发场景。
    ...elements.map((element) => ({
      ...element,
      id: `b-${element.id}`,
      artboardId: 'snapshot-board-b',
      parentId: element.parentId ? `b-${element.parentId}` : undefined,
    })),
  ] as DesignElement[],
  assets: [],
}

export function SnapshotFixturePage() {
  const [snapshot, setSnapshot] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        // 并发生成，复刻 VariantComparisonDialog 的真实调用方式；
        // 第二张只为占住并发路径，断言用第一张与 DOM 比对。
        const [left] = await Promise.all([
          renderArtboardSnapshot(snapshotDocument, 'snapshot-board', 1),
          renderArtboardSnapshot(snapshotDocument, 'snapshot-board-b', 2),
        ])
        setSnapshot(left.data)
      } catch (cause) {
        setError(String(cause))
      }
    })()
  }, [])

  if (error) return <pre data-snapshot-error>{error}</pre>
  return (
    <main
      data-snapshot-fixture={snapshot ? 'ready' : 'pending'}
      style={{ display: 'flex', gap: 0, padding: 0, margin: 0, background: '#ffffff' }}
    >
      {/* 左：DOM 真源。右：快照位图。两者必须逐像素一致。 */}
      <div
        data-snapshot-surface="dom"
        style={{ width: artboard.width, height: artboard.height, position: 'relative', flex: '0 0 auto' }}
      >
        <StaticArtboardRenderer document={snapshotDocument} artboard={artboard} />
      </div>
      {snapshot ? (
        <img
          data-snapshot-surface="raster"
          src={snapshot}
          alt=""
          style={{ width: artboard.width, height: artboard.height, display: 'block', flex: '0 0 auto' }}
        />
      ) : null}
    </main>
  )
}
