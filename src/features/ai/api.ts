import { fetchEventSource } from '@microsoft/fetch-event-source'
import { createBlankDocument } from '../editor/data/sample-document'
import type { GenerationMeta } from '../editor/types'
import type {
  ChatEditCallbacks,
  ChatEditRequest,
  ChatEditResult,
  GenerateRequest,
  GenerateResult,
  RuntimeImageArtifact,
} from './types'

const COPILOT_API_URL =
  import.meta.env.VITE_COPILOT_API_URL ||
  'https://copilot.bilibili.co/api/v1/prediction/e3558bcf-64ee-4522-85a5-e07ccfc7d99f'

export async function generateDesign(request: GenerateRequest): Promise<GenerateResult> {
  const title = request.prompt.trim() ? request.prompt.trim().slice(0, 24) : 'AI 生成设计稿'
  const document = createBlankDocument(title)
  return { projectId: document.id, document }
}

export async function applyChatEdit(
  request: ChatEditRequest,
  callbacks: ChatEditCallbacks = {},
): Promise<ChatEditResult> {
  const usesRuntime = Boolean(window.aiCampaignRuntime)

  if (usesRuntime) {
    const result = await readRuntimeStream(request, callbacks)
    if (result.awaitingConfirmation?.type === 'blueprint-confirmation') {
      return {
        kind: 'confirmation',
        document: request.document,
        message: result.text.trim() || result.awaitingConfirmation.message,
        source: 'runtime',
        confirmation: result.awaitingConfirmation,
      }
    }
    if (result.pageDesign && Array.isArray(result.pageComponents) && result.pageShellArtifact) {
      const [pageShell, pageComponents] = await Promise.all([
        rasterizeArtifact(result.pageShellArtifact, 'asset'),
        Promise.all(result.pageComponents.map(async (component) => ({
          index: component.index,
          pageSectionId: component.pageSectionId,
          componentDesign: component.componentDesign,
          images: await Promise.all((component.artifacts ?? []).map((artifact) => (
            rasterizeArtifact(artifact, 'asset')
          ))),
          visualShell: component.visualShellArtifact
            ? await rasterizeArtifact(component.visualShellArtifact, 'asset')
            : undefined,
        }))),
      ])
      return {
        kind: 'page',
        document: request.document,
        message: result.text.trim() || '完整页面已生成并转换为可编辑组件图层。',
        source: 'runtime',
        pageDesign: result.pageDesign,
        pageComponents,
        pageShell,
      }
    }
    if (result.editScope?.type === 'component-region' && result.artifact) {
      const image = await rasterizeArtifact(result.artifact, 'asset')
      return {
        kind: 'component-slot',
        document: request.document,
        message: result.text.trim() || '组件素材已重新生成并替换。',
        source: 'runtime',
        image,
        images: [image],
        editScope: result.editScope,
      }
    }
    if (result.editScope?.type === 'page-shell' && result.artifact) {
      const image = await rasterizeArtifact(result.artifact, 'asset')
      return {
        kind: 'page-shell',
        document: request.document,
        message: result.text.trim() || '页面视觉外壳已重新生成并替换。',
        source: 'runtime',
        image,
        images: [image],
        editScope: result.editScope,
      }
    }
    if (result.componentDesign) {
      const [images, visualShell] = await Promise.all([
        Promise.all((result.artifacts ?? []).map((artifact) => rasterizeArtifact(artifact, 'asset'))),
        result.visualShellArtifact
          ? rasterizeArtifact(result.visualShellArtifact, 'asset')
          : Promise.resolve(undefined),
      ])
      return {
        kind: 'component',
        document: request.document,
        message: `已将 ${result.componentDesign.componentName} 组件设计添加到画布，包含视觉外壳、可编辑图层和 Props Patch。`,
        source: 'runtime',
        images,
        visualShell,
        componentDesign: result.componentDesign,
      }
    }
    const artifacts = result.artifacts?.length
        ? result.artifacts
        : result.artifact
          ? [result.artifact]
          : []
    if (artifacts.length) {
      const isAssetSet = Boolean(result.artifacts?.length)
      const generationMeta = !isAssetSet && request.canvasTarget?.placementMode
        ? {
            sessionId: request.sessionId || 'runtime-session',
            prompt: request.prompt,
            provider: request.provider || 'codex',
            model: request.model || 'gpt-5.5',
            placementMode: request.canvasTarget.placementMode,
            createdAt: new Date().toISOString(),
            refined: result.refined ?? false,
            blueprint: result.blueprint,
            qualityReview: result.qualityReview,
          } satisfies Omit<GenerationMeta, 'parentArtboardId'>
        : undefined
      const images = await Promise.all(
        artifacts.map((artifact) => rasterizeArtifact(
          artifact,
          isAssetSet ? 'asset' : 'design',
          generationMeta,
        )),
      )
      return {
        kind: 'image',
        document: request.document,
        message: result.text.trim() || '已生成设计图并放入画布。',
        source: 'runtime',
        image: images[0],
        images,
      }
    }

    const message = extractResponseText(result.text)
    if (!message) throw new Error('AI 返回为空，请查看 Runtime 日志。')
    return {
      kind: 'text',
      document: request.document,
      message,
      source: 'runtime',
    }
  }

  const rawText = await readCopilotStream(request, callbacks)
  const message = extractResponseText(rawText)
  if (!message) throw new Error('AI 返回为空，请查看网络响应。')
  return {
    kind: 'text',
    document: request.document,
    message,
    source: 'copilot',
  }
}

