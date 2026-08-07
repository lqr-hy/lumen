import { getProviderRuntime } from './env.mjs'
import { createRuntimeError, resolveModel, resolveProvider } from './providers.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildSkillPrompt,
  executeSkillTool,
  loadComponentFromPrompt,
  loadComponentsFromPrompt,
  resolveSkillNames,
  stageSkills,
} from './skills.mjs'

export async function startRuntimeStream(payload, callbacks = {}) {
  if (payload?.type === 'agent_run') {
    const { runAgent } = await import('./agent.mjs')
    const skillNames = await resolveSkillNames(payload.question, payload.skillNames)
    return runAgent(
      { ...payload, skillNames },
      callbacks,
      {
        invokeProvider: requestProvider,
        decideIntent: requestProvider,
        decideNextAction: requestProvider,
        executeSkillTool,
        loadComponentFromPrompt,
        loadComponentsFromPrompt,
      },
    )
  }
  return requestProvider(payload, callbacks)
}

export async function requestProvider(payload, callbacks = {}) {
  validateRuntimePayload(payload)
  const isImageTask = payload.type === 'generate_image' || payload.type === 'generate_assets'
  const provider = resolveProvider(isImageTask ? payload.imageProvider || payload.provider : payload.provider)
  const model = resolveModel(provider, isImageTask ? payload.imageModel || payload.model : payload.model)
  const runtime = getProviderRuntime(provider)

  if (
    (
      payload.type === 'generate_blueprint' ||
      payload.type === 'extract_visual_theme' ||
      payload.type === 'generate_component_blueprint'
    ) &&
    !provider.capabilities?.svgDesign
  ) {
    throw createRuntimeError(
      'IMAGE_GENERATION_UNSUPPORTED',
      `${provider.label} 当前只支持正常聊天和看图，生成整张设计图请切换到 Codex。`,
      { provider: provider.id },
    )
  }
  if (isImageTask && !provider.capabilities?.svgDesign && !provider.capabilities?.rasterImage) {
    throw createRuntimeError(
      'IMAGE_GENERATION_UNSUPPORTED',
      `${provider.label} 不支持图片生成。`,
      { provider: provider.id },
    )
  }
  if (payload.type === 'vision_review' && !provider.capabilities?.vision) {
    throw createRuntimeError('VISION_REVIEW_UNSUPPORTED', `${provider.label} 不支持图片视觉评审。`)
  }

  if (!runtime.hasApiKey && !provider.apiKeyOptional) {
    throw createRuntimeError(
      'MISSING_API_KEY',
      `未检测到 ${provider.apiKeyEnv}，请在 shell 配置中 export 后重启应用。`,
      { provider: provider.id, apiKeyEnv: provider.apiKeyEnv },
    )
  }

  if (provider.wireApi === 'responses') {
    return requestResponsesApi({ provider, runtime, model, payload, callbacks })
  }
  if (provider.wireApi === 'codex_cli') {
    return requestCodexCli({ provider, model, payload, callbacks })
  }
  if (provider.wireApi === 'anthropic_messages') {
    return requestAnthropicMessagesApi({ provider, runtime, model, payload, callbacks })
  }
  if (provider.wireApi === 'copilot_prediction') {
    return requestCopilotPredictionApi({ provider, runtime, payload, callbacks })
  }
  if (provider.wireApi === 'openai_images') {
    return requestOpenAiImagesApi({ provider, runtime, model, payload })
  }

  throw createRuntimeError(
    'UNSUPPORTED_WIRE_API',
    `当前协议未被应用支持：${provider.wireApi}。`,
    { provider: provider.id, wireApi: provider.wireApi },
  )
}

async function requestOpenAiImagesApi({ provider, runtime, model, payload }) {
  const tasks = normalizeImageTasks(payload)
  const artifacts = await mapWithConcurrency(tasks, 3, (task) => (
    requestOpenAiImageTask({ provider, runtime, model, payload, task })
  ))
  console.info('[runtime] openai-images:end', {
    provider: provider.id,
    model,
    taskType: payload.type,
    artifactCount: artifacts.length,
    artifactBytes: artifacts.reduce((total, artifact) => total + artifact.content.length, 0),
  })
  return payload.type === 'generate_image'
    ? { text: '已生成设计图并放入画布。', artifact: artifacts[0] }
    : { text: `已生成 ${artifacts.length} 个独立素材并放入画布。`, artifacts }
}

async function requestOpenAiImageTask({ provider, runtime, model, payload, task }) {
  const uploads = (payload.uploads ?? []).filter((upload) => (
    typeof upload?.data === 'string' && upload.data.startsWith('data:image/')
  ))
  const endpoint = uploads.length ? 'images/edits' : 'images/generations'
  const url = appendApiPath(runtime.baseUrl, endpoint)
  const size = resolveImageApiSize(task.targetSize)
  const prompt = [
    task.prompt || payload.question,
    `本次只生成一个素材：${task.name || task.id}。`,
    `目标比例约为 ${task.targetSize.width}:${task.targetSize.height}。`,
    task.transparent
      ? '使用透明背景，主体紧贴内容边界，不要添加画框、展示底板、对比图或额外对象。'
      : '生成完整背景，内容必须覆盖整个画面，不要留透明边缘。',
  ].filter(Boolean).join('\n\n')

  let body
  if (uploads.length) {
    body = new FormData()
    body.set('model', model)
    body.set('prompt', prompt)
    body.set('size', size)
    body.set('n', '1')
    body.set('output_format', 'png')
    if (task.transparent) body.set('background', 'transparent')
    uploads.slice(0, 4).forEach((upload, index) => {
      const parsed = parseImageDataUri(upload.data)
      body.append('image[]', new Blob([parsed.buffer], { type: parsed.mime }), upload.name || `reference-${index + 1}.png`)
    })
  } else {
    body = JSON.stringify({
      model,
      prompt,
      size,
      n: 1,
      output_format: 'png',
      ...(task.transparent ? { background: 'transparent' } : {}),
    })
  }

  console.info('[runtime] openai-images:start', {
    provider: provider.id,
    model,
    endpoint,
    taskId: task.id,
    size,
    uploadCount: uploads.length,
    promptPreview: truncate(prompt, 600),
  })
  const response = await fetchWithRuntimeError(provider, url, {
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
    const errorText = await readSafeResponseText(response)
    throw createRuntimeError(
      'IMAGE_UPSTREAM_REQUEST_FAILED',
      `生图服务请求失败：${response.status} ${response.statusText || ''}${errorText ? `：${errorText.slice(0, 240)}` : ''}`.trim(),
      { provider: provider.id, status: response.status, taskId: task.id },
    )
  }
  const source = await response.json().catch(() => undefined)
  const image = source?.data?.[0]
  if (!image) throw createRuntimeError('IMAGE_RESPONSE_INVALID', '生图服务没有返回图片数据。')
  const raster = await readGeneratedImage(image, payload.signal)
  const dimensions = readRasterDimensions(raster.buffer, raster.mime)
  return {
    kind: 'raster',
    content: raster.buffer.toString('base64'),
    mime: raster.mime,
    width: dimensions?.width || task.targetSize.width,
    height: dimensions?.height || task.targetSize.height,
    name: normalizeRasterArtifactName(task.name, raster.mime),
  }
}

function normalizeImageTasks(payload) {
  const source = Array.isArray(payload.imageTasks) && payload.imageTasks.length
    ? payload.imageTasks
    : [{
        id: payload.type === 'generate_image' ? 'design-image' : 'design-asset',
        name: payload.type === 'generate_image' ? 'AI 生成设计图.png' : 'AI 生成素材.png',
        targetSize: {
          width: Number(payload.canvasTarget?.width) || 375,
          height: Number(payload.canvasTarget?.height) || 812,
        },
        transparent: payload.type === 'generate_assets',
        prompt: payload.question,
      }]
  if (source.length > 16) throw createRuntimeError('IMAGE_TASK_LIMIT', '单次生图任务不能超过 16 个。')
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
      prompt: typeof task.prompt === 'string' && task.prompt.trim() ? task.prompt.trim() : payload.question,
    }
  })
}

