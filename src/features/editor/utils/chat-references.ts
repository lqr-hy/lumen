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
  mentions: Array<{ type: string; resourceId: string; start: number }> = [],
) {
  const mentionedIds = mentions
    .filter((mention) => mention.type === 'image')
    .sort((a, b) => a.start - b.start)
    .map((mention) => mention.resourceId)
  if (mentionedIds.length) {
    const byId = new Map(images.map((image) => [image.id, image]))
    const selected = mentionedIds
      .map((id) => byId.get(id))
      .filter((image): image is T => Boolean(image))
    return Array.from(new Map(selected.map((image) => [image.id, image])).values())
  }
  // Prompt 中也可能包含组件/画板引用（例如 @EraLottery）。只有确实
  // 命中图片名称或 @图N 时，才进入“按图片 mention 筛选”模式；否则
  // 当前上传的图片仍应作为本轮参考图发送。
  const hasImageMention = images.some((image, index) => isMessageImageMentioned(prompt, image, index))
  if (!hasImageMention) {
    // 已解析出的组件/画板 mention 不应屏蔽附件；未解析的 @xxx 仍视为
    // 失效图片引用，保持兼容行为并返回空集。
    const hasNonImageMention = mentions.some((mention) => mention.type !== 'image')
    return prompt.includes('@') && !hasNonImageMention ? [] : images
  }

  const selected = images
    .map((image) => ({
      image,
      index: getImageMentionIndex(prompt, image.name),
    }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.image)

  // 已存在图片 mention 时，只发送被点名的图片，避免混入其他附件。
  return selected
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

export function getMessageImageLabel(index: number) {
  return `图${index + 1}`
}

export function isMessageImageMentioned(prompt: string, image: ChatReferenceImage, index: number) {
  return [getMessageImageLabel(index), ...getImageMentionLabels(image.name)].some((label) =>
    prompt.includes(`@${label}`),
  )
}

export function getStandaloneMessageImages<T extends ChatReferenceImage>(
  prompt: string,
  images: T[],
) {
  return images.filter((image, index) => !isMessageImageMentioned(prompt, image, index))
}
