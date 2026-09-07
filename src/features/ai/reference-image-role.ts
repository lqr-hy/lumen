import type { ReferenceImageRole, ResolvedReferenceImageRole } from './types'

export interface ReferenceImageRoleInput {
  name: string
  role?: ReferenceImageRole
}

export interface ReferenceImageRoleResolution {
  requestedRole: ReferenceImageRole
  resolvedRole: ResolvedReferenceImageRole
  confidence: number
  reason: string
}

const SINGLETON_ROLES = new Set<ResolvedReferenceImageRole>(['kv', 'prototype', 'edit-base'])

/**
 * 在请求进入 Electron Runtime 前，把“自动判断”解析为唯一、显式的图片职责。
 * 手动选择始终优先；自动模式只使用当前轮任务、文件名和结构化入口上下文。
 */
export function resolveReferenceImageRoles(
  images: ReferenceImageRoleInput[],
  context: {
    prompt: string
    hasVisualBrief?: boolean
    editScopeType?: string
  },
): ReferenceImageRoleResolution[] {
  const resolutions = images.map((image, index) => resolveReferenceImageRole(image, index, context))
  const lastSingletonIndex = new Map<ResolvedReferenceImageRole, number>()

  resolutions.forEach((resolution, index) => {
    if (!SINGLETON_ROLES.has(resolution.resolvedRole)) return
    const previousIndex = lastSingletonIndex.get(resolution.resolvedRole)
    if (previousIndex !== undefined) {
      resolutions[previousIndex] = {
        ...resolutions[previousIndex],
        resolvedRole: 'visual',
        confidence: Math.min(resolutions[previousIndex].confidence, 0.8),
        reason: `${roleLabel(resolution.resolvedRole)} 只保留一个主引用，较早图片降为局部视觉参考。`,
      }
    }
    lastSingletonIndex.set(resolution.resolvedRole, index)
  })

  return resolutions
}

function resolveReferenceImageRole(
  image: ReferenceImageRoleInput,
  index: number,
  context: { prompt: string; hasVisualBrief?: boolean; editScopeType?: string },
): ReferenceImageRoleResolution {
  const requestedRole = image.role ?? 'auto'
  if (requestedRole !== 'auto') {
    return {
      requestedRole,
      resolvedRole: requestedRole,
      confidence: 1,
      reason: '用户已明确选择图片职责。',
    }
  }

  const prompt = String(context.prompt || '')
  const name = String(image.name || `参考图 ${index + 1}`)
  const mentionContext = getMentionContext(prompt, name, index)
  const localIntent = `${name} ${mentionContext}`

  if (
    context.editScopeType === 'image-region' ||
    /(?:编辑|修改|修图|替换|擦除|扩图|局部重绘).{0,16}(?:这张|图片|图\s*\d+)/iu.test(
      mentionContext || prompt,
    )
  ) {
    return autoResolution('edit-base', 0.98, '当前任务正在编辑已有图片。')
  }
  if (
    /(?:直接使用|使用原图|保留原图|不要重绘|不要改图|原样使用|放入|放到|作为).{0,24}(?:hero|头图|主图|logo|商品图|人物图|内容图|素材)/iu.test(
      mentionContext || prompt,
    ) ||
    /(?:logo|标志|商品图|产品图|人物图|头像|透明素材|原图素材)/iu.test(localIntent)
  ) {
    return autoResolution('content', 0.96, '任务要求保留图片像素并直接用于页面。')
  }
  if (
    /(?:原型图|原型|线框|wireframe|prototype|结构图|灰模|页面结构|参考布局)/iu.test(localIntent)
  ) {
    return autoResolution('prototype', 0.94, '图片用于控制页面结构和模块顺序。')
  }
  if (
    /(?:\bkv\b|主视觉|视觉主图|banner|海报|头图|整体视觉|配色|视觉主题|氛围)/iu.test(localIntent)
  ) {
    return autoResolution('kv', 0.92, '图片用于控制整体视觉主题。')
  }
  if (/(?:局部风格|按钮风格|材质|光影|插画风格|视觉参考|参考风格)/iu.test(localIntent)) {
    return autoResolution('visual', 0.88, '图片只用于局部视觉参考。')
  }
  if (context.hasVisualBrief) {
    return autoResolution('kv', 0.82, '视觉优化入口默认把未标注图片作为整体视觉主题。')
  }
  return autoResolution('content', 0.68, '未检测到参考意图，优先保留原图，避免被模型重绘。')
}

function autoResolution(
  resolvedRole: ResolvedReferenceImageRole,
  confidence: number,
  reason: string,
): ReferenceImageRoleResolution {
  return { requestedRole: 'auto', resolvedRole, confidence, reason }
}

function getMentionContext(prompt: string, name: string, index: number) {
  const baseName = name.replace(/\.[a-z0-9]{1,8}$/iu, '')
  const labels = [name, baseName, `图${index + 1}`]
  for (const label of labels) {
    if (!label) continue
    const mentionIndex = prompt.toLowerCase().indexOf(`@${label.toLowerCase()}`)
    if (mentionIndex >= 0) {
      return prompt.slice(Math.max(0, mentionIndex - 80), mentionIndex + label.length + 80)
    }
  }
  return prompt
}

function roleLabel(role: ResolvedReferenceImageRole) {
  if (role === 'kv') return 'KV'
  if (role === 'prototype') return '原型'
  if (role === 'edit-base') return 'Edit Base'
  return role
}
