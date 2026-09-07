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
import { resolveReferenceImageRoles } from './reference-image-role'

export async function generateDesign(request: GenerateRequest): Promise<GenerateResult> {
  const title = request.prompt.trim() ? request.prompt.trim().slice(0, 24) : 'AI 生成设计稿'
  const document = createBlankDocument(title)
  return { projectId: document.id, document }
}

export async function applyChatEdit(
  request: ChatEditRequest,
  callbacks: ChatEditCallbacks = {},
): Promise<ChatEditResult> {
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
  if (result.genericUiSchema) {
    return {
      kind: 'generic-ui',
      document: request.document,
      message: result.text.trim() || '已生成可编辑通用 UI 设计稿。',
      source: 'runtime',
      genericUiSchema: result.genericUiSchema,
      visualAssetReport: result.visualAssetReport,
    }
  }
  if (result.canvasDelivered) {
    return {
      kind: 'text',
      document: request.document,
      message: result.text.trim() || '设计结果已添加到画布。',
      source: 'runtime',
    }
  }
  if (result.pageDesign && Array.isArray(result.pageComponents) && result.pageShellArtifact) {
    const [pageShell, pageComponents] = await Promise.all([
      rasterizeArtifact(result.pageShellArtifact, 'asset'),
      Promise.all(
        result.pageComponents.map(async (component) => ({
          index: component.index,
          pageSectionId: component.pageSectionId,
          componentDesign: component.componentDesign,
          images: await Promise.all(
            (component.artifacts ?? []).map((artifact) => rasterizeArtifact(artifact, 'asset')),
          ),
        })),
      ),
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
      genericUiSchema: result.genericUiSchema,
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
    const images = await Promise.all(
      (result.artifacts ?? []).map((artifact) => rasterizeArtifact(artifact, 'asset')),
    )
    return {
      kind: 'component',
      document: request.document,
      message: `已将 ${result.componentDesign.componentName} 组件设计添加到画布，包含可编辑图层、必要图片素材和 Props Patch。`,
      source: 'runtime',
      images,
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
    const generationMeta =
      !isAssetSet && request.canvasTarget?.placementMode
        ? ({
            sessionId: request.sessionId || 'runtime-session',
            prompt: request.prompt,
            provider: request.provider || 'codex',
            model: request.model || 'gpt-5.5',
            placementMode: request.canvasTarget.placementMode,
            createdAt: new Date().toISOString(),
            refined: result.refined ?? false,
            blueprint: result.blueprint,
            qualityReview: result.qualityReview,
          } satisfies Omit<GenerationMeta, 'parentArtboardId'>)
        : undefined
    const images = await Promise.all(
      artifacts.map((artifact) =>
        rasterizeArtifact(artifact, isAssetSet ? 'asset' : 'design', generationMeta),
      ),
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

async function readRuntimeStream(request: ChatEditRequest, callbacks: ChatEditCallbacks) {
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
  const removeCanvasTargetListener = runtime.onCanvasTargetRequest((data) => {
    if (data.streamId !== streamId) return
    void handleCanvasTargetRequest(runtime, data.request, callbacks)
  })
  const removeCanvasSnapshotListener = runtime.onCanvasSnapshotRequest((data) => {
    if (data.streamId !== streamId) return
    void handleCanvasSnapshotRequest(runtime, data.request, callbacks)
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
      stylePackId: request.stylePackId,
      question: request.prompt.trim(),
      history: request.history ?? [],
      componentReferences: request.componentReferences ?? [],
      uploads: buildAgentUploads(request),
      canvasTarget: request.canvasTarget,
      canvasContext: createCanvasContext(request),
      canvasSnapshot: createCanvasSnapshot(request),
      editScope: request.editScope,
      componentRegionAction: request.componentRegionAction,
      blueprintOverride: request.blueprintOverride,
      visualBrief: request.visualBrief,
      visualAssetPlan: request.visualAssetPlan,
      visualOptimizationContext: request.visualOptimizationContext,
      enableVisionReview: request.enableVisionReview ?? true,
    })
    if (result.error) throw new Error(result.error.message || 'Runtime 请求失败。')
    return {
      text: result.text || '',
      artifact: result.artifact,
      artifacts: result.artifacts,
      blueprint: result.blueprint,
      qualityReview: result.qualityReview,
      refined: result.refined,
      canvasDelivered: result.canvasDelivered,
      componentDesign: result.componentDesign,
      pageDesign: result.pageDesign,
      pageComponents: result.pageComponents,
      pageShellArtifact: result.pageShellArtifact,
      awaitingConfirmation: result.awaitingConfirmation,
      editScope: result.editScope,
      genericUiSchema: result.genericUiSchema,
      visualAssetReport: (
        result as typeof result & {
          visualAssetReport?: ChatEditResult['visualAssetReport']
        }
      ).visualAssetReport,
    }
  } finally {
    removeTokenListener()
    removeErrorListener()
    removeAgentEventListener()
    removeDeliverableListener()
    removeCanvasTargetListener()
    removeCanvasSnapshotListener()
  }
}

function createCanvasContext(request: ChatEditRequest): import('./types').CanvasContext {
  const selectedElementIds = (request.selectedElementIds ?? []).filter((id) =>
    request.document.elements.some((element) => element.id === id),
  )
  return {
    documentRevision: request.document.version,
    activeArtboardId: request.activeArtboardId,
    selectedArtboardId: request.selectedArtboardId,
    selectedElementIds,
    artboards: request.document.artboards.map((artboard) => ({
      id: artboard.id,
      name: artboard.name,
      width: artboard.width,
      height: artboard.height,
      empty: !request.document.elements.some((element) => element.artboardId === artboard.id),
      hasDesignSpec: Boolean(artboard.designSpec),
    })),
  }
}

async function handleCanvasSnapshotRequest(
  runtime: NonNullable<typeof window.aiCampaignRuntime>,
  request: import('./types').CanvasSnapshotRequest,
  callbacks: ChatEditCallbacks,
) {
  try {
    const resolution = callbacks.onCanvasSnapshotRequest
      ? await callbacks.onCanvasSnapshotRequest(request)
      : {
          status: 'failed' as const,
          reason: 'Renderer 没有注册画板快照处理器。',
          errorCode: 'CANVAS_SNAPSHOT_HANDLER_MISSING',
        }
    await runtime.ackCanvasSnapshot(request.id, resolution)
  } catch (error) {
    await runtime.ackCanvasSnapshot(request.id, {
      status: 'failed',
      reason: error instanceof Error ? error.message : '画板快照生成失败。',
      errorCode: 'CANVAS_SNAPSHOT_RENDERER_FAILED',
    })
  }
}

async function handleCanvasTargetRequest(
  runtime: NonNullable<typeof window.aiCampaignRuntime>,
  request: import('./types').CanvasTargetRequest,
  callbacks: ChatEditCallbacks,
) {
  try {
    const resolution = callbacks.onCanvasTargetRequest
      ? await callbacks.onCanvasTargetRequest(request)
      : {
          status: 'failed' as const,
          reason: 'Renderer 没有注册目标画板处理器。',
          errorCode: 'CANVAS_TARGET_HANDLER_MISSING',
        }
    await runtime.ackCanvasTarget(request.id, resolution)
  } catch (error) {
    await runtime.ackCanvasTarget(request.id, {
      status: 'failed',
      reason: error instanceof Error ? error.message : '目标画板解析失败。',
      errorCode: 'CANVAS_TARGET_RENDERER_FAILED',
    })
  }
}

function createCanvasSnapshot(request: ChatEditRequest) {
  const requestedTargetIds = [
    ...(request.selectedElementIds ?? []),
    ...(request.editScope?.targetElementIds ?? []),
    ...(request.editScope && 'elementId' in request.editScope && request.editScope.elementId
      ? [request.editScope.elementId]
      : []),
    ...(request.editScope?.type === 'multi-node' ? request.editScope.elementIds : []),
  ].filter((id, index, list) => typeof id === 'string' && id && list.indexOf(id) === index)
  const targetElement = request.document.elements.find((element) =>
    requestedTargetIds.includes(element.id),
  )
  // For edits, the frozen scope is authoritative. canvasTarget can be stale after
  // a new artboard is created or a previous run is resumed.
  const artboardId =
    request.editScope?.artboardId ||
    targetElement?.artboardId ||
    request.canvasTarget?.artboardId ||
    request.selectedArtboardId ||
    request.activeArtboardId
  const artboard = request.document.artboards.find((item) => item.id === artboardId)
  if (!artboard) return undefined
  const elements = request.document.elements.filter((element) => element.artboardId === artboard.id)
  const requiredElementIds = new Set([...requestedTargetIds])
  const snapshotElements = [
    ...elements.filter((element) => requiredElementIds.has(element.id)),
    ...elements.filter((element) => !requiredElementIds.has(element.id)).slice(0, 80),
  ].filter((element, index, list) => list.findIndex((item) => item.id === element.id) === index)
  const componentInstances = Object.values(request.document.componentInstances ?? {}).filter(
    (instance) => instance.artboardId === artboard.id,
  )
  return {
    artboardId: artboard.id,
    width: artboard.width,
    height: artboard.height,
    elementCount: elements.length,
    componentCount: componentInstances.length,
    hasPageShell: elements.some((element) => element.designRole === 'page-shell'),
    documentRevision: request.document.version,
    designSpec: artboard.designSpec,
    selectedElementIds: (request.selectedElementIds ?? []).filter((id) =>
      elements.some((element) => element.id === id),
    ),
    elements: snapshotElements.slice(0, 80 + requiredElementIds.size).map((element) => ({
      id: element.id,
      type: element.type,
      name: element.name,
      designRole: element.designRole,
      designBlockId: element.designBlockId,
      parentId: element.parentId,
      zIndex: element.zIndex,
      componentName: element.componentBinding?.componentName,
      instanceId: element.componentBinding?.instanceId,
      pageSectionId: element.componentBinding?.pageSectionId,
      renderMode: element.componentBinding?.renderMode,
      componentImageBinding: Boolean(element.componentBinding?.bindings.image),
      bounds: { x: element.x, y: element.y, width: element.width, height: element.height },
      properties: summarizePatchProperties(element),
    })),
    truncated: snapshotElements.length < elements.length,
  }
}

function summarizePatchProperties(element: import('../editor/types').DesignElement) {
  const common = {
    layoutSizing: element.layoutSizing,
    layoutConstraints: element.layoutConstraints,
    cornerRadii: element.cornerRadii,
    opacity: element.opacity,
  }
  if (element.type === 'text') return { ...common, content: element.content, style: element.style }
  if (element.type === 'button')
    return { ...common, content: element.content, style: element.style }
  if (element.type === 'shape')
    return {
      ...common,
      shape: element.shape,
      fill: element.fill,
      stroke: element.stroke,
      strokeWidth: element.strokeWidth,
      borderRadius: element.borderRadius,
    }
  if (element.type === 'image')
    return {
      ...common,
      objectFit: element.objectFit,
      objectPosition: element.objectPosition,
      borderRadius: element.borderRadius,
    }
  if (element.type === 'section')
    return { ...common, label: element.label, autoLayout: element.autoLayout }
  return common
}

async function handleIncrementalDeliverable(
  runtime: NonNullable<typeof window.aiCampaignRuntime>,
  deliverable: RawIncrementalDeliverable,
  callbacks: ChatEditCallbacks,
) {
  try {
    const converted = await convertRawDeliverable(deliverable)
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

async function convertRawDeliverable(
  deliverable: RawIncrementalDeliverable,
): Promise<import('./types').IncrementalCanvasDeliverable> {
  if (deliverable.kind === 'page-shell') {
    return {
      ...deliverable,
      pageShell: await rasterizeArtifact(deliverable.pageShellArtifact, 'asset'),
    }
  }
  if (deliverable.kind === 'page-component') {
    return {
      ...deliverable,
      component: {
        index: deliverable.component.index,
        pageSectionId: deliverable.component.pageSectionId,
        bounds: deliverable.component.bounds,
        componentDesign: deliverable.component.componentDesign,
        images: await Promise.all(
          (deliverable.component.artifacts ?? []).map((artifact) =>
            rasterizeArtifact(artifact, 'asset'),
          ),
        ),
      },
    }
  }
  if (deliverable.kind === 'image' || deliverable.kind === 'asset-set') {
    return {
      ...deliverable,
      images: await Promise.all(
        deliverable.artifacts.map((artifact) =>
          rasterizeArtifact(artifact, deliverable.kind === 'image' ? 'design' : 'asset'),
        ),
      ),
    }
  }
  if (deliverable.kind === 'component') {
    return {
      ...deliverable,
      images: await Promise.all(
        deliverable.artifacts.map((artifact) => rasterizeArtifact(artifact, 'asset')),
      ),
    }
  }
  if (deliverable.kind === 'component-slot' || deliverable.kind === 'page-shell-edit') {
    return {
      ...deliverable,
      image: await rasterizeArtifact(deliverable.artifact, 'asset'),
    }
  }
  if (deliverable.kind === 'component-slot-batch') {
    return {
      ...deliverable,
      items: await Promise.all(
        deliverable.items.map(async (item) => ({
          ...item,
          image: await rasterizeArtifact(item.artifact, 'asset'),
        })),
      ),
    }
  }
  if (deliverable.kind === 'design-patch') {
    return {
      ...deliverable,
      images: Object.fromEntries(
        await Promise.all(
          Object.entries(deliverable.imageArtifacts).map(async ([id, artifact]) => [
            id,
            await rasterizeArtifact(artifact, 'asset'),
          ]),
        ),
      ),
    }
  }
  return deliverable
}

type RawIncrementalDeliverable = {
  id: string
  sessionId: string
  runId: string
  stepId: string
  target?: ChatEditRequest['canvasTarget']
} & (
  | {
      kind: 'page-component'
      component: {
        index?: number
        pageSectionId?: string
        bounds?: { x: number; y: number; width: number; height: number }
        componentDesign: import('../editor/types').ComponentDesignMeta
        artifacts: RuntimeImageArtifact[]
      }
    }
  | {
      kind: 'generic-ui'
      uiSchema: import('../editor/types').GenericUiSchema
    }
  | {
      kind: 'generic-ui-section'
      uiSchema: import('../editor/types').GenericUiSchema
      section: { index: number; id: string; kind: string; label: string }
      deliveredBlockIds: string[]
    }
  | {
      kind: 'generic-ui-finalize'
      uiSchema: import('../editor/types').GenericUiSchema
      expectedBlockIds: string[]
      failedSectionIndexes: number[]
    }
  | {
      kind: 'generic-ui-runtime'
      sceneGraph: import('../editor/scene/scene-graph').SceneGraph
      runtimeDraft?: { version: 1; title: string; viewport: { width: number; height: number } }
      expectedNodeCount: number
      visualAssetReport?: {
        version: 1
        imagery: string
        plannedCount: number
        generatedCount: number
        boundCount: number
        targetViewport: { width: number; height: number }
        assets: Array<{ id: string; nodeId: string; targetSize: { width: number; height: number } }>
      }
    }
  | {
      kind: 'design-patch'
      patch: import('./types').DesignPatch
      imageArtifacts: Record<string, RuntimeImageArtifact>
    }
  | {
      kind: 'design-spec-patch'
      patch: import('./types').DesignSpecPatch
      baseDesignSpec: import('../editor/types').DesignSpec
      nextDesignSpec: import('../editor/types').DesignSpec
    }
  | {
      kind: 'page-shell'
      blueprint: import('../editor/types').PageCompositionBlueprint
      pageShellArtifact: RuntimeImageArtifact
    }
  | {
      kind: 'image'
      artifacts: RuntimeImageArtifact[]
    }
  | {
      kind: 'asset-set'
      artifacts: RuntimeImageArtifact[]
    }
  | {
      kind: 'component'
      componentDesign: import('../editor/types').ComponentDesignMeta
      artifacts: RuntimeImageArtifact[]
      editScope?: import('./types').SelectionScope
    }
  | {
      kind: 'component-slot'
      artifact: RuntimeImageArtifact
      editScope: import('./types').SelectionScope
    }
  | {
      kind: 'component-slot-batch'
      items: Array<{
        artifact: RuntimeImageArtifact
        editScope: import('./types').ComponentRegionEditScope
      }>
      editScope: import('./types').ComponentRegionBatchEditScope
    }
  | {
      kind: 'page-shell-edit'
      artifact: RuntimeImageArtifact
      editScope: import('./types').SelectionScope
    }
  | {
      kind: 'page-finalize'
      blueprint: import('../editor/types').PageCompositionBlueprint
      expectedComponentCount: number
      expectedPageSectionIds: string[]
    }
)

export function buildAgentUploads(request: ChatEditRequest) {
  const uploads = new Map<string, ReturnType<typeof createUpload>>()
  const roleResolutions = resolveReferenceImageRoles(
    (request.referenceImages ?? []).map((_, index) => ({
      name: request.referenceImageNames?.[index] || `参考图 ${index + 1}`,
      role: request.referenceImageRoles?.[index],
    })),
    {
      prompt: request.prompt,
      hasVisualBrief: Boolean(request.visualBrief),
      editScopeType: request.editScope?.type,
    },
  )
  // 历史消息中的图片只用于聊天记录展示。本轮 Agent 只能收到用户当前明确激活的附件。
  for (let index = 0; index < (request.referenceImages?.length ?? 0); index += 1) {
    const src = request.referenceImages?.[index]
    if (!src) continue
    const name = request.referenceImageNames?.[index] || `参考图 ${index + 1}`
    uploads.set(src, createUpload(src, name, request.prompt, roleResolutions[index]))
  }
  return Array.from(uploads.values())
}

function createUpload(
  data: string,
  name: string,
  context = '',
  resolution?: import('./reference-image-role').ReferenceImageRoleResolution,
) {
  return {
    data,
    type: 'file',
    name: normalizeFileName(name, getImageExtension(data)),
    mime: getImageMime(data),
    context,
    ...(resolution
      ? {
          role: resolution.resolvedRole,
          requestedRole: resolution.requestedRole,
          roleConfidence: resolution.confidence,
          roleReason: resolution.reason,
        }
      : {}),
  }
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

  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const extracted = lines
    .map((line) => {
      const payload = line.startsWith('data:') ? line.slice(5).trim() : line
      if (payload === '[DONE]') return ''
      try {
        return findText(JSON.parse(payload))
      } catch {
        return payload
      }
    })
    .filter(Boolean)

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
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${suffix}`
}
