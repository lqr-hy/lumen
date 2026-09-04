import { createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { DesignDocument } from '../types'
import { StaticArtboardRenderer } from '../components/StaticArtboardRenderer'
import { rasterizeNode } from './rasterize-node'

export async function renderArtboardSnapshot(
  document: DesignDocument,
  artboardId: string,
  scale: 1 | 2 = 1,
) {
  const artboard = document.artboards.find((item) => item.id === artboardId)
  if (!artboard) throw new Error('目标画板不存在，无法生成视觉快照。')
  const exportNode = globalThis.document.createElement('div')
  exportNode.style.position = 'fixed'
  exportNode.style.left = '-10000px'
  exportNode.style.top = '0'
  exportNode.style.width = `${artboard.width}px`
  exportNode.style.height = `${artboard.height}px`
  // 先挂到文档再渲染，保证 React 提交时节点已在布局树内。
  globalThis.document.body.appendChild(exportNode)
  const root = createRoot(exportNode)
  try {
    await commitReactTree(root, createElement(StaticArtboardRenderer, { document, artboard }))
    await waitForRenderedContent(exportNode)
    await waitForExportImages(exportNode)
    const canvas = await rasterizeNode(exportNode, {
      width: artboard.width,
      height: artboard.height,
      background: artboard.background === 'transparent' ? null : artboard.background,
      scale,
      // 跳过带 `position: fixed; left: -10000px` 的离屏包裹层。
      useFirstChild: true,
    })
    return {
      data: canvas.toDataURL('image/png'),
      mime: 'image/png' as const,
      width: canvas.width,
      height: canvas.height,
    }
  } finally {
    root.unmount()
    exportNode.remove()
  }
}

/**
 * 等待 React 完成提交。
 *
 * `root.render()` 是异步的：React 在后续任务里才提交 DOM，单个 requestAnimationFrame
 * 不是可靠屏障。此前正因如此，html2canvas 经常截到空节点，表现为版本对比里
 * 只剩画板背景色的空白块。这里用 flushSync 强制同步提交。
 */
async function commitReactTree(root: ReturnType<typeof createRoot>, element: ReactElement) {
  // 先让出当前任务：调用方可能正处于 React 渲染阶段（例如在 effect 里触发快照），
  // 此时 flushSync 会被降级并打印警告。
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0))
  flushSync(() => {
    root.render(element)
  })
  // 让浏览器完成一次样式计算与布局，确保后续测量拿到最终尺寸。
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

/** flushSync 在极少数情况下会被降级（例如已处于渲染阶段），兜底轮询 DOM 是否已有内容。 */
async function waitForRenderedContent(node: HTMLElement, attempts = 60) {
  for (let index = 0; index < attempts; index += 1) {
    if (node.childElementCount > 0) return
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
  throw new Error('画板快照渲染超时：离屏节点未产出内容。')
}

async function waitForExportImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll('img'))
  await Promise.all(
    images.map((image) => {
      if (image.complete) {
        if (image.naturalWidth === 0) image.remove()
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        image.addEventListener('load', () => resolve(), { once: true })
        // 单张图片失败不应阻断整张画板快照；移除失败节点后继续渲染其余内容。
        image.addEventListener(
          'error',
          () => {
            image.remove()
            resolve()
          },
          {
            once: true,
          },
        )
      })
    }),
  )
  await globalThis.document.fonts?.ready
}
