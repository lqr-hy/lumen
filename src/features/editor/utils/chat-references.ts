export interface ChatReferenceImage {
  id: string
  name: string
  src: string
  elementId?: string
}

export function normalizeMentionName(name: string) {
  return name
    .replace(/^@/, '')
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .trim()
}

export function getPromptReferenceImages<T extends ChatReferenceImage>(
  prompt: string,
  images: T[],
) {
  if (!prompt.includes('@')) return images

  const selected = images
    .map((image) => ({
      image,
      index: getImageMentionIndex(prompt, image.name),
    }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.image)

  return selected.length ? selected : images
}

function truncateMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  const headLength = Math.ceil((maxLength - 1) / 2)
  const tailLength = Math.floor((maxLength - 1) / 2)
  return `${value.slice(0, headLength)}…${value.slice(-tailLength)}`
}

export function getImageMentionLabels(name: string) {
  const imageName = normalizeMentionName(name)
  const displayName = truncateMiddle(imageName, 18)
  return Array.from(new Set([imageName, displayName].filter(Boolean)))
}

export function getImageMentionIndex(prompt: string, name: string) {
  const indexes = getImageMentionLabels(name)
    .map((label) => prompt.indexOf(`@${label}`))
    .filter((index) => index >= 0)
  return indexes.length ? Math.min(...indexes) : -1
}