function resolveImageApiSize(targetSize) {
  const ratio = targetSize.width / targetSize.height
  if (ratio < 0.82) return '1024x1536'
  if (ratio > 1.22) return '1536x1024'
  return '1024x1024'
}

function appendApiPath(baseUrl, endpoint) {
  return `${String(baseUrl).replace(/\/+$/, '')}/${endpoint}`
}

function parseImageDataUri(value) {
  const match = String(value).match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i)
  if (!match) throw createRuntimeError('IMAGE_UPLOAD_INVALID', '参考图不是受支持的 PNG、JPEG 或 WebP。')
  return { mime: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') }
}

async function readGeneratedImage(image, signal) {
  if (typeof image.b64_json === 'string' && image.b64_json.trim()) {
    const buffer = Buffer.from(image.b64_json, 'base64')
    return validateRasterBuffer(buffer, detectRasterMime(buffer))
  }
  if (typeof image.url === 'string' && /^https?:\/\//i.test(image.url)) {
    const response = await fetch(image.url, { signal })
    if (!response.ok) throw createRuntimeError('IMAGE_DOWNLOAD_FAILED', `生成图片下载失败：${response.status}。`)
    const buffer = Buffer.from(await response.arrayBuffer())
    return validateRasterBuffer(buffer, normalizeRasterMime(response.headers.get('content-type')) || detectRasterMime(buffer))
  }
  throw createRuntimeError('IMAGE_RESPONSE_INVALID', '生图服务未返回 b64_json 或可下载 URL。')
}

function validateRasterBuffer(buffer, mime) {
  if (!mime) throw createRuntimeError('IMAGE_MIME_INVALID', '生图服务返回了不支持的图片格式。')
  if (!buffer.length || buffer.length > 30 * 1024 * 1024) {
    throw createRuntimeError('IMAGE_SIZE_INVALID', '生图服务返回的图片为空或超过 30MB。')
  }
  return { buffer, mime }
}

function normalizeRasterMime(value) {
  const mime = String(value || '').split(';')[0].trim().toLowerCase()
  return ['image/png', 'image/jpeg', 'image/webp'].includes(mime) ? mime : undefined
}

function detectRasterMime(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

function readRasterDimensions(buffer, mime) {
  if (mime === 'image/png' && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (mime === 'image/jpeg') {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue }
      const marker = buffer[offset + 1]
      const length = buffer.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      }
      offset += Math.max(2, length + 2)
    }
  }
  if (mime === 'image/webp' && buffer.length >= 30 && buffer.toString('ascii', 12, 16) === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    }
  }
  return undefined
}

function normalizeRasterArtifactName(name, mime) {
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]
  const base = String(name || 'AI 生成图片').replace(/\.(?:png|jpe?g|webp|svg)$/i, '')
  return `${base}.${extension}`
}

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

async function requestCodexCli({ provider, model, payload, callbacks }) {
  const codexPath = process.env.CODEX_CLI_PATH || '/Applications/ChatGPT.app/Contents/Resources/codex'
  const jobDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-campaign-runtime-'))
  const outputPath = path.join(jobDirectory, 'reply.txt')
  const blueprintPath = path.join(jobDirectory, 'design-blueprint.json')
  const componentBlueprintPath = path.join(jobDirectory, 'component-blueprint.json')
  const visualThemePath = path.join(jobDirectory, 'visual-theme.json')
  const agentDecisionPath = path.join(jobDirectory, 'agent-decision.json')
  const agentNextActionPath = path.join(jobDirectory, 'agent-next-action.json')
  const artifactPath = path.join(jobDirectory, 'design.svg')
  const artifactsDirectory = path.join(jobDirectory, 'artifacts')
  const artifactsManifestPath = path.join(artifactsDirectory, 'manifest.json')
  const visionReviewPath = path.join(jobDirectory, 'vision-review.json')

  try {
    const imagePaths = await materializeUploads(jobDirectory, payload.uploads)
    const stagedSkills = payload.type === 'decide_agent_action' || payload.type === 'decide_agent_next_action'
      ? []
      : await stageSkills(jobDirectory, payload.skillNames)
    const skillPrompt = buildSkillPrompt(stagedSkills)
    const isBlueprintTask = payload.type === 'generate_blueprint'
    const isAgentDecisionTask = payload.type === 'decide_agent_action'
    const isAgentNextActionTask = payload.type === 'decide_agent_next_action'
    const isVisualThemeTask = payload.type === 'extract_visual_theme'
    const isComponentBlueprintTask = payload.type === 'generate_component_blueprint'
    const isImageTask = payload.type === 'generate_image'
    const isAssetTask = payload.type === 'generate_assets'
    const isVisionReviewTask = payload.type === 'vision_review'
    const isArtifactTask = isAgentDecisionTask || isAgentNextActionTask || isBlueprintTask || isVisualThemeTask || isComponentBlueprintTask || isImageTask || isAssetTask || isVisionReviewTask
    const taskPrompt = isAgentDecisionTask
      ? buildCodexAgentDecisionPrompt(payload.question, agentDecisionPath)
      : isAgentNextActionTask
      ? buildCodexAgentNextActionPrompt(payload.question, agentNextActionPath)
      : isVisualThemeTask
      ? buildCodexVisualThemePrompt(payload.question, visualThemePath)
      : isComponentBlueprintTask
      ? buildCodexComponentBlueprintPrompt(payload.question, componentBlueprintPath)
      : isBlueprintTask
      ? buildCodexBlueprintPrompt(payload.question, blueprintPath)
      : isImageTask
        ? buildCodexImagePrompt(payload.question, artifactPath)
        : isAssetTask
          ? buildCodexAssetsPrompt(payload.question, artifactsDirectory, artifactsManifestPath)
          : isVisionReviewTask
            ? buildCodexVisionReviewPrompt(payload.question, visionReviewPath)
          : [
              payload.question,
              '',
              '请只输出给用户看的正常聊天回复，不要返回 JSON、DesignDocument 或 operations，也不要修改本地文件。',
            ].join('\n')
    const prompt = [skillPrompt, taskPrompt].filter(Boolean).join('\n\n')

    console.info('[runtime] codex-cli:start', {
      provider: provider.id,
      model,
      taskType: payload.type,
      imageCount: imagePaths.length,
      skillNames: stagedSkills.map((skill) => skill.name),
      jobDirectory,
      promptPreview: truncate(prompt, 1200),
    })

    const args = [
      '--ask-for-approval',
      'never',
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      isArtifactTask ? 'workspace-write' : 'read-only',
      '-C',
      jobDirectory,
      '-m',
      model,
    ]
    for (const imagePath of imagePaths) args.push('--image', imagePath)
    args.push('-o', outputPath, '-')

    await runProcess(codexPath, args, prompt, payload.signal)
    const text = await readOutputFile(outputPath, false)
    if (isAgentDecisionTask) {
      const conversationDecision = JSON.parse(await fs.readFile(agentDecisionPath, 'utf8'))
      console.info('[runtime] codex-cli:end', {
        provider: provider.id,
        taskType: payload.type,
        action: conversationDecision.action,
        mode: conversationDecision.mode,
      })
      return { text: conversationDecision.response || '', conversationDecision }
    }
    if (isAgentNextActionTask) {
      const agentNextAction = JSON.parse(await fs.readFile(agentNextActionPath, 'utf8'))
      console.info('[runtime] codex-cli:end', {
        provider: provider.id,
        taskType: payload.type,
        mode: agentNextAction.mode,
        tool: agentNextAction.tool?.name,
      })
      return { text: agentNextAction.response || '', agentNextAction }
    }
    if (isVisualThemeTask) {
      const source = JSON.parse(await fs.readFile(visualThemePath, 'utf8'))
      const visualTheme = normalizeComponentVisualTheme(source)
      if (!visualTheme) {
        throw createRuntimeError('VISUAL_THEME_INVALID', 'KV 主题分析没有返回有效的颜色和视觉风格。')
      }
      console.info('[runtime] codex-cli:end', {
        provider: provider.id,
        taskType: payload.type,
        colorCount: visualTheme.colors.length,
      })
      return { text: '页面 KV 主题分析完成。', visualTheme }
    }
    if (isComponentBlueprintTask) {
      const componentBlueprint = await readComponentBlueprint(componentBlueprintPath)
      console.info('[runtime] codex-cli:end', {
        provider: provider.id,
        taskType: payload.type,
        regionCount: componentBlueprint.regions.length,
      })
      return {
        text: '组件原型结构规划完成。',
        componentBlueprint,
      }
    }
    if (isBlueprintTask) {
      const blueprint = await readDesignBlueprint(blueprintPath)
      console.info('[runtime] codex-cli:end', {
        provider: provider.id,
        taskType: payload.type,
        sectionCount: blueprint.sections.length,
      })
      return {
        text: '设计结构规划完成。',
        blueprint,
      }
    }
    if (isImageTask) {
      const artifact = await readSvgArtifact(artifactPath, jobDirectory)
      console.info('[runtime] codex-cli:end', {
        provider: provider.id,
        taskType: payload.type,
        artifactBytes: artifact.content.length,
      })
      return {
        text: '已生成设计图并放入画布。',
        artifact,
      }
    }
    if (isAssetTask) {
      const artifacts = await readAssetArtifacts(
        artifactsManifestPath,
        artifactsDirectory,
        jobDirectory,
      )
      console.info('[runtime] codex-cli:end', {
        provider: provider.id,
        taskType: payload.type,
        artifactCount: artifacts.length,
        artifactBytes: artifacts.reduce((total, artifact) => total + artifact.content.length, 0),
      })
      return {
        text: `已生成 ${artifacts.length} 个独立素材并放入画布。`,
        artifacts,
      }
    }
    if (isVisionReviewTask) {
      const visionReview = JSON.parse(await fs.readFile(visionReviewPath, 'utf8'))
      return { text: '视觉评审完成。', visionReview }
    }

    console.info('[runtime] codex-cli:end', {
      provider: provider.id,
      taskType: payload.type,
      textLength: text.length,
      textPreview: truncate(text, 800),
    })
    if (text) callbacks.onToken?.(text)
    return { text }
  } finally {
    await fs.rm(jobDirectory, { recursive: true, force: true }).catch(() => {})
  }
}

