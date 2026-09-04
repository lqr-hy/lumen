const REFERENCE_LABELS = Object.freeze({
  'edit-base': '编辑底图：保持主体、构图和未指定区域不变',
  prototype: '结构原型：保持布局、模块顺序和已有文字',
  kv: 'KV 视觉来源：提取配色、材质、字体气质和装饰语言',
  visual: '视觉参考：只影响明确指定的视觉维度',
  unknown: '普通视觉参考：不得覆盖结构或编辑底图',
})

export function compileImageGenerationBrief(input = {}) {
  const originalQuestion = cleanText(input.question, '生成一张设计图片')
  const references = normalizeReferences(input.uploads)
  const tasks = normalizeTasks(input.imageTasks)
  const primaryTask = tasks[0]
  const mode = inferMode({
    question: originalQuestion,
    requestType: input.requestType,
    task: primaryTask,
    references,
  })
  const modelStrategy = describeModelStrategy(input.model)
  const question = [
    '【通用设计生图执行契约】',
    `原始任务（完整保留）：${originalQuestion}`,
    `输出模式：${mode}`,
    `当前模型：${cleanText(input.model, '由应用选择')}。${modelStrategy}`,
    describeReferences(references),
    ...commonConstraints(mode, references),
    '必须实际返回最终图片；不要返回方案、解释、HTML、SVG 源码或 Markdown。',
  ].filter(Boolean).join('\n\n')

  return {
    version: 1,
    mode,
    question,
    modelStrategy,
    references,
    tasks: tasks.map((task) => ({
      id: task.id,
      prompt: compileTaskPrompt(task, mode),
    })),
  }
}

function normalizeReferences(uploads) {
  return (Array.isArray(uploads) ? uploads : []).filter((upload) => (
    upload && typeof upload === 'object'
  )).slice(0, 8).map((upload, index) => {
    const role = Object.hasOwn(REFERENCE_LABELS, upload.role) ? upload.role : 'unknown'
    return {
      index: index + 1,
      name: cleanText(upload.name, `参考图 ${index + 1}`),
      role,
      responsibility: REFERENCE_LABELS[role],
    }
  })
}

function normalizeTasks(imageTasks) {
  return (Array.isArray(imageTasks) ? imageTasks : []).slice(0, 16).map((task, index) => ({
    id: cleanText(task?.id, `image-task-${index + 1}`),
    name: cleanText(task?.name, `AI 生成图片-${index + 1}.png`),
    kind: cleanText(task?.kind, task?.transparent ? 'isolated-asset' : 'full-background'),
    width: positiveInteger(task?.targetSize?.width, 375),
    height: positiveInteger(task?.targetSize?.height, 812),
    transparent: Boolean(task?.transparent),
    textPolicy: ['embedded-exact', 'model-exact'].includes(task?.textPolicy) ? task.textPolicy : undefined,
    exactText: cleanText(task?.exactText, ''),
    prompt: cleanText(task?.prompt, ''),
  }))
}

function inferMode({ question, requestType, task, references }) {
  if (task?.kind === 'component-shell') return 'component-shell'
  if (task?.kind === 'page-background') return 'page-background'
  if (task?.transparent || /(?:独立|单独|透明).{0,12}(?:素材|图片|按钮|图标)/iu.test(question)) {
    return 'isolated-asset'
  }
  if (
    references.some((reference) => reference.role === 'edit-base') ||
    /(?:修改|替换|移除|编辑|重生成|保持不变|只改)/iu.test(question)
  ) return 'image-edit'
  if (/(?:后台|dashboard|管理系统|工作台|网页|web|h5|app|页面|ui|界面|设计稿)/iu.test(question)) {
    return 'ui-page'
  }
  if (/(?:kv|海报|banner|广告|主视觉|活动视觉)/iu.test(question)) return 'marketing-visual'
  if (requestType === 'generate_assets') return 'isolated-asset'
  return 'general-image'
}

