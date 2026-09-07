/**
 * 用 SVG foreignObject 把 DOM 节点光栅化，由浏览器自己排版。
 *
 * 不用 html2canvas：它自行重算文本基线，不处理字形墨迹溢出行盒的情况。
 * 设计稿大量使用 `lineHeight < 1`，此时墨迹会伸到行盒上方（实测 65px 字号溢出 8px），
 * html2canvas 会把整行下移约 36px 并裁掉溢出部分 —— 表现为大字号标题底部被削平、
 * 某些英文小写字母的下半截会缺失。这是库的缺陷，无法用 CSS 绕过（1.4.1 已停止维护）。
 *
 * foreignObject 走浏览器原生排版，与画布逐像素一致（实测差异 0px）。代价是两个约束：
 * 图片必须内联为 data URL（SVG 内无法发起网络请求），样式必须内联（克隆节点脱离文档）。
 */
export async function rasterizeNode(
  node: HTMLElement,
  options: {
    width: number
    height: number
    background?: string | null
    scale?: number
    /** 为 true 时取 node 的首个子元素，用于跳过带离屏定位的包裹层。 */
    useFirstChild?: boolean
  },
) {
  const { width, height, background = null, scale = 1, useFirstChild = false } = options
  await inlineImages(node)

  const source = useFirstChild ? node.firstElementChild : node
  if (!(source instanceof HTMLElement)) throw new Error('光栅化失败：目标节点为空。')
  const clone = source.cloneNode(true) as HTMLElement
  inlineComputedStyles(source, clone)
  // 克隆体在 SVG 内从原点排布：源节点可能带离屏定位或画布变换，都不应带入。
  clone.style.setProperty('position', 'static')
  clone.style.setProperty('left', 'auto')
  clone.style.setProperty('top', 'auto')
  clone.style.setProperty('transform', 'none')
  clone.style.setProperty('margin', '0')

  const serialized = new XMLSerializer().serializeToString(clone)
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<foreignObject x="0" y="0" width="100%" height="100%">`,
    `<div xmlns="http://www.w3.org/1999/xhtml">${serialized}</div>`,
    `</foreignObject></svg>`,
  ].join('')

  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('光栅化失败：SVG 无法解码。'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })

  const canvas = globalThis.document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('光栅化失败：无法获取 2D 上下文。')
  if (background) {
    context.fillStyle = background
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * 把计算样式逐节点写成 inline style。
 *
 * 克隆体在 foreignObject 内脱离了文档，选择器无法命中，`.text-element` 之类的
 * 应用样式会全部丢失。以画布真实的计算样式为准，同时保证 SVG 内与画布取值一致。
 */
function inlineComputedStyles(source: HTMLElement, target: HTMLElement) {
  const sourceNodes = [source, ...Array.from(source.querySelectorAll<HTMLElement>('*'))]
  const targetNodes = [target, ...Array.from(target.querySelectorAll<HTMLElement>('*'))]
  sourceNodes.forEach((origin, index) => {
    const clone = targetNodes[index]
    if (!clone) return
    const computed = globalThis.getComputedStyle(origin)
    let text = ''
    for (const property of computed) text += `${property}:${computed.getPropertyValue(property)};`
    clone.setAttribute('style', text)
  })
}

/** SVG 内无法发起网络请求，图片必须先转成 data URL。 */
async function inlineImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll('img'))
  await Promise.all(
    images.map(async (image) => {
      if (image.src.startsWith('data:')) return
      try {
        const response = await fetch(image.src, { mode: 'cors' })
        if (!response.ok) throw new Error(String(response.status))
        const blob = await response.blob()
        image.src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(new Error('读取图片失败'))
          reader.readAsDataURL(blob)
        })
      } catch {
        // 单张图片失败不应阻断整次光栅化。
        image.remove()
      }
    }),
  )
}