function buildCodexBlueprintPrompt(question, blueprintPath) {
  return [
    question,
    '',
    '【Design Blueprint 输出任务】',
    `请使用工具在 ${blueprintPath} 创建一份 JSON，不要创建 SVG、HTML、React、H5、DesignDocument 或 operations。`,
    'JSON 必须包含：version=1、mode、canvas、theme、sections、constraints。',
    'canvas 必须包含正数 width 和 estimatedHeight。theme 必须包含 colors 数组和 visualStyle。',
    'sections 必须是非空数组，每项包含 id、type、purpose、estimatedHeight、source。',
    'source 只能是 prototype、prompt 或 existing-canvas。',
    '原型图存在时，它是模块、顺序和结构的唯一来源；KV 只提供视觉风格，不得新增业务模块。',
    'append-section 模式只能规划本次新增的局部模块，禁止规划完整页面。',
    'constraints 必须包含 prototypeIsStructureSource 和 forbiddenAdditions。',
    '完成后只需简短确认；Runtime 只读取 JSON 文件。',
  ].join('\n')
}

function buildCodexAgentDecisionPrompt(question, outputPath) {
  return [
    question,
    '',
    '【Conversation Agent Decision 输出任务】',
    `请在 ${outputPath} 写入一个 JSON 对象，不要修改其他文件。`,
    'JSON 必须包含 version=1、mode、action、taskKind、confidence、reason，可选 target 和 response。',
    'mode 只能是 reply、execute、clarify。',
    'action 只能是 chat、continue、create-artboard、create-page、create-component、create-assets、create-image、revise-page、revise-page-shell、revise-component、regenerate-slot。',
    'confidence 必须是 0 到 1 的数字。reply 或 clarify 必须提供直接面向用户的 response。',
    '只做决策，禁止创建页面、组件、SVG、DesignDocument、operations 或任何其他文件。',
  ].join('\n')
}

function buildCodexAgentNextActionPrompt(question, outputPath) {
  return [
    question,
    '',
    '【ReAct Agent NextAction 输出任务】',
    `请在 ${outputPath} 写入一个 JSON 对象，不要修改其他文件。`,
    'JSON 必须包含 version=1、mode、confidence、reason。mode 只能是 tool、clarify、finish。',
    'mode=tool 时必须包含 tool.stepId 和 tool.name，只能从任务提供的 readySteps 或 inspectTools 原样选择。',
    'mode=clarify 时必须提供直接面向用户的 response。confidence 必须是 0 到 1 的数字。',
    '只做下一步决策，禁止执行工具、创建页面、组件、SVG、DesignDocument、operations 或其他文件。',
  ].join('\n')
}

function buildCodexVisualThemePrompt(question, outputPath) {
  return [
    question,
    '',
    '【VisualThemeContract 输出任务】',
    `请查看附带的 KV/视觉参考图，并在 ${outputPath} 写入一个 JSON 对象。`,
    '只分析视觉主题，不生成页面、组件、SVG、HTML、DesignDocument 或 operations。',
    'JSON 必须包含 source、referenceImageIndex、colors、colorTokens、typography、surfaces、effects、imagery、decoration、spacing、visualStyle、confidence。',
    'source 使用 kv 或 visual；colors 提取 3 至 8 个主导色，必须忠实于参考图，禁止使用组件默认蓝色替代。',
    'colorTokens 包含 primary、secondary、background、surface、text、accent；其他字段描述字体层级、容器、光影、图像质感、装饰母题和间距密度。',
    '不要修改其他文件。',
  ].join('\n')
}

function buildCodexVisionReviewPrompt(question, outputPath) {
  return [
    question,
    '',
    '【Vision Review 输出任务】',
    `请查看附带图片，并在 ${outputPath} 写入 JSON。`,
    'JSON 必须包含 scores、issues 和 message。',
    'scores 必须包含 0-1 数字：theme、readability、hierarchy、referenceSimilarity。',
    'issues 每项必须包含 scope、targetId、severity、message、repairPrompt。',
    '没有明显问题时 issues 使用空数组。不要修改其他文件。',
  ].join('\n')
}

function buildCodexComponentBlueprintPrompt(question, blueprintPath) {
  return [
    question,
    '',
    '【Component Blueprint 输出任务】',
    `请使用工具在 ${blueprintPath} 创建一份 JSON，不要创建最终设计图、HTML、React、H5、DesignDocument 或 operations。`,
    'JSON 必须包含：version=1、componentName、profile、width、height、visualTheme、regions、propertyValues、diagnostics。',
    'visualTheme 必须包含 source、colors、colorTokens、typography、surfaces、effects、imagery、decoration、spacing、visualStyle、confidence。',
    '存在 KV 或视觉参考图时，colors 必须从该图提取 3 至 8 个主导色，source 使用 kv 或 visual，并填写 referenceImageIndex；其他 Token 必须描述该图的字体层级、容器、光影、图像质感、装饰母题和间距密度。',
    'regions 必须是非空数组，每项包含 id、role、bounds、propBindings、renderMode、confidence，可选 slotId；text 区域还必须包含实际 content。',
    'bounds 必须包含非负 x/y 和正数 width/height；所有区域必须位于组件 width/height 内。',
    'renderMode 只能是 runtime、text、color 或 generated-asset。confidence 范围为 0 到 1。',
    'slotId 和 propBindings 只能使用任务中 Contract 已声明的值，禁止编造路径。',
    'propertyValues 只能包含当前 Profile 的 width、height、x、y、spacing、radius、color、visibility 属性完整路径。',
    'role 和 content 必须是明确业务语义或真实可见文案，禁止使用 text、button、background、runtime 等通用占位词。',
    'thumbnail 只负责结构，不得继承 thumbnail 的配色。KV/视觉参考图是强制视觉来源，必须继承主色、辅助色、明暗关系、材质和装饰语言，不得退回组件默认配色。',
    '完成后只需简短确认；Runtime 只读取 JSON 文件。',
  ].join('\n')
}