async function readRuntimeStream(
  request: ChatEditRequest,
  callbacks: ChatEditCallbacks,
) {
  const runtime = window.aiCampaignRuntime
  if (!runtime) throw new Error('Runtime 不可用。')

  const streamId = createId('runtime-stream')
  const removeTokenListener = runtime.onStreamToken((data) => {
    if (data.streamId === streamId) callbacks.onToken?.(data.token)
  })
  const removeErrorListener = runtime.onStreamError(() => undefined)
  const removeAgentEventListener = runtime.onAgentEvent((data) => {
    if (data.streamId === streamId) callbacks.onAgentEvent?.(data.event)
  })
  const removeDeliverableListener = runtime.onDeliverable((data) => {
    if (data.streamId !== streamId) return
    void handleIncrementalDeliverable(runtime, data.deliverable, callbacks)
  })

  try {
    const result = await runtime.startStream({
      streamId,
      sessionId: request.sessionId || streamId,
      projectId: request.document.id,
      type: 'agent_run',
      provider: request.provider || 'codex',
      model: request.model || 'gpt-5.5',
      imageProvider: request.imageProvider || 'biliImage',
      imageModel: request.imageModel || 'gpt-image-2',
      skillNames: request.skillNames ?? [],
      question: request.prompt.trim(),
      history: request.history ?? [],
      uploads: buildAgentUploads(request),
      canvasTarget: request.canvasTarget,
      canvasSnapshot: createCanvasSnapshot(request),
      editScope: request.editScope,
      blueprintOverride: request.blueprintOverride,
      enableVisionReview: request.enableVisionReview ?? false,
    })
    if (result.error) throw new Error(result.error.message || 'Runtime 请求失败。')
    return {
      text: result.text || '',
      artifact: result.artifact,
      artifacts: result.artifacts,
      visualShellArtifact: result.visualShellArtifact,
      blueprint: result.blueprint,
      qualityReview: result.qualityReview,
      refined: result.refined,
      componentDesign: result.componentDesign,
      pageDesign: result.pageDesign,
      pageComponents: result.pageComponents,
      pageShellArtifact: result.pageShellArtifact,
      awaitingConfirmation: result.awaitingConfirmation,
      editScope: result.editScope,
    }
  } finally {
    removeTokenListener()
    removeErrorListener()
    removeAgentEventListener()
    removeDeliverableListener()
  }
}

