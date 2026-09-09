import { assertProviderRuntime, getProviderRuntime } from './env.mjs'
import { createRuntimeError, resolveModel, resolveProvider } from './providers.mjs'
import {
  executeSkillTool,
  loadComponentFromPrompt,
  loadComponentsFromPrompt,
  resolveComponentReference,
  resolveSkillNames,
} from './skills.mjs'
import { normalizeVisualTheme } from './pi/structured-results.mjs'
import { normalizeDesignPatch } from './design-patch.mjs'
import { normalizeDesignSpecPatch } from './design-spec-patch.mjs'
import { compositeRasterWithMask, readRasterDimensions } from './raster-analysis.mjs'
import { normalizeRasterForTargetAsync } from './raster-worker-client.mjs'
import { consumeTurnBudget, ensureTurnBudget } from './pi/turn-budget.mjs'

/**
 * Runtime 的统一请求入口。
 * Agent 请求进入 Pi Agent Loop；其余结构化文本和生图任务直接进入 Provider 路由。
 */
export async function startRuntimeStream(payload, callbacks = {}) {
  if (payload?.type === 'agent_run') {
    const { runPiStudioAgent } = await import('./pi/agent-runtime.mjs')
    const skillNames = await resolveSkillNames(
      payload.question,
      payload.skillNames,
      payload.componentReferences,
    )
    return runPiStudioAgent({ ...payload, skillNames }, callbacks, {
      invokeProvider: requestProvider,
      executeSkillTool,
      loadComponentFromPrompt,
      loadComponentsFromPrompt,
      resolveComponentReference,
    })
  }
  return requestProvider(payload, callbacks)
}

/**
 * 校验请求与预算，并根据任务能力选择文本或图片 Provider。
 * 领域 Tool 也通过这里调用模型，因此上层无需感知 Pi 的具体协议。
 */
export async function requestProvider(payload, callbacks = {}) {
  validateRuntimePayload(payload)
  ensureTurnBudget(payload)
  const isImageTask = payload.type === 'generate_image' || payload.type === 'generate_assets'
  consumeTurnBudget(payload, isImageTask ? 'image' : 'model')
  const provider = resolveProvider(
    isImageTask ? payload.imageProvider || payload.provider : payload.provider,
  )
  const runtime = getProviderRuntime(provider)
  assertProviderRuntime(provider, runtime)
  const model = resolveModel(
    provider,
    isImageTask ? payload.imageModel || payload.model : payload.model,
    runtime,
  )

  if (isImageTask && !provider.capabilities?.rasterImage) {
    throw createRuntimeError('IMAGE_GENERATION_UNSUPPORTED', `${provider.label} 不支持图片生成。`)
  }
  if (
    ['vision_review', 'extract_design_tree'].includes(payload.type) &&
    !provider.capabilities?.vision
  ) {
    throw createRuntimeError(
      'VISION_UNSUPPORTED',
      payload.type === 'extract_design_tree'
        ? `${provider.label} 当前模型不支持 thumbnail 视觉节点识别。请切换支持图片输入的推理模型。`
        : `${provider.label} 不支持图片视觉评审。`,
    )
  }
  if (provider.wireApi === 'openai_images') {
    const { requestPiImages } = await import('./pi/model-runtime.mjs')
    return requestPiImages({ provider, runtime, model, payload, transport: requestOpenAiImagesApi })
  }
  const { requestPiTextTask } = await import('./pi/task-runtime.mjs')
  return normalizePiTaskResult(
    payload,
    await requestPiTextTask({
      provider,
      runtime,
      model,
      payload,
      callbacks,
    }),
  )
}

/** 调用生图 Skill，将用户目标、参考图角色和单个图片任务编译为稳定的生成契约。 */
export async function prepareImageGenerationTask(payload, task, uploads) {
  const compiled = await executeSkillTool('design-image-generation.compile-brief', {
    question: payload.question,
    requestType: payload.type,
    model: payload.imageModel || payload.model,
    uploads: (uploads ?? []).map((upload) => ({
      name: upload?.name,
      role: upload?.role,
    })),
    imageTasks: [task],
  })
  return {
    brief: compiled,
    question: compiled.question,
    taskPrompt: compiled.tasks?.[0]?.prompt || task.prompt,
  }
}