function buildCodexAssetsPrompt(question, artifactsDirectory, manifestPath) {
  return [
    question,
    '',
    '【独立素材输出任务】',
    `请在 ${artifactsDirectory} 中为每个目标素材分别创建一个 SVG 文件。`,
    `完成后在 ${manifestPath} 写入 JSON manifest。`,
    'manifest 格式：{"artifacts":[{"file":"draw-one.svg","name":"抽一次按钮.png"}]}。',
    '每个 manifest 条目只能对应一个素材，数量必须与用户要求一致，最多 16 个。',
    '禁止把多个按钮或素材拼进同一个 SVG，禁止输出整页、设计稿预览或对比图。任务明确标记 type=visual-shell 时，该条目可以覆盖完整组件画布，但只能包含背景和静态视觉外壳。',
    '每个 SVG 的 width、height 和 viewBox 必须紧贴素材自身边界，局部按钮和装饰默认透明背景。',
    '所有位图必须使用 data URI 内嵌，或引用当前任务目录内的文件；禁止网络地址和任务目录外路径。',
    '不要创建 HTML、React、H5、DesignDocument 或 operations，不要修改输入图片和项目源码。',
    '回复只需简短确认；Runtime 只读取 manifest 中列出的 SVG 文件。',
  ].join('\n')
}

function buildCodexImagePrompt(question, artifactPath) {
  return [
    question,
    '',
    '【输出任务】',
    `请使用工具在 ${artifactPath} 创建且只创建一份 SVG 设计制品。`,
    '这是静态图片制品，不要创建 HTML、React、H5、DesignDocument、operations 或多个页面节点。',
    'SVG 必须包含明确的 width、height 和 viewBox，所有视觉内容都放在同一个 SVG 中。',
    '所有位图必须使用 data URI 内嵌到 SVG，禁止 href 引用本地文件路径或网络地址。',
    '严格遵循上方任务目标决定输出完整页面还是局部模块；优先保证参考原型的结构、中文文案和布局准确，再应用 KV 的视觉风格。',
    '不要修改任何输入图片，也不要修改项目源码。完成后只需简短确认文件已经生成。',
  ].join('\n')
}

async function materializeUploads(directory, uploads = []) {
  const imagePaths = []
  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index]
    const image = parseDataImage(upload?.data)
    if (!image) continue
    const extension = imageExtensionForMime(image.mediaType)
    const role = ['prototype', 'kv', 'visual'].includes(upload?.role)
      ? upload.role
      : 'visual'
    if (image.mediaType === 'image/svg+xml') {
      const filePath = path.join(directory, `${role}-reference-${index + 1}.png`)
      const { nativeImage } = await import('electron')
      const raster = nativeImage.createFromDataURL(upload.data)
      if (raster.isEmpty()) {
        throw createRuntimeError('VISION_SNAPSHOT_INVALID', '页面评审 SVG 无法转换为 PNG。')
      }
      await fs.writeFile(filePath, raster.toPNG())
      imagePaths.push(filePath)
      continue
    }
    const filePath = path.join(directory, `${role}-reference-${index + 1}.${extension}`)
    await fs.writeFile(filePath, Buffer.from(image.data, 'base64'))
    imagePaths.push(filePath)
  }
  return imagePaths
}

function imageExtensionForMime(mime) {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'png'
}

async function readSvgArtifact(artifactPath, jobDirectory, name = 'AI 生成设计图.png') {
  let content = ''
  try {
    content = await fs.readFile(artifactPath, 'utf8')
  } catch {
    throw createRuntimeError(
      'IMAGE_ARTIFACT_MISSING',
      'Codex 没有生成设计图片文件，请重试或调整提示词。',
    )
  }
  if (!/<svg[\s>]/i.test(content) || !/<\/svg>/i.test(content)) {
    throw createRuntimeError('IMAGE_ARTIFACT_INVALID', 'Codex 返回的设计图片不是有效 SVG。')
  }
  content = await inlineLocalSvgImages(content, jobDirectory)
  if (content.length > 8 * 1024 * 1024) {
    throw createRuntimeError('IMAGE_ARTIFACT_TOO_LARGE', '生成的设计图片超过 8MB 限制。')
  }
  return { kind: 'svg', content, name }
}

async function readDesignBlueprint(blueprintPath) {
  let blueprint
  try {
    blueprint = JSON.parse(await fs.readFile(blueprintPath, 'utf8'))
  } catch {
    throw createRuntimeError(
      'DESIGN_BLUEPRINT_MISSING',
      'Codex 没有生成有效的 Design Blueprint JSON，请重试。',
    )
  }
  const allowedModes = new Set([
    'new-artboard',
    'append-section',
    'duplicate-variant',
    'asset-board',
  ])
  const allowedSources = new Set(['prototype', 'prompt', 'existing-canvas'])
  const validSections = Array.isArray(blueprint?.sections) &&
    blueprint.sections.length > 0 &&
    blueprint.sections.length <= 32 &&
    blueprint.sections.every((section) => (
      section &&
      typeof section.id === 'string' && section.id.trim() &&
      typeof section.type === 'string' && section.type.trim() &&
      typeof section.purpose === 'string' && section.purpose.trim() &&
      Number.isFinite(section.estimatedHeight) && section.estimatedHeight > 0 &&
      allowedSources.has(section.source)
    ))
  const valid = blueprint?.version === 1 &&
    allowedModes.has(blueprint.mode) &&
    Number.isFinite(blueprint?.canvas?.width) && blueprint.canvas.width > 0 &&
    Number.isFinite(blueprint?.canvas?.estimatedHeight) && blueprint.canvas.estimatedHeight > 0 &&
    Array.isArray(blueprint?.theme?.colors) &&
    typeof blueprint?.theme?.visualStyle === 'string' &&
    validSections &&
    typeof blueprint?.constraints?.prototypeIsStructureSource === 'boolean' &&
    Array.isArray(blueprint?.constraints?.forbiddenAdditions)

  if (!valid) {
    throw createRuntimeError(
      'DESIGN_BLUEPRINT_INVALID',
      'Design Blueprint 缺少必要字段或包含无效结构。',
    )
  }
  return blueprint
}

async function readComponentBlueprint(blueprintPath) {
  let blueprint
  try {
    blueprint = JSON.parse(await fs.readFile(blueprintPath, 'utf8'))
  } catch {
    throw createRuntimeError(
      'COMPONENT_BLUEPRINT_MISSING',
      'Codex 没有生成有效的 Component Blueprint JSON，请重试。',
    )
  }
  blueprint = normalizeComponentBlueprint(blueprint)
  const issues = inspectComponentBlueprint(blueprint)
  if (issues.length) {
    throw createRuntimeError(
      'COMPONENT_BLUEPRINT_INVALID',
      `Component Blueprint 无效：${issues.slice(0, 6).join('；')}`,
    )
  }
  return blueprint
}

