const DEFAULT_TARGET = Object.freeze({
  width: 375,
  height: 812,
  placementMode: 'new-artboard',
})

export function createGenerationBrief({
  goal,
  canvasTarget,
  references = [],
  editScope,
  outputKind,
} = {}) {
  const target = normalizeTarget(canvasTarget)
  const resolvedOutputKind = normalizeOutputKind(outputKind, target.placementMode, editScope)
  const normalizedReferences = references
    .filter((reference) => reference && typeof reference === 'object')
    .map((reference, index) => normalizeReference(reference, index))

  return {
    version: 1,
    goal: cleanText(goal, '生成设计图'),
    outputKind: resolvedOutputKind,
    target,
    references: normalizedReferences,
    constraints: createConstraints(resolvedOutputKind, target, normalizedReferences),
  }
}

export function describeGenerationBrief(brief) {
  if (!brief || brief.version !== 1) return ''
  const outputLabel =
    {
      'full-image': '完整设计图',
      section: '可追加页面模块',
      asset: '独立图片素材',
    }[brief.outputKind] || brief.outputKind
  const references = brief.references.length
    ? brief.references
        .map((reference, index) => `${index + 1}. ${reference.name}：${reference.responsibility}`)
        .join('\n')
    : '无'
  return [
    `输出类型：${outputLabel}`,
    `目标宽度：${brief.target.width}px；初始高度：${brief.target.height}px（内容可自然延展，不是硬性裁切高度）`,
    `放置方式：${brief.target.placementMode}`,
    `参考图职责：\n${references}`,
    `约束：\n${brief.constraints.map((item) => `- ${item}`).join('\n')}`,
  ].join('\n')
}

function normalizeTarget(canvasTarget) {
  return {
    width: finitePositive(canvasTarget?.width) || DEFAULT_TARGET.width,
    height: finitePositive(canvasTarget?.height) || DEFAULT_TARGET.height,
    placementMode: cleanText(canvasTarget?.placementMode, DEFAULT_TARGET.placementMode),
  }
}

function normalizeReference(reference, index) {
  const role = normalizeRole(reference.role)
  return {
    id: cleanText(reference.id, `reference-${index + 1}`),
    name: cleanText(reference.name, `参考图 ${index + 1}`),
    role,
    responsibility: referenceResponsibility(role),
  }
}

function normalizeRole(value) {
  return ['kv', 'prototype', 'visual', 'edit-base'].includes(value) ? value : 'unknown'
}

function referenceResponsibility(role) {
  return {
    kv: 'visual-theme',
    prototype: 'structure',
    'edit-base': 'edit-base',
    visual: 'visual-reference',
    unknown: 'visual-reference',
  }[role]
}

function normalizeOutputKind(value, placementMode, editScope) {
  if (['full-image', 'section', 'asset'].includes(value)) return value
  if (placementMode === 'append-section') return 'section'
  if (editScope?.type === 'component-region') return 'asset'
  return 'full-image'
}

function createConstraints(outputKind, target, references) {
  const constraints = [
    `输出必须匹配 ${target.width}px 逻辑宽度，避免裁切和横向溢出；高度以内容自然延展为准，不得为了适配初始高度压缩或截断。`,
    '输出最终图片，不要返回解释、方案、HTML 或代码。',
  ]
  if (outputKind === 'section') constraints.push('只生成当前页面要追加的模块，不重复完整页面。')
  if (outputKind === 'asset') constraints.push('只生成目标独立素材，不合成完整页面或完整组件。')
  if (references.some((reference) => reference.role === 'prototype')) {
    constraints.push('Prototype 决定结构、模块顺序和主要文字，不增加不存在的业务模块。')
  }
  if (references.some((reference) => reference.role === 'kv')) {
    constraints.push('KV 决定配色、字体气质、材质、装饰和整体视觉语言，不替代 Prototype 结构。')
  }
  return constraints
}

function cleanText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function finitePositive(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}