/** 将 Pi 结构化任务的通用返回值转换为各领域工作流使用的稳定结果字段。 */
function normalizePiTaskResult(payload, result) {
  const type = payload.type
  if (type === 'chat') return result
  if (type === 'extract_visual_theme') {
    const visualTheme = normalizeVisualTheme(result.data)
    if (!visualTheme) throw createRuntimeError('VISUAL_THEME_INVALID', '模型没有返回有效视觉主题。')
    return { text: '页面 KV 主题分析完成。', visualTheme }
  }
  if (type === 'extract_design_tree') {
    const designTree =
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? result.data
        : undefined
    if (!designTree || !Array.isArray(designTree.nodes)) {
      throw createRuntimeError('DESIGN_TREE_INVALID', '模型没有返回有效的 Thumbnail Design Tree。')
    }
    return { text: '组件 thumbnail 设计节点识别完成。', designTree }
  }
  if (type === 'vision_review') return { text: '视觉评审完成。', visionReview: result.data }
  if (type === 'generate_ui_schema') {
    return {
      text: '通用 UI 结构规划完成。',
      data: result.data,
    }
  }
  if (type === 'generate_ui_runtime') {
    const draft =
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? result.data
        : undefined
    if (!draft || typeof draft.html !== 'string' || typeof draft.css !== 'string') {
      throw createRuntimeError(
        'UI_RUNTIME_DRAFT_INVALID',
        '模型没有返回有效 StaticUiRuntimeDraft。',
      )
    }
    return { text: '通用 UI Runtime Draft 生成完成。', data: draft }
  }
  if (type === 'generate_design_patch') {
    return {
      text: '局部修改规划完成。',
      designPatch: normalizeDesignPatch(result.data, {
        documentRevision: payload.canvasSnapshot?.documentRevision,
        artboardId: payload.canvasSnapshot?.artboardId,
        goal: payload.question,
        scopeId: payload.editScope?.scopeId,
        targetHash: payload.editScope?.targetHash,
        targetElementIds: payload.editScope?.targetElementIds,
      }),
    }
  }
  if (type === 'generate_design_action') {
    return {
      text: '设计动作规划完成。',
      designAction: result.data,
    }
  }
  if (type === 'generate_design_spec_patch') {
    return {
      text: 'DesignSpec 结构修改规划完成。',
      designSpecPatch: normalizeDesignSpecPatch(result.data, {
        documentRevision: payload.canvasSnapshot?.documentRevision,
        artboardId: payload.canvasSnapshot?.artboardId,
        goal: payload.question,
      }),
    }
  }
  throw createRuntimeError('INVALID_REQUEST', `Pi 文本任务不支持：${type}`)
}

/** 串行执行图片任务并汇总 Raster Artifact，避免并发大图占用过多内存和上游配额。 */
async function requestOpenAiImagesApi({ provider, runtime, model, payload }) {
  const tasks = normalizeImageTasks(payload)
  const artifacts = await mapWithConcurrency(tasks, 1, (task) =>
    requestOpenAiImageTask({ provider, runtime, model, payload, task }),
  )
  console.info('[runtime] openai-images:end', {
    provider: provider.id,
    model,
    taskType: payload.type,
    artifactCount: artifacts.length,
    artifactBytes: artifacts.reduce((total, artifact) => total + artifact.content.length, 0),
    // 归一化后 ratioError 恒为 0，构图损失只能靠这两个值观察。
    normalization: artifacts.map((artifact) => ({
      name: artifact.name,
      mode: artifact.analysis?.transform?.mode,
      sourceSize: artifact.analysis?.transform?.sourceSize,
      cropBounds: artifact.analysis?.transform?.sourceBounds,
      cropLoss: Number.isFinite(artifact.analysis?.transform?.cropLoss)
        ? `${Math.round(artifact.analysis.transform.cropLoss * 100)}%`
        : undefined,
    })),
  })
  return payload.type === 'generate_image'
    ? { text: '已生成设计图并放入画布。', artifact: artifacts[0] }
    : { text: `已生成 ${artifacts.length} 个独立素材并放入画布。`, artifacts }
}

