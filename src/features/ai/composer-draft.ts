export type ComposerReferenceType =
  'image' | 'component' | 'component-json' | 'artboard' | 'canvas-node'

export interface ComposerMention {
  id: string
  type: ComposerReferenceType
  resourceId: string
  label: string
  packId?: string
  componentName?: string
  start: number
  end: number
}

export interface ComposerAttachment {
  id: string
  type: 'image'
  name: string
  src: string
  elementId?: string
}

export interface ComposerDraft {
  text: string
  editorState?: string
  attachments: ComposerAttachment[]
  mentions: ComposerMention[]
  textReferences: Array<{
    id: string
    text: string
    elementId?: string
  }>
  placementOverride?: 'new-artboard' | 'append-section' | 'duplicate-variant' | 'asset-board'
}

export function getMentionedAttachmentIds(mentions: ComposerMention[]) {
  return new Set(
    mentions.filter((mention) => mention.type === 'image').map((mention) => mention.resourceId),
  )
}

export function getComponentReferences(mentions: ComposerMention[]) {
  const references = mentions
    .filter((mention) => mention.type === 'component' && mention.packId && mention.componentName)
    .map((mention) => ({
      packId: mention.packId!,
      componentName: mention.componentName!,
      label: mention.label,
    }))
  return Array.from(
    new Map(
      references.map((reference) => [`${reference.packId}:${reference.componentName}`, reference]),
    ).values(),
  )
}
