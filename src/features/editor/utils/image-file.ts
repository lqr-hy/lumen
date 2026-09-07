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