export function normalizeComponentBlueprint(input) {
  const source = input && typeof input === 'object' ? input : {}
  const sourceRegions = Array.isArray(source.regions) ? source.regions : []
  const regions = sourceRegions.map((region, index) => {
    const bounds = region?.bounds && typeof region.bounds === 'object' ? region.bounds : {}
    let x = readFiniteNumber(bounds.x)
    let y = readFiniteNumber(bounds.y)
    let width = readFiniteNumber(bounds.width)
    let height = readFiniteNumber(bounds.height)
    if (Number.isFinite(x) && x < 0 && Number.isFinite(width)) {
      width = Math.max(1, width + x)
      x = 0
    }
    if (Number.isFinite(y) && y < 0 && Number.isFinite(height)) {
      height = Math.max(1, height + y)
      y = 0
    }
    return {
      ...region,
      id: typeof region?.id === 'string' && region.id.trim() ? region.id : `region-${index + 1}`,
      role: typeof region?.role === 'string' && region.role.trim()
        ? region.role
        : typeof region?.id === 'string' && region.id.trim()
          ? region.id
          : `组件区域 ${index + 1}`,
      content: typeof region?.content === 'string' && region.content.trim()
        ? region.content.trim()
        : undefined,
      bounds: { x, y, width, height },
      propBindings: Array.isArray(region?.propBindings)
        ? region.propBindings.filter((path) => typeof path === 'string' && path.trim())
        : [],
      renderMode: ['runtime', 'text', 'color', 'generated-asset'].includes(region?.renderMode)
        ? region.renderMode
        : region?.slotId
          ? 'generated-asset'
          : 'runtime',
      confidence: readFiniteNumber(region?.confidence) ?? (region?.slotId ? 0.8 : 0.5),
    }
  })
  const maxRight = Math.max(0, ...regions.map((region) => (
    Number.isFinite(region.bounds.x) && Number.isFinite(region.bounds.width)
      ? region.bounds.x + region.bounds.width
      : 0
  )))
  const maxBottom = Math.max(0, ...regions.map((region) => (
    Number.isFinite(region.bounds.y) && Number.isFinite(region.bounds.height)
      ? region.bounds.y + region.bounds.height
      : 0
  )))
  const sourceWidth = readFiniteNumber(source.width)
  const sourceHeight = readFiniteNumber(source.height)
  return {
    ...source,
    version: readFiniteNumber(source.version),
    width: Math.max(Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : 375, maxRight),
    height: Math.max(Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : maxBottom, maxBottom),
    visualTheme: normalizeComponentVisualTheme(source.visualTheme),
    regions,
    propertyValues: source.propertyValues && typeof source.propertyValues === 'object' && !Array.isArray(source.propertyValues)
      ? source.propertyValues
      : {},
    diagnostics: Array.isArray(source.diagnostics) ? source.diagnostics : [],
  }
}

function normalizeComponentVisualTheme(value) {
  if (!value || typeof value !== 'object') return undefined
  const colors = Array.isArray(value.colors)
    ? value.colors.filter((color) => typeof color === 'string' && isCssColor(color)).slice(0, 8)
    : []
  const visualStyle = typeof value.visualStyle === 'string' ? value.visualStyle.trim() : ''
  const source = ['kv', 'visual', 'prompt', 'thumbnail'].includes(value.source)
    ? value.source
    : 'prompt'
  if (!colors.length || !visualStyle) return undefined
  const referenceImageIndex = readFiniteNumber(value.referenceImageIndex)
  return {
    source,
    ...(Number.isFinite(referenceImageIndex) ? { referenceImageIndex } : {}),
    colors,
    colorTokens: normalizeColorTokens(value.colorTokens, colors),
    typography: normalizeTypographyTokens(value.typography),
    surfaces: normalizeSurfaceTokens(value.surfaces, colors),
    effects: normalizeEffectTokens(value.effects),
    imagery: normalizeImageryToken(value.imagery),
    decoration: normalizeDecorationToken(value.decoration),
    spacing: normalizeSpacingToken(value.spacing),
    visualStyle,
    confidence: clamp01(readFiniteNumber(value.confidence) ?? 0.7),
  }
}

function normalizeColorTokens(value, colors) {
  const allowedRoles = new Set(['primary', 'secondary', 'background', 'surface', 'text', 'accent'])
  const tokens = Array.isArray(value) ? value.filter((token) => (
    token && allowedRoles.has(token.role) && typeof token.value === 'string' && isCssColor(token.value)
  )).slice(0, 12).map((token) => ({ role: token.role, value: token.value })) : []
  if (tokens.length) return tokens
  const roles = ['primary', 'secondary', 'background', 'text', 'accent', 'surface']
  return colors.map((color, index) => ({ role: roles[index] ?? 'accent', value: color }))
}

function normalizeTypographyTokens(value) {
  const roles = new Set(['display', 'heading', 'body', 'caption', 'button'])
  const tokens = Array.isArray(value) ? value.filter((token) => (
    token && roles.has(token.role) && Number.isFinite(readFiniteNumber(token.weight))
  )).slice(0, 8).map((token) => ({
    role: token.role,
    ...(typeof token.family === 'string' && token.family.trim() ? { family: token.family.trim() } : {}),
    weight: Math.max(100, Math.min(900, readFiniteNumber(token.weight))),
    ...(Number.isFinite(readFiniteNumber(token.size)) ? { size: Math.max(8, readFiniteNumber(token.size)) } : {}),
    ...(Number.isFinite(readFiniteNumber(token.lineHeight)) ? { lineHeight: Math.max(1, readFiniteNumber(token.lineHeight)) } : {}),
  })) : []
  return tokens.length ? tokens : [
    { role: 'heading', weight: 700 },
    { role: 'body', weight: 400 },
    { role: 'button', weight: 700 },
  ]
}

function normalizeSurfaceTokens(value, colors) {
  const tokens = Array.isArray(value) ? value.filter((token) => (
    token && typeof token.role === 'string' && typeof token.fill === 'string' && isCssColor(token.fill)
  )).slice(0, 8).map((token) => ({
    role: token.role.trim(),
    fill: token.fill,
    radius: Math.max(0, readFiniteNumber(token.radius) ?? 0),
    ...(typeof token.border === 'string' && isCssColor(token.border) ? { border: token.border } : {}),
  })) : []
  return tokens.length ? tokens : [{ role: 'component', fill: colors[1] ?? colors[0], radius: 8 }]
}

function normalizeEffectTokens(value) {
  const types = new Set(['shadow', 'glow', 'gradient', 'texture'])
  return Array.isArray(value) ? value.filter((token) => (
    token && types.has(token.type) && typeof token.value === 'string' && token.value.trim()
  )).slice(0, 12).map((token) => ({ type: token.type, value: token.value.trim() })) : []
}

function normalizeImageryToken(value) {
  return {
    style: typeof value?.style === 'string' && value.style.trim() ? value.style.trim() : 'vector',
    rendering: typeof value?.rendering === 'string' && value.rendering.trim() ? value.rendering.trim() : 'flat',
    keywords: Array.isArray(value?.keywords)
      ? value.keywords.filter((keyword) => typeof keyword === 'string' && keyword.trim()).slice(0, 12)
      : [],
  }
}

function normalizeDecorationToken(value) {
  const density = ['low', 'medium', 'high'].includes(value?.density) ? value.density : 'medium'
  return {
    language: typeof value?.language === 'string' && value.language.trim() ? value.language.trim() : 'minimal',
    motifs: Array.isArray(value?.motifs)
      ? value.motifs.filter((motif) => typeof motif === 'string' && motif.trim()).slice(0, 12)
      : [],
    density,
  }
}