function describeModelStrategy(model) {
  const normalized = String(model || '').toLowerCase()
  if (normalized.includes('gpt-image')) {
    return '重点使用明确的位置、层级和逐字文案约束；所有需要出现在图片中的文字必须原样保留。'
  }
  if (normalized.includes('nano-banana')) {
    return '重点使用多参考图职责和不变量约束；逐张说明用途，优先保持主体与编辑底图一致。'
  }
  return '使用清晰的主体、场景、构图、视觉风格和禁止项，不假设模型私有参数。'
}

function describeReferences(references) {
  if (!references.length) return '参考图：无。只依据用户文字生成，不虚构参考图信息。'
  return [
    '参考图职责（序号与实际附件一致）：',
    ...references.map((reference) => (
      `${reference.index}. ${reference.name}；${reference.responsibility}。`
    )),
    '不同职责不得混淆：Prototype 不决定配色，KV 不替代页面结构，Visual 不覆盖 Edit Base。',
  ].join('\n')
}

function commonConstraints(mode, references) {
  const constraints = []
  if (mode === 'ui-page') {
    constraints.push('先满足真实产品 UI 的基本信息架构和组件布局，再应用视觉主题；不能只生成抽象背景、色块或插画。')
    constraints.push('保留可识别的导航、标题、内容区域、按钮、表单、列表或业务模块；所有文字不得互相遮挡。')
  }
  if (mode === 'page-background') {
    constraints.push('只绘制页面底色、纹理和轻量装饰；禁止烘焙文字、按钮、卡片、导航和业务组件。')
  }
  if (mode === 'component-shell') {
    constraints.push('只绘制组件氛围底图：允许铺满画布的底色、渐变、低对比纹理、光效和边缘装饰，中心内容区保持低干扰。')
    constraints.push('禁止卡片、列表项、按钮底座、图片占位框、骨架条、进度条、输入框以及任何汉字、字母、数字、符号、伪文字或业务图片；全部 UI 由编辑器原生节点叠加。')
    constraints.push('画面必须是连续背景平面；禁止重复圆角矩形、横向短条、线框、占位布局、Dashboard 面板或任何 UI 模板式排列。')
  }
  if (mode === 'isolated-asset') {
    constraints.push('每个任务只生成一个独立主体；禁止整页、完整组件、多个素材拼图、展示板、设备框和对比图。')
  }
  if (mode === 'image-edit') {
    constraints.push('只修改用户明确指定的对象或区域；保持主体身份、构图、已有文字、尺寸和其他区域不变，禁止重新设计整张图片。')
  }
  if (mode === 'marketing-visual') {
    constraints.push('建立清晰的主视觉、标题和信息层级；用户给出的文案必须逐字保留，不添加无关品牌或口号。')
  }
  if (references.some((reference) => reference.role === 'prototype')) {
    constraints.push('必须先还原 Prototype 的基本布局、模块顺序和可见文字，再做视觉设计。')
  }
  if (references.some((reference) => reference.role === 'kv')) {
    constraints.push('必须从 KV 延续主色、明暗关系、材质和装饰语言，禁止退回无关的默认主题。')
  }
  return constraints
}

function compileTaskPrompt(task, mode) {
  return [
    task.prompt ? `当前任务原文：${task.prompt}` : '',
    `只生成文件：${task.name}。`,
    `素材类型：${task.kind}；目标尺寸：${task.width} x ${task.height}px。`,
    mode === 'isolated-asset' ? '画面只能包含一个目标主体，主体边界紧凑且完整。' : '',
    task.textPolicy === 'embedded-exact'
      ? '该素材将由 Runtime 合成准确文案。模型只生成纯图形底图，禁止出现任何汉字、字母、数字、标点、符号、Logo 字样或伪文字；中央保留干净的文字承载区域。'
      : '',
    task.textPolicy === 'model-exact'
      ? `素材图片自身必须清晰包含且只包含准确文案“${task.exactText}”；禁止省略、改写、重复或生成其他文字。`
      : '',
    task.transparent
      ? '必须输出真实透明 PNG：主体外所有背景像素 alpha=0；禁止棋盘格、白底、灰底、纯色底、展示板、画框和背景截图。'
      : '输出完整构图，内容覆盖目标画面，不要产生意外透明边缘。',
  ].filter(Boolean).join('\n')
}

function cleanText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function positiveInteger(value, fallback) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : fallback
}
