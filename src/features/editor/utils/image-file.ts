export const LOCAL_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
export const MAX_LOCAL_IMAGE_BYTES = 10 * 1024 * 1024

const SUPPORTED_LOCAL_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function validateLocalImageFile(file: File, maxBytes = MAX_LOCAL_IMAGE_BYTES) {
  if (!SUPPORTED_LOCAL_IMAGE_TYPES.has(file.type)) {
    return '仅支持 PNG、JPG、WebP 或 GIF 图片'
  }
  if (file.size > maxBytes) {
    return `图片不能超过 ${formatMegabytes(maxBytes)}`
  }
  return undefined
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * 拼下载文件名。元素名常常已经带扩展名（AI 素材的元素名就是「AI 生成素材.png」），
 * 直接追加会得到「AI 生成素材.png.jpg」这类双扩展名，且和实际编码格式矛盾。
 * 这里先剥掉已有图片扩展名，再按真实导出格式补一个。
 */
export function buildImageDownloadName(
  name: string,
  extension: 'png' | 'jpg',
  suffix = '',
): string {
  const cleaned = String(name ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\.(?:png|jpe?g|webp|gif|svg)$/i, '')
    .trim()
  return `${cleaned || 'canvas-image'}${suffix}.${extension}`
}

export function readImageSize(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new globalThis.Image()
    image.onload = () => {
      resolve({
        width: Math.max(1, image.naturalWidth || image.width),
        height: Math.max(1, image.naturalHeight || image.height),
      })
    }
    image.onerror = () => reject(new Error('无法解析图片'))
    image.src = src
  })
}

function formatMegabytes(bytes: number) {
  const megabytes = bytes / (1024 * 1024)
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)}MB`
}