function normalizeSpacingToken(value) {
  const scale = Array.isArray(value?.scale)
    ? value.scale.map(readFiniteNumber).filter((item) => Number.isFinite(item) && item > 0).slice(0, 10)
    : []
  return {
    base: Math.max(1, readFiniteNumber(value?.base) ?? 4),
    scale: scale.length ? scale : [4, 8, 12, 16, 24, 32],
    density: ['compact', 'comfortable', 'spacious'].includes(value?.density)
      ? value.density
      : 'comfortable',
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function isCssColor(value) {
  return /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\(|transparent$)/i.test(value.trim())
}

function inspectComponentBlueprint(blueprint) {
  const renderModes = new Set(['runtime', 'text', 'color', 'generated-asset'])
  const issues = []
  if (blueprint?.version !== 1) issues.push('version 必须为 1')
  if (typeof blueprint?.componentName !== 'string' || !blueprint.componentName.trim()) {
    issues.push('缺少 componentName')
  }
  if (typeof blueprint?.profile !== 'string' || !blueprint.profile.trim()) {
    issues.push('缺少 profile')
  }
  if (!Number.isFinite(blueprint?.width) || blueprint.width <= 0 || blueprint.width > 1500) {
    issues.push('width 必须在 0 到 1500 之间')
  }
  if (!Number.isFinite(blueprint?.height) || blueprint.height <= 0 || blueprint.height > 10000) {
    issues.push('height 必须在 0 到 10000 之间')
  }
  if (!Array.isArray(blueprint?.regions) || !blueprint.regions.length || blueprint.regions.length > 64) {
    issues.push('regions 数量必须在 1 到 64 之间')
    return issues
  }
  blueprint.regions.forEach((region, index) => {
    const prefix = `regions[${index}]`
    const bounds = region?.bounds
    if (typeof region?.id !== 'string' || !region.id.trim()) issues.push(`${prefix} 缺少 id`)
    if (typeof region?.role !== 'string' || !region.role.trim()) issues.push(`${prefix} 缺少 role`)
    if (!Number.isFinite(bounds?.x) || bounds.x < 0) issues.push(`${prefix}.bounds.x 无效`)
    if (!Number.isFinite(bounds?.y) || bounds.y < 0) issues.push(`${prefix}.bounds.y 无效`)
    if (!Number.isFinite(bounds?.width) || bounds.width <= 0) issues.push(`${prefix}.bounds.width 无效`)
    if (!Number.isFinite(bounds?.height) || bounds.height <= 0) issues.push(`${prefix}.bounds.height 无效`)
    if (!renderModes.has(region?.renderMode)) issues.push(`${prefix}.renderMode 无效`)
    if (!Number.isFinite(region?.confidence) || region.confidence < 0 || region.confidence > 1) {
      issues.push(`${prefix}.confidence 必须在 0 到 1 之间`)
    }
  })
  return issues
}

function readFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

async function readAssetArtifacts(manifestPath, artifactsDirectory, jobDirectory) {
  let manifest
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  } catch {
    throw createRuntimeError(
      'ASSET_MANIFEST_MISSING',
      'Codex 没有生成独立素材 manifest，请重试。',
    )
  }
  const entries = Array.isArray(manifest) ? manifest : manifest?.artifacts
  if (!Array.isArray(entries) || !entries.length || entries.length > 16) {
    throw createRuntimeError('ASSET_MANIFEST_INVALID', '独立素材 manifest 数量无效。')
  }

  const artifacts = []
  const seenFiles = new Set()
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry || typeof entry.file !== 'string' || !entry.file.toLowerCase().endsWith('.svg')) {
      throw createRuntimeError('ASSET_MANIFEST_INVALID', '独立素材 manifest 包含无效文件。')
    }
    const artifactPath = path.resolve(artifactsDirectory, entry.file)
    if (
      !artifactPath.startsWith(`${artifactsDirectory}${path.sep}`) ||
      seenFiles.has(artifactPath)
    ) {
      throw createRuntimeError('ASSET_MANIFEST_INVALID', '独立素材路径越界或重复。')
    }
    seenFiles.add(artifactPath)
    const name = normalizeArtifactName(entry.name, index)
    artifacts.push(await readSvgArtifact(artifactPath, jobDirectory, name))
  }
  return artifacts
}

function normalizeArtifactName(value, index) {
  const name = typeof value === 'string' ? value.trim() : ''
  const safeName = name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 120)
  if (!safeName) return `AI 独立素材 ${index + 1}.png`
  return /\.[a-z0-9]{1,8}$/i.test(safeName) ? safeName : `${safeName}.png`
}

async function inlineLocalSvgImages(content, jobDirectory) {
  const matches = Array.from(content.matchAll(/(?:href|xlink:href)=["']([^"']+)["']/gi))
  let result = content
  for (const match of matches) {
    const source = match[1]
    if (!source || /^(?:data:|https?:|#)/i.test(source)) continue
    const filePath = path.isAbsolute(source) ? source : path.resolve(jobDirectory, source)
    if (!filePath.startsWith(`${jobDirectory}${path.sep}`)) {
      throw createRuntimeError('IMAGE_ARTIFACT_INVALID', '生成图片引用了任务目录外的本地文件。')
    }
    let bytes
    try {
      bytes = await fs.readFile(filePath)
    } catch {
      throw createRuntimeError('IMAGE_ARTIFACT_INVALID', '生成图片引用的本地素材不存在。')
    }
    const mime = mimeForImagePath(filePath)
    const dataUri = `data:${mime};base64,${bytes.toString('base64')}`
    result = result.replaceAll(source, dataUri)
  }
  return result
}

function mimeForImagePath(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  return 'image/png'
}

function runProcess(command, args, stdinText, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    let forceKillTimer
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      callback(value)
    }
    const abortProcess = () => {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 3000)
    }
    if (signal?.aborted) abortProcess()
    else signal?.addEventListener('abort', abortProcess, { once: true })
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      console.info('[runtime] codex-cli:event', { preview: truncate(text, 1000) })
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.stdin.on('error', (error) => {
      const code = error?.code === 'EPIPE' ? 'CODEX_CLI_PIPE_CLOSED' : 'CODEX_CLI_STDIN_FAILED'
      const message = error?.code === 'EPIPE'
        ? 'Codex CLI 在输入完成前关闭了管道。'
        : `Codex CLI 输入失败：${error?.message || '未知错误'}`
      finish(reject, createRuntimeError(code, message))
    })
    child.on('error', (error) => {
      finish(reject, createRuntimeError('CODEX_CLI_FAILED', `Codex CLI 启动失败：${error.message}`))
    })
    child.on('close', (code) => {
      if (forceKillTimer) clearTimeout(forceKillTimer)
      signal?.removeEventListener('abort', abortProcess)
      if (signal?.aborted) {
        finish(reject, createRuntimeError('AGENT_CANCELLED', '用户已取消当前任务。'))
        return
      }
      if (code === 0) {
        finish(resolve)
        return
      }
      finish(reject, createRuntimeError(
        'CODEX_CLI_FAILED',
        `Codex CLI 执行失败：${code}${stderr ? `：${truncate(stderr, 1000)}` : ''}`,
      ))
    })
    try {
      if (!child.stdin.destroyed && child.exitCode === null) child.stdin.end(stdinText)
    } catch (error) {
      finish(reject, createRuntimeError('CODEX_CLI_STDIN_FAILED', `Codex CLI 输入失败：${error.message}`))
    }
  })
}

async function readOutputFile(outputPath, remove = true) {
  try {
    const text = await fs.readFile(outputPath, 'utf8')
    if (remove) await fs.unlink(outputPath).catch(() => {})
    return text.trim()
  } catch {
    return ''
  }
}

function validateRuntimePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw createRuntimeError('INVALID_REQUEST', 'runtime 请求为空。')
  }
  if (
    payload.type !== 'chat' &&
    payload.type !== 'decide_agent_action' &&
    payload.type !== 'decide_agent_next_action' &&
    payload.type !== 'generate_blueprint' &&
    payload.type !== 'extract_visual_theme' &&
    payload.type !== 'generate_component_blueprint' &&
    payload.type !== 'generate_image' &&
    payload.type !== 'generate_assets' &&
    payload.type !== 'vision_review'
  ) {
    throw createRuntimeError('INVALID_REQUEST', `暂不支持的 runtime 请求类型：${payload.type}。`)
  }
  if (typeof payload.question !== 'string' || !payload.question.trim()) {
    throw createRuntimeError('INVALID_REQUEST', 'runtime 请求缺少 question。')
  }
  if (payload.sessionId !== undefined && typeof payload.sessionId !== 'string') {
    throw createRuntimeError('INVALID_REQUEST', 'runtime 请求 sessionId 格式错误。')
  }
}