/** 执行单个图片任务，包括参考图筛选、Mask 校验、请求发送和输出归一化。 */
async function requestOpenAiImageTask({ provider, runtime, model, payload, task }) {
  const selectedUploads = selectTaskUploads(payload.uploads ?? [], task).filter(
    (upload) => typeof upload?.data === 'string' && upload.data.startsWith('data:image/'),
  )
  const themeOnlyTransparentGeneration = shouldUseThemeOnlyTransparentGeneration(
    provider,
    task,
    selectedUploads,
  )
  const uploads = themeOnlyTransparentGeneration ? [] : selectedUploads
  const maskUpload = uploads.find((upload) => upload.role === 'mask')
  const imageUploads = uploads.filter((upload) => upload.role !== 'mask')
  const editBaseUpload = imageUploads.find((upload) => upload.role === 'edit-base')
  if (task.maskedEdit && (!editBaseUpload || !maskUpload)) {
    throw createRuntimeError(
      'IMAGE_MASK_INPUT_MISSING',
      '图片局部编辑缺少 edit-base 或 mask，已拒绝整图降级。',
    )
  }
  const parsedEditBase = editBaseUpload ? parseImageDataUri(editBaseUpload.data) : undefined
  const parsedMask = maskUpload ? parseImageDataUri(maskUpload.data) : undefined
  if (task.maskedEdit) {
    const baseSize = readRasterDimensions(parsedEditBase.buffer, parsedEditBase.mime)
    const maskSize = readRasterDimensions(parsedMask.buffer, parsedMask.mime)
    if (
      parsedMask.mime !== 'image/png' ||
      !baseSize ||
      !maskSize ||
      baseSize.width !== maskSize.width ||
      baseSize.height !== maskSize.height
    ) {
      throw createRuntimeError(
        'IMAGE_MASK_SIZE_MISMATCH',
        '图片局部编辑要求 edit-base 与 PNG Mask 尺寸完全一致。',
        { baseSize, maskSize },
      )
    }
  }
  const compiled = await prepareImageGenerationTask(payload, task, uploads)
  const endpoint = imageUploads.length ? 'images/edits' : 'images/generations'
  const chromaKey = shouldUseChromaKeyTransparency(provider, model, task, imageUploads)
    ? '#00ff00'
    : undefined
  const url = appendApiPath(runtime.baseUrl, endpoint)
  const size = resolveImageApiSize(task.targetSize)
  const prompt = [
    compiled.question,
    describeSelectedReferences(uploads),
    compiled.taskPrompt ? `当前素材任务：\n${compiled.taskPrompt}` : '',
    `本次只生成一个素材：${task.name || task.id}。`,
    `目标比例约为 ${task.targetSize.width}:${task.targetSize.height}。`,
    // 生图 API 只有固定几档画布尺寸，比例对不上时 Runtime 会居中裁剪。
    // 告知安全区，让裁切可预期，而不是随机切掉主体或标题。
    describeSafeArea(size, task),
    task.transparent
      ? chromaKey
        ? '在完全均匀的纯 #00ff00 色键背景上生成主体，背景不得有阴影、渐变、纹理、反射或光照变化；主体中禁止使用 #00ff00。Runtime 会把色键背景转换成真实透明 Alpha。'
        : '输出带真实 Alpha 通道的透明 PNG：主体外背景像素必须为 alpha=0。禁止绘制灰白棋盘格、白底、灰底、纯色底、展示板、截图背景、画框、对比图或额外对象；主体紧贴内容边界。'
      : '生成完整背景，内容必须覆盖整个画面，不要留透明边缘。',
    task.textPolicy === 'embedded-exact'
      ? '这是等待 Runtime 合成准确文案的纯图形按钮底图。图片内不得出现任何文字、字母、数字、标点、符号或伪文字；中央保留干净区域。'
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  let body
  if (imageUploads.length) {
    body = new FormData()
    body.set('model', model)
    body.set('prompt', prompt)
    body.set('size', size)
    body.set('n', '1')
    body.set('output_format', 'png')
    if (task.transparent && provider.capabilities?.transparentEditParameter) {
      body.set('background', 'transparent')
    }
    imageUploads.slice(0, 4).forEach((upload, index) => {
      const parsed = parseImageDataUri(upload.data)
      body.append(
        'image[]',
        new Blob([parsed.buffer], { type: parsed.mime }),
        upload.name || `reference-${index + 1}.png`,
      )
    })
    if (maskUpload) {
      const parsedMask = parseImageDataUri(maskUpload.data)
      body.set(
        'mask',
        new Blob([parsedMask.buffer], { type: parsedMask.mime }),
        maskUpload.name || 'mask.png',
      )
    }
  } else {
    body = JSON.stringify({
      model,
      prompt,
      size,
      n: 1,
      output_format: 'png',
      ...(task.transparent && !chromaKey && provider.capabilities?.transparentGenerationParameter
        ? { background: 'transparent' }
        : {}),
    })
  }

  console.info('[runtime] openai-images:start', {
    provider: provider.id,
    model,
    endpoint,
    taskId: task.id,
    size,
    uploadCount: imageUploads.length,
    hasMask: Boolean(maskUpload),
    transparentBackgroundParameter: task.transparent
      ? imageUploads.length
        ? provider.capabilities?.transparentEditParameter === true
        : !chromaKey && provider.capabilities?.transparentGenerationParameter === true
      : false,
    transparencyStrategy: chromaKey
      ? 'chroma-key-local-alpha'
      : task.transparent
        ? (
            imageUploads.length
              ? provider.capabilities?.transparentEditParameter
              : provider.capabilities?.transparentGenerationParameter
          )
          ? 'native-alpha'
          : 'prompt-only'
        : undefined,
    promptChars: prompt.length,
    referenceNames: uploads.map((upload) => upload.name),
    referenceFallback: themeOnlyTransparentGeneration ? 'theme-only-generation' : undefined,
    ...(process.env.AI_STUDIO_DEBUG_PROMPTS === '1' ? { promptPreview: prompt.slice(0, 600) } : {}),
  })
  const response = await fetchRuntime(provider, url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${runtime.apiKey}`,
      ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
    signal: payload.signal,
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw createRuntimeError(
      'IMAGE_UPSTREAM_REQUEST_FAILED',
      `生图服务请求失败：${response.status}${errorText ? `：${errorText.slice(0, 240)}` : ''}`,
      { provider: provider.id, status: response.status, taskId: task.id },
    )
  }
  const source = await response.json().catch(() => undefined)
  const image = source?.data?.[0]
  if (!image) throw createRuntimeError('IMAGE_RESPONSE_INVALID', '生图服务没有返回图片数据。')
  const raster = await readGeneratedImage(image, payload.signal)
  if (raster.mime !== 'image/png') {
    throw createRuntimeError(
      'IMAGE_OUTPUT_FORMAT_INVALID',
      `生图服务未按请求返回 PNG，而是 ${raster.mime}；已拒绝绕过像素质量门禁。`,
      { provider: provider.id, taskId: task.id, mime: raster.mime },
    )
  }
  const normalized = await normalizeRasterForTargetAsync(
    raster.buffer,
    raster.mime,
    task.targetSize,
    {
      transparent: task.transparent,
      chromaKey,
      fitMode: task.textPolicy === 'embedded-exact' ? 'fill-content' : undefined,
      signal: payload.signal,
    },
  )
  const finalRaster = task.maskedEdit
    ? compositeRasterWithMask(
        parsedEditBase.buffer,
        parsedEditBase.mime,
        normalized.buffer,
        parsedMask.buffer,
        task.targetSize,
      )
    : normalized
  const dimensions = readRasterDimensions(finalRaster.buffer, finalRaster.mime)
  return {
    kind: 'raster',
    content: finalRaster.buffer.toString('base64'),
    mime: finalRaster.mime,
    width: dimensions?.width || task.targetSize.width,
    height: dimensions?.height || task.targetSize.height,
    name: normalizeRasterArtifactName(task.name, raster.mime),
    analysis: finalRaster.analysis,
  }
}

function normalizeImageTasks(payload) {
  const source =
    Array.isArray(payload.imageTasks) && payload.imageTasks.length
      ? payload.imageTasks
      : [
          {
            id: payload.type === 'generate_image' ? 'design-image' : 'design-asset',
            name: payload.type === 'generate_image' ? 'AI 生成设计图.png' : 'AI 生成素材.png',
            targetSize: {
              width: Number(payload.canvasTarget?.width) || 375,
              height: Number(payload.canvasTarget?.height) || 812,
            },
            transparent: payload.type === 'generate_assets',
            prompt: payload.question,
          },
        ]
  if (source.length > 16)
    throw createRuntimeError('IMAGE_TASK_LIMIT', '单次生图任务不能超过 16 个。')
  return source.map((task, index) => {
    const width = Math.round(Number(task?.targetSize?.width))
    const height = Math.round(Number(task?.targetSize?.height))
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw createRuntimeError('IMAGE_TASK_INVALID', `第 ${index + 1} 个生图任务缺少有效尺寸。`)
    }
    return {
      id: String(task.id || `image-task-${index + 1}`),
      name: String(task.name || `AI 生成素材-${index + 1}.png`),
      targetSize: { width, height },
      transparent: Boolean(task.transparent),
      kind: String(task.kind || (task.transparent ? 'isolated-asset' : 'full-background')),
      referencePolicy: normalizeReferencePolicy(task.referencePolicy),
      maskedEdit: task.maskedEdit === true,
      textPolicy: task.textPolicy === 'embedded-exact' ? 'embedded-exact' : undefined,
      prompt:
        typeof task.prompt === 'string' && task.prompt.trim()
          ? task.prompt.trim()
          : payload.question,
    }
  })
}

function shouldUseChromaKeyTransparency(provider, model, task, imageUploads) {
  if (!task.transparent || task.maskedEdit) return false
  if (imageUploads.length > 0) {
    return provider.capabilities?.transparentEditParameter !== true
  }
  return String(model || '').toLowerCase() === 'gpt-image-2'
}

function selectTaskUploads(uploads, task) {
  const policy = task.referencePolicy
  if (!policy) return uploads
  const allowedRoles = new Set(policy.roles ?? [])
  const allowedNames = new Set(policy.names ?? [])
  const priority = { mask: 6, 'edit-base': 5, content: 4, kv: 3, visual: 2, prototype: 1 }
  const selected = uploads
    .map((upload, index) => ({ upload, index }))
    .filter(
      ({ upload }) =>
        allowedNames.has(upload.name) || (upload.role && allowedRoles.has(upload.role)),
    )
    .sort(
      (left, right) =>
        (priority[right.upload.role] ?? 0) - (priority[left.upload.role] ?? 0) ||
        right.index - left.index,
    )
    .map(({ upload }) => upload)
  return selected.slice(0, policy.maxImages || 4)
}

function describeSelectedReferences(uploads) {
  if (!uploads.length) return ''
  const labels = {
    mask: '局部编辑 Mask',
    'edit-base': '当前编辑底图',
    content: '原图素材（直接使用，禁止重绘）',
    kv: 'KV 视觉来源',
    visual: '视觉参考',
    prototype: '结构原型',
  }
  return [
    '本次实际发送的参考图（以下序号与附件顺序严格一致）：',
    ...uploads.map(
      (upload, index) =>
        `图片 ${index + 1}：${upload.name}；职责=${labels[upload.role] || '普通参考'}。`,
    ),
    '只按上述职责使用图片，不得把结构原型的配色当作视觉主题，也不得把 KV 的布局当作组件结构。',
  ].join('\n')
}

function normalizeReferencePolicy(value) {
  if (!value || typeof value !== 'object') return undefined
  return {
    roles: Array.isArray(value.roles)
      ? value.roles.filter((role) =>
          ['kv', 'visual', 'prototype', 'edit-base', 'content', 'mask'].includes(role),
        )
      : [],
    names: Array.isArray(value.names) ? value.names.filter((name) => typeof name === 'string') : [],
    maxImages: Math.max(1, Math.min(4, Number(value.maxImages) || 4)),
    transparentFallback:
      value.transparentFallback === 'theme-only-generation' ? 'theme-only-generation' : undefined,
  }
}

function shouldUseThemeOnlyTransparentGeneration(provider, task, uploads) {
  if (!task.transparent || task.maskedEdit || !uploads.length) return false
  if (task.referencePolicy?.transparentFallback !== 'theme-only-generation') return false
  if (uploads.some((upload) => upload.role === 'edit-base' || upload.role === 'mask')) return false
  return (
    provider.capabilities?.transparentEditParameter !== true &&
    provider.capabilities?.transparentGenerationParameter === true
  )
}

/**
 * 说明生成画布与目标比例的差异，并给出必须保留关键内容的居中安全区。
 * 只对非透明素材生效：非透明走 cover，必须铺满目标，超出比例的部分会被居中裁掉；
 * 透明素材走 contain（等比缩放 + 四周补透明边距），不会裁切，因此不需要安全区。
 */
function describeSafeArea(size, task) {
  if (task.transparent) return ''
  const [canvasWidth, canvasHeight] = String(size)
    .split('x')
    .map((value) => Number(value))
  const targetRatio = task.targetSize.width / task.targetSize.height
  if (!canvasWidth || !canvasHeight || !Number.isFinite(targetRatio) || targetRatio <= 0) return ''
  const canvasRatio = canvasWidth / canvasHeight
  let safeWidth = canvasWidth
  let safeHeight = canvasHeight
  if (canvasRatio > targetRatio) safeWidth = Math.round(canvasHeight * targetRatio)
  else if (canvasRatio < targetRatio) safeHeight = Math.round(canvasWidth / targetRatio)
  if (safeWidth === canvasWidth && safeHeight === canvasHeight) return ''
  const keptPercent = Math.round(((safeWidth * safeHeight) / (canvasWidth * canvasHeight)) * 100)
  return [
    `画布为 ${canvasWidth}x${canvasHeight}，与目标比例不一致：Runtime 只会保留居中的 ${safeWidth}x${safeHeight} 区域（约占画面 ${keptPercent}%），其余部分会被裁掉。`,
    `主标题、主体、按钮和所有关键信息必须完整落在这个居中 ${safeWidth}x${safeHeight} 安全区内；只把背景、氛围光和可丢弃的装饰放在安全区之外。安全区边缘不要出现被截断的文字或主体。`,
  ].join('\n')
}

function resolveImageApiSize(targetSize) {
  const ratio = targetSize.width / targetSize.height
  if (ratio < 0.82) return '1024x1536'
  if (ratio > 1.22) return '1536x1024'
  return '1024x1024'
}

function parseImageDataUri(value) {
  const match = String(value).match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i)
  if (!match)
    throw createRuntimeError('IMAGE_UPLOAD_INVALID', '参考图不是受支持的 PNG、JPEG 或 WebP。')
  return { mime: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') }
}

async function readGeneratedImage(image, signal) {
  if (typeof image.b64_json === 'string' && image.b64_json.trim()) {
    const buffer = Buffer.from(image.b64_json, 'base64')
    return validateRasterBuffer(buffer, detectRasterMime(buffer))
  }
  if (typeof image.url === 'string' && /^https?:\/\//i.test(image.url)) {
    const response = await fetch(image.url, { signal })
    if (!response.ok)
      throw createRuntimeError('IMAGE_DOWNLOAD_FAILED', `生成图片下载失败：${response.status}。`)
    const buffer = Buffer.from(await response.arrayBuffer())
    const mime =
      normalizeRasterMime(response.headers.get('content-type')) || detectRasterMime(buffer)
    return validateRasterBuffer(buffer, mime)
  }
  throw createRuntimeError('IMAGE_RESPONSE_INVALID', '生图服务未返回 b64_json 或可下载 URL。')
}

function validateRasterBuffer(buffer, mime) {
  if (!mime) throw createRuntimeError('IMAGE_MIME_INVALID', '生图服务返回了不支持的图片格式。')
  if (!buffer.length || buffer.length > 30 * 1024 * 1024) {
    throw createRuntimeError('IMAGE_SIZE_INVALID', '生图服务返回的图片为空或超过 30MB 限制。')
  }
  return { buffer, mime }
}

function normalizeRasterMime(value) {
  const mime = String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  return ['image/png', 'image/jpeg', 'image/webp'].includes(mime) ? mime : undefined
}

function detectRasterMime(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp'
  return undefined
}

function normalizeRasterArtifactName(name, mime) {
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]
  const base = String(name || 'AI 生成图片').replace(/\.(?:png|jpe?g|webp|svg)$/i, '')
  return `${base}.${extension}`
}

/** 以受控并发执行任务，并保持结果顺序与输入任务一致。 */
async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length)
  let cursor = 0
  async function run() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return results
}

/** 在访问凭证或 Provider 前验证外部请求的类型与最小必需字段。 */
function validateRuntimePayload(payload) {
  const allowed = new Set([
    'chat',
    'extract_visual_theme',
    'extract_design_tree',
    'generate_ui_schema',
    'generate_ui_runtime',
    'generate_design_action',
    'generate_design_patch',
    'generate_design_spec_patch',
    'generate_image',
    'generate_assets',
    'vision_review',
  ])
  if (!payload || typeof payload !== 'object')
    throw createRuntimeError('INVALID_REQUEST', 'runtime 请求为空。')
  if (!allowed.has(payload.type))
    throw createRuntimeError('INVALID_REQUEST', `暂不支持的 runtime 请求类型：${payload.type}。`)
  if (typeof payload.question !== 'string' || !payload.question.trim()) {
    throw createRuntimeError('INVALID_REQUEST', 'runtime 请求缺少 question。')
  }
}

function appendApiPath(baseUrl, endpoint) {
  return `${String(baseUrl).replace(/\/+$/, '')}/${endpoint}`
}

/** 包装 Runtime 网络请求，将底层连接异常转换为经过脱敏的领域错误。 */
async function fetchRuntime(provider, url, options) {
  try {
    return await fetch(url, options)
  } catch (error) {
    throw createRuntimeError('UPSTREAM_FETCH_FAILED', `AI 服务连接失败：${provider.label}。`, {
      provider: provider.id,
      host: safeHost(url),
      cause: error instanceof Error ? error.message : String(error),
    })
  }
}

function safeHost(url) {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}