function createCanvasSnapshot(request: ChatEditRequest) {
  const artboardId = request.canvasTarget?.artboardId
  const artboard = request.document.artboards.find((item) => item.id === artboardId)
  if (!artboard) return undefined
  const elements = request.document.elements.filter((element) => element.artboardId === artboard.id)
  const componentInstances = Object.values(request.document.componentInstances ?? {}).filter((instance) => (
    instance.artboardId === artboard.id
  ))
  return {
    artboardId: artboard.id,
    width: artboard.width,
    height: artboard.height,
    elementCount: elements.length,
    componentCount: componentInstances.length,
    hasPageShell: elements.some((element) => element.designRole === 'page-shell'),
    selectedElementIds: (request.selectedElementIds ?? []).filter((id) => (
      elements.some((element) => element.id === id)
    )),
    elements: elements.slice(0, 80).map((element) => ({
      id: element.id,
      type: element.type,
      name: element.name,
      designRole: element.designRole,
      parentId: element.parentId,
      componentName: element.componentBinding?.componentName,
      instanceId: element.componentBinding?.instanceId,
      pageSectionId: element.componentBinding?.pageSectionId,
      renderMode: element.componentBinding?.renderMode,
      bounds: { x: element.x, y: element.y, width: element.width, height: element.height },
    })),
    truncated: elements.length > 80,
  }
}

async function handleIncrementalDeliverable(
  runtime: NonNullable<typeof window.aiCampaignRuntime>,
  deliverable: RawIncrementalDeliverable,
  callbacks: ChatEditCallbacks,
) {
  try {
    const converted = deliverable.kind === 'page-shell'
      ? {
          ...deliverable,
          pageShell: await rasterizeArtifact(deliverable.pageShellArtifact, 'asset'),
        }
      : {
          ...deliverable,
          component: {
            index: deliverable.component.index,
            pageSectionId: deliverable.component.pageSectionId,
            bounds: deliverable.component.bounds,
            componentDesign: deliverable.component.componentDesign,
            images: await Promise.all((deliverable.component.artifacts ?? []).map((artifact) => (
              rasterizeArtifact(artifact, 'asset')
            ))),
            visualShell: deliverable.component.visualShellArtifact
              ? await rasterizeArtifact(deliverable.component.visualShellArtifact, 'asset')
              : undefined,
          },
        }
    const observation = callbacks.onDeliverable
      ? await callbacks.onDeliverable(converted)
      : {
          status: 'failed' as const,
          summary: 'Renderer 没有注册增量画布交付处理器。',
          errorCode: 'CANVAS_DELIVERY_HANDLER_MISSING',
        }
    await runtime.ackDeliverable(deliverable.id, observation)
  } catch (error) {
    await runtime.ackDeliverable(deliverable.id, {
      status: 'failed',
      summary: error instanceof Error ? error.message : '增量画布交付失败。',
      errorCode: 'CANVAS_DELIVERY_RENDERER_FAILED',
    })
  }
}

type RawIncrementalDeliverable = {
  id: string
  sessionId: string
  runId: string
  stepId: string
  target?: ChatEditRequest['canvasTarget']
} & ({
  kind: 'page-component'
  component: {
    index?: number
    pageSectionId?: string
    bounds?: { x: number; y: number; width: number; height: number }
    componentDesign: import('../editor/types').ComponentDesignMeta
    artifacts: RuntimeImageArtifact[]
    visualShellArtifact?: RuntimeImageArtifact
  }
} | {
  kind: 'page-shell'
  blueprint: import('../editor/types').PageCompositionBlueprint
  pageShellArtifact: RuntimeImageArtifact
})