async function requestResponsesApi({ provider, runtime, model, payload, callbacks }) {
  const sessionId = normalizeSessionId(payload.sessionId || payload.session_id || payload.streamId)
  const url = appendSessionIdQuery(getResponsesUrl(runtime.baseUrl), sessionId)
  const bodies = buildResponsesBodies(provider, model, payload, sessionId)
  let lastResult = { text: '' }

  for (const body of bodies) {
    debugRuntimeRequest(provider, url, sessionId, body)
    const response = await fetchWithRuntimeError(provider, url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json, text/plain',
        Authorization: `Bearer ${runtime.apiKey}`,
        session_id: sessionId,
        'Session-Id': sessionId,
        'x-session-id': sessionId,
        'X-Session-ID': sessionId,
        'x-codex-session-id': sessionId,
      },
      body: JSON.stringify(body),
      signal: payload.signal,
    })

    lastResult = await readStreamingResponse(response, {
      provider,
      callbacks,
      extractToken: extractResponsesToken,
    })
    if (lastResult.text.trim()) return lastResult
    console.warn('[runtime] response empty, trying next aicoding input mode', {
      provider: provider.id,
      inputMode: body.metadata?.input_mode,
    })
  }

  return lastResult
}

function buildResponsesBodies(provider, model, payload, sessionId) {
  const inputMode = process.env[provider.inputModeEnv] || 'responses'
  const orderedModes = Array.from(new Set([
    inputMode,
    'responses',
    'message-string',
    'string',
    'question',
    'responses-non-stream',
  ]))
  return orderedModes.map((mode) => buildResponsesBody(mode, model, payload, sessionId))
}

function buildResponsesBody(inputMode, model, payload, sessionId) {
  const base = {
    session_id: sessionId,
    sessionId,
    metadata: {
      session_id: sessionId,
      input_mode: inputMode,
    },
    model,
    stream: true,
    store: false,
    reasoning: {
      effort: process.env.AICODING_REASONING_EFFORT || 'medium',
    },
  }

  if (inputMode === 'responses-non-stream') {
    return {
      ...base,
      stream: false,
      input: [
        {
          role: 'user',
          content: buildResponsesContent(payload),
        },
      ],
    }
  }

  if (inputMode === 'message-string') {
    return {
      ...base,
      input: [
        {
          role: 'user',
          content: payload.question,
        },
      ],
    }
  }

  if (inputMode === 'string') {
    return {
      ...base,
      input: payload.question,
      question: payload.question,
      uploads: payload.uploads ?? [],
    }
  }

  if (inputMode === 'question') {
    return {
      ...base,
      question: payload.question,
      uploads: payload.uploads ?? [],
    }
  }

  return {
    ...base,
    input: [
      {
        role: 'user',
        content: buildResponsesContent(payload),
      },
    ],
  }
}

function normalizeSessionId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function debugRuntimeRequest(provider, url, sessionId, body) {
  console.info('[runtime] request', {
    provider: provider.id,
    wireApi: provider.wireApi,
    url,
    session_id: sessionId,
    bodyKeys: Object.keys(body),
    model: body.model,
    stream: body.stream,
    store: body.store,
    reasoning: body.reasoning,
    inputMode: typeof body.input === 'string' ? 'string' : Array.isArray(body.input) ? 'responses' : body.question ? 'question' : 'unknown',
    inputType: Array.isArray(body.input) ? 'array' : typeof body.input,
    promptPreview: getPromptPreview(body),
    uploadCount: getUploadCount(body),
    bodyPreview: sanitizeBodyPreview(body),
  })
}

async function requestAnthropicMessagesApi({ provider, runtime, model, payload, callbacks }) {
  const url = getAnthropicMessagesUrl(runtime.baseUrl)
  const body = {
    model,
    max_tokens: 4096,
    stream: true,
    messages: [
      {
        role: 'user',
        content: buildAnthropicContent(payload),
      },
    ],
  }
  debugRuntimeRequest(provider, url, payload.sessionId || payload.streamId || '', body)
  const response = await fetchWithRuntimeError(provider, url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json',
      'x-api-key': runtime.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: payload.signal,
  })

  return readStreamingResponse(response, {
    provider,
    callbacks,
    extractToken: extractAnthropicToken,
  })
}

async function requestCopilotPredictionApi({ provider, runtime, payload, callbacks }) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream, application/json, text/plain',
  }
  if (runtime.apiKey) headers.Authorization = `Bearer ${runtime.apiKey}`

  const body = {
    question: payload.question,
    stream: true,
    streaming: true,
    uploads: payload.uploads ?? [],
  }
  debugRuntimeRequest(provider, runtime.baseUrl, payload.sessionId || payload.streamId || '', body)
  const response = await fetchWithRuntimeError(provider, runtime.baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: payload.signal,
  })

  return readStreamingResponse(response, {
    provider,
    callbacks,
    extractToken: extractCopilotToken,
  })
}

async function fetchWithRuntimeError(provider, url, options) {
  try {
    return await fetch(url, options)
  } catch (error) {
    throw createRuntimeError(
      'UPSTREAM_FETCH_FAILED',
      `AI 服务连接失败：${getUrlHost(url) || provider.label}。请检查 ${provider.baseUrlEnv}、网络/VPN 和服务协议。`,
      {
        provider: provider.id,
        baseUrlEnv: provider.baseUrlEnv,
        host: getUrlHost(url),
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  }
}

async function readStreamingResponse(response, { provider, callbacks, extractToken }) {
  debugRuntimeResponseStart(provider, response)
  if (!response.ok) {
    const errorText = await readSafeResponseText(response)
    throw createRuntimeError(
      'UPSTREAM_REQUEST_FAILED',
      `AI 服务请求失败：${response.status} ${response.statusText || ''}${errorText ? `：${errorText.slice(0, 240)}` : ''}`.trim(),
      { provider: provider.id, status: response.status },
    )
  }

  const contentType = response.headers.get('content-type') || ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    const text = await response.text()
    const tokenText = extractTextFromJsonResponse(text)
    debugRuntimeNonStreamResponse(provider, text, tokenText)
    if (tokenText) callbacks.onToken?.(tokenText)
    return { text: tokenText || text }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() || ''
    for (const part of parts) {
      const token = extractToken(part)
      debugRuntimeStreamEvent(provider, part, token)
      if (!token) continue
      const delta = getAppendDelta(text, token)
      if (!delta) continue
      text += delta
      callbacks.onToken?.(delta)
    }
  }

  if (buffer.trim()) {
    const token = extractToken(buffer)
    debugRuntimeStreamEvent(provider, buffer, token)
    if (token) {
      const delta = getAppendDelta(text, token)
      if (delta) {
        text += delta
        callbacks.onToken?.(delta)
      }
    }
  }

  debugRuntimeResponseEnd(provider, text)
  return { text }
}

function getAppendDelta(currentText, nextToken) {
  if (!currentText) return nextToken
  if (nextToken.startsWith(currentText)) return nextToken.slice(currentText.length)
  return nextToken
}

async function readSafeResponseText(response) {
  try {
    return (await response.text()).trim()
  } catch {
    return ''
  }
}

function buildResponsesContent(payload) {
  const content = [{ type: 'input_text', text: payload.question }]
  for (const upload of payload.uploads ?? []) {
    if (typeof upload?.data === 'string' && upload.data.startsWith('data:image/')) {
      content.push({ type: 'input_image', image_url: upload.data })
    }
  }
  return content
}

function debugRuntimeResponseStart(provider, response) {
  console.info('[runtime] response:start', {
    provider: provider.id,
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get('content-type') || '',
  })
}

function debugRuntimeNonStreamResponse(provider, rawText, extractedText) {
  console.info('[runtime] response:non-stream', {
    provider: provider.id,
    rawLength: rawText.length,
    extractedLength: extractedText.length,
    rawPreview: truncate(rawText, 1200),
    extractedPreview: truncate(extractedText, 600),
  })
}

function debugRuntimeStreamEvent(provider, eventBlock, token) {
  console.info('[runtime] response:event', {
    provider: provider.id,
    rawLength: eventBlock.length,
    tokenLength: token.length,
    eventPreview: truncate(eventBlock, 1200),
    tokenPreview: truncate(token, 600),
  })
}

function debugRuntimeResponseEnd(provider, text) {
  console.info('[runtime] response:end', {
    provider: provider.id,
    textLength: text.length,
    textPreview: truncate(text, 800),
  })
}

function getPromptPreview(body) {
  const prompt = typeof body.question === 'string'
    ? body.question
    : typeof body.input === 'string'
      ? body.input
      : extractPromptFromInput(body.input) || extractPromptFromMessages(body.messages)
  return truncate(prompt || '', 1200)
}

function extractPromptFromInput(input) {
  if (!Array.isArray(input)) return ''
  const texts = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.content === 'string') texts.push(item.content)
    if (Array.isArray(item.content)) {
      for (const content of item.content) {
        if (content?.type === 'input_text' && typeof content.text === 'string') texts.push(content.text)
      }
    }
  }
  return texts.join('\n')
}

function extractPromptFromMessages(messages) {
  if (!Array.isArray(messages)) return ''
  return messages
    .map((message) => {
      if (typeof message?.content === 'string') return message.content
      if (!Array.isArray(message?.content)) return ''
      return message.content
        .map((content) => typeof content?.text === 'string' ? content.text : '')
        .filter(Boolean)
        .join('\n')
    })
    .filter(Boolean)
    .join('\n')
}

function getUploadCount(body) {
  if (Array.isArray(body.uploads)) return body.uploads.length
  if (!Array.isArray(body.input)) return 0
  return body.input.reduce((count, item) => {
    if (!Array.isArray(item?.content)) return count
    return count + item.content.filter((content) => content?.type === 'input_image').length
  }, 0)
}

function sanitizeBodyPreview(body) {
  return truncate(JSON.stringify(redactLargePayload(body)), 1600)
}

function redactLargePayload(value) {
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return `[data-image:${value.length}]`
    return value.length > 1200 ? `${value.slice(0, 1200)}...[truncated:${value.length}]` : value
  }
  if (Array.isArray(value)) return value.map(redactLargePayload)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /authorization|api.?key|token/i.test(key) ? '[redacted]' : redactLargePayload(item),
    ]),
  )
}

function truncate(value, maxLength) {
  if (!value) return ''
  return value.length > maxLength ? `${value.slice(0, maxLength)}...[truncated:${value.length}]` : value
}

function buildAnthropicContent(payload) {
  const content = [{ type: 'text', text: payload.question }]
  for (const upload of payload.uploads ?? []) {
    const image = parseDataImage(upload?.data)
    if (!image) continue
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType,
        data: image.data,
      },
    })
  }
  return content
}

function parseDataImage(value) {
  if (typeof value !== 'string') return null
  const match = value.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return { mediaType: match[1], data: match[2] }
}

function getResponsesUrl(baseUrl) {
  return appendPath(baseUrl, 'responses')
}

function getAnthropicMessagesUrl(baseUrl) {
  if (baseUrl.endsWith('/v1')) return appendPath(baseUrl, 'messages')
  return appendPath(baseUrl, 'v1/messages')
}

function appendPath(baseUrl, path) {
  const cleanPath = path.replace(/^\/+/, '')
  if (baseUrl.endsWith(`/${cleanPath}`)) return baseUrl
  return `${baseUrl.replace(/\/+$/, '')}/${cleanPath}`
}

function appendSessionIdQuery(url, sessionId) {
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('session_id', sessionId)
    return parsed.toString()
  } catch {
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}session_id=${encodeURIComponent(sessionId)}`
  }
}

function getUrlHost(url) {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function extractResponsesToken(eventBlock) {
  return extractEventData(eventBlock)
    .map((data) => {
      if (data === '[DONE]') return ''
      try {
        const payload = JSON.parse(data)
        if (payload.type === 'response.output_text.delta') return payload.delta || ''
        if (payload.type === 'response.output_text.done') return payload.text || ''
        if (payload.type === 'response.refusal.delta') return payload.delta || ''
        if (payload.type === 'response.refusal.done') return payload.refusal || payload.text || ''
        if (payload.type === 'response.completed' || payload.type === 'response.done') {
          return extractTextFromValue(payload.response ?? payload)
        }
        if (typeof payload.delta === 'string') return payload.delta
        if (typeof payload.text === 'string') return payload.text
        return extractTextFromValue(payload)
      } catch {
        return ''
      }
    })
    .join('')
}

function extractAnthropicToken(eventBlock) {
  return extractEventData(eventBlock)
    .map((data) => {
      try {
        const payload = JSON.parse(data)
        if (payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta') {
          return payload.delta.text || ''
        }
        if (typeof payload.delta?.text === 'string') return payload.delta.text
        if (typeof payload.text === 'string') return payload.text
        return ''
      } catch {
        return ''
      }
    })
    .join('')
}

function extractCopilotToken(eventBlock) {
  return extractEventData(eventBlock)
    .flatMap((data) => {
      if (data === '[DONE]') return []
      try {
        return extractTokensFromValue(JSON.parse(data))
      } catch {
        return extractTokensFromString(data)
      }
    })
    .join('')
}

function extractEventData(eventBlock) {
  return eventBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.replace(/^data:\s*/, '').trim())
    .filter(Boolean)
}

function extractTextFromJsonResponse(text) {
  try {
    return extractTextFromValue(JSON.parse(text))
  } catch {
    return ''
  }
}

function extractTokensFromValue(value) {
  if (typeof value === 'string') return extractTokensFromString(value)
  if (!value || typeof value !== 'object') return []
  const eventName = typeof value.event === 'string' ? value.event : ''
  if (eventName === 'token') {
    const token = firstString(value.data, value.token, value.text, value.content)
    return token ? [token] : []
  }
  if (eventName === 'done' || eventName === 'metadata' || eventName === 'calledTools') return []
  if (eventName === 'agentFlowEvent') {
    return extractTokensFromString(firstString(value.data, value.text, value.content) ?? '')
  }
  const direct = firstString(value.text, value.answer, value.result, value.response, value.message, value.content, value.output, value.delta, value.token)
  if (direct) return [direct]
  const nested = firstObject(value.result, value.response, value.data, value.message, value.content, value.output)
  if (nested) return extractTokensFromValue(nested)
  const array = firstArray(value.events, value.messages, value.output, value.content, value.data)
  if (array) return array.flatMap(extractTokensFromValue)
  return []
}

function extractTokensFromString(value) {
  const text = value.trim()
  if (!text || text === '[DONE]' || text === 'DONE') return []
  return [value]
}

function extractTextFromValue(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const direct = firstString(value.text, value.answer, value.result, value.response, value.message, value.content, value.output, value.delta, value.token)
  if (direct) return direct
  const nested = firstObject(value.result, value.response, value.data, value.message, value.content, value.output)
  if (nested) return extractTextFromValue(nested)
  const array = firstArray(value.events, value.messages, value.output, value.content, value.data)
  if (array) return array.map(extractTextFromValue).filter(Boolean).join('')
  return ''
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.length > 0)
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === 'object' && !Array.isArray(value))
}

function firstArray(...values) {
  return values.find(Array.isArray)
}