function buildChatQuestion(request: ChatEditRequest) {
  const history = (request.history ?? [])
    .slice(-12)
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.text}`)
    .join('\n')

  return [
    '你是 AI Campaign Page Studio 的助手。请像正常聊天一样直接回答，不要返回 JSON、DesignDocument 或 operations。',
    history ? `最近对话：\n${history}` : '',
    request.referenceImages?.length
      ? `本次附带 ${request.referenceImages.length} 张图片，请结合图片内容回答。`
      : '',
    `用户：${request.prompt.trim()}`,
  ].filter(Boolean).join('\n\n')
}

async function readCopilotStream(request: ChatEditRequest, callbacks: ChatEditCallbacks) {
  let rawText = ''
  await fetchEventSource(COPILOT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json, text/plain',
    },
    body: JSON.stringify({
      question: buildChatQuestion(request),
      stream: true,
      streaming: true,
      uploads: buildUploads(request.referenceImages, request.referenceImageNames),
    }),
    openWhenHidden: true,
    onmessage(event) {
      rawText += `${event.data}\n`
      const token = extractResponseText(event.data)
      if (token) callbacks.onToken?.(token)
    },
    onerror(error) {
      throw error
    },
  })
  return rawText
}

function buildAgentUploads(request: ChatEditRequest) {
  const uploads = new Map<string, ReturnType<typeof createUpload>>()
  for (const message of request.history ?? []) {
    for (const image of message.referenceImages ?? []) {
      uploads.set(image.src, createUpload(image.src, image.name, message.text))
    }
  }
  for (let index = 0; index < (request.referenceImages?.length ?? 0); index += 1) {
    const src = request.referenceImages?.[index]
    if (!src) continue
    const name = request.referenceImageNames?.[index] || `参考图 ${index + 1}`
    uploads.set(src, createUpload(src, name, request.prompt))
  }
  return Array.from(uploads.values())
}

function createUpload(data: string, name: string, context = '') {
  return {
    data,
    type: 'file',
    name: normalizeFileName(name, getImageExtension(data)),
    mime: getImageMime(data),
    context,
  }
}

function buildUploads(images: string[] = [], imageNames: string[] = []) {
  return images.map((data, index) => ({
    data,
    type: 'file',
    name: normalizeFileName(imageNames[index] || `reference-${index + 1}`, getImageExtension(data)),
    mime: getImageMime(data),
  }))
}

function normalizeFileName(name: string, extension: string) {
  const cleanName = name.trim().replace(/[/:*?"<>|]/g, '-')
  if (/\.[a-z0-9]{1,8}$/i.test(cleanName)) return cleanName
  return `${cleanName || 'reference'}.${extension}`
}

function getImageMime(src: string) {
  return src.match(/^data:([^;]+);/)?.[1] || 'image/png'
}

function getImageExtension(src: string) {
  const mime = getImageMime(src)
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'png'
}

function extractResponseText(raw: string): string {
  const value = raw.trim()
  if (!value) return ''

  if (!value.startsWith('data:') && !value.startsWith('{') && !value.startsWith('[')) {
    return value
  }

  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const extracted = lines.map((line) => {
    const payload = line.startsWith('data:') ? line.slice(5).trim() : line
    if (payload === '[DONE]') return ''
    try {
      return findText(JSON.parse(payload))
    } catch {
      return payload
    }
  }).filter(Boolean)

  return extracted.join('') || value
}

function findText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(findText).join('')
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  for (const key of ['delta', 'text', 'content', 'answer', 'message', 'output_text']) {
    const text = findText(record[key])
    if (text) return text
  }
  return ''
}

async function rasterizeArtifact(
  artifact: RuntimeImageArtifact,
  placement: 'design' | 'asset',
  generationMeta?: Omit<GenerationMeta, 'parentArtboardId'>,
  componentDesign?: import('../editor/types').ComponentDesignMeta,
) {
  if (artifact.kind === 'raster') {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(artifact.mime) || !artifact.content) {
      throw new Error('图片任务返回了无效的位图制品。')
    }
    const src = `data:${artifact.mime};base64,${artifact.content}`
    const source = await loadImage(src)
    return {
      src,
      width: Math.max(1, source.naturalWidth || artifact.width),
      height: Math.max(1, source.naturalHeight || artifact.height),
      mime: 'image/png' as const,
      name: artifact.name || 'AI 生成设计图.png',
      placement,
      generationMeta,
      componentDesign,
    }
  }
  if (artifact.kind !== 'svg' || !artifact.content.includes('<svg')) {
    throw new Error('图片任务没有返回有效的 SVG 制品。')
  }
  const blob = new Blob([artifact.content], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const source = await loadImage(url)
    const width = Math.max(1, source.naturalWidth || source.width)
    const height = Math.max(1, source.naturalHeight || source.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建图片渲染画布。')
    context.drawImage(source, 0, 0, width, height)
    return {
      src: canvas.toDataURL('image/png'),
      width,
      height,
      mime: 'image/png' as const,
      name: artifact.name || 'AI 生成设计图.png',
      placement,
      generationMeta,
      componentDesign,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('生成的设计图无法加载。'))
    image.src = src
  })
}

function createId(prefix: string) {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${suffix}`
}
