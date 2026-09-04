export async function reviewPageVision({
  invokeProvider,
  payload,
  references = [],
  visualDirection,
  callbacks,
}) {
  if (!payload.enableVisionReview) {
    return {
      status: 'unsupported',
      provider: payload.provider,
      issues: [],
      message: '本次未启用 Vision Review。',
    }
  }
  if (
    typeof callbacks?.onCanvasSnapshotRequest !== 'function' ||
    !payload.canvasTarget?.artboardId
  ) {
    return {
      status: 'degraded',
      provider: payload.provider,
      issues: [],
      message: 'Vision Review 已跳过：Renderer 画板快照能力不可用。',
    }
  }
  try {
    const resolution = await callbacks.onCanvasSnapshotRequest({
      id: `snapshot-${payload.sessionId || 'session'}-${Date.now()}`,
      sessionId: payload.sessionId || 'runtime-session',
      runId: payload.streamId || payload.sessionId || 'runtime-run',
      artboardId: payload.canvasTarget.artboardId,
      purpose: 'vision-review',
      scale: 1,
    })
    const snapshot = resolution?.status === 'ready' ? resolution.snapshot : undefined
    if (!isPngSnapshot(snapshot)) {
      return {
        status: 'degraded',
        provider: payload.provider,
        issues: [],
        message: `Vision Review 已跳过：${resolution?.reason || 'Renderer 没有返回有效 PNG 快照。'}`,
      }
    }
    const result = await invokeProvider(
      {
        ...payload,
        type: 'vision_review',
        question: [
          '评审附带的完整活动页面设计快照。',
          '重点比较 KV 视觉语言、组件层级、文字可读性、模块间节奏和页面完整度。',
          visualDirection ? `页面视觉方向契约：${JSON.stringify(visualDirection)}` : '',
          '检查页面外壳与组件 Surface 是否重复使用同一主放射、主图形或全幅纹理；出现重复时必须定位对应 pageSectionId。',
          '检查页面主视觉是否只有一个焦点。若整页高度持续使用相同高密度纹理、重复放射中心或等权高饱和装饰，必须判定为 error 并定位 page-shell。',
          '检查每个组件是否有独立 Tonal Surface 与页面底图分层。若高密度页面纹理明显透过组件内容区、组件内容直接压在页面主视觉上，必须判定为 error 并定位对应 pageSectionId。',
          '每个问题必须定位到 page-shell 或具体 pageSectionId，禁止只给泛泛建议。',
        ]
          .filter(Boolean)
          .join('\n'),
        uploads: [
          ...references
            .filter((reference) => ['kv', 'visual', 'prototype'].includes(reference.role))
            .slice(0, 3)
            .map((reference) => ({
              type: 'file',
              name: reference.name,
              mime: reference.mime,
              role: reference.role,
              data: reference.data,
            })),
          {
            type: 'file',
            name: 'page-review.png',
            mime: 'image/png',
            role: 'visual',
            data: snapshot.data,
          },
        ],
      },
      callbacks,
    )
    const review = normalizeVisionReview(result.visionReview ?? parseJsonText(result.text))
    return (
      review ?? {
        status: 'failed',
        provider: payload.provider,
        issues: [],
        message: 'Vision Provider 没有返回有效的结构化评审。',
      }
    )
  } catch (error) {
    // Vision Review 是质量增强步骤，快照转码或 Provider 暂时不可用时不能阻断页面交付。
    return {
      status: 'degraded',
      provider: payload.provider,
      issues: [],
      message:
        error instanceof Error
          ? `Vision Review 已跳过：${error.message}`
          : 'Vision Review 已跳过。',
    }
  }
}

function isPngSnapshot(snapshot) {
  return Boolean(
    snapshot &&
    snapshot.mime === 'image/png' &&
    typeof snapshot.data === 'string' &&
    snapshot.data.startsWith('data:image/png;base64,') &&
    Number.isFinite(snapshot.width) &&
    snapshot.width > 0 &&
    Number.isFinite(snapshot.height) &&
    snapshot.height > 0,
  )
}

function normalizeVisionReview(value) {
  if (!value || typeof value !== 'object') return undefined
  const scores = value.scores
  if (
    !scores ||
    !['theme', 'readability', 'hierarchy', 'referenceSimilarity'].every(
      (key) => Number.isFinite(scores[key]) && scores[key] >= 0 && scores[key] <= 1,
    )
  )
    return undefined
  const issues = Array.isArray(value.issues)
    ? value.issues
        .filter(
          (issue) =>
            issue && typeof issue.targetId === 'string' && typeof issue.message === 'string',
        )
        .map((issue) => ({
          scope: issue.scope === 'component' ? 'component' : 'page',
          targetId: issue.targetId,
          severity: issue.severity === 'warning' ? 'warning' : 'error',
          message: issue.message,
          repairPrompt: String(issue.repairPrompt || issue.message),
        }))
    : []
  return {
    status: 'completed',
    provider: value.provider,
    scores,
    issues,
    message: String(value.message || 'Vision Review 完成。'),
  }
}

function parseJsonText(text) {
  if (typeof text !== 'string') return undefined
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return undefined
  try {
    return JSON.parse(match[0])
  } catch {
    return undefined
  }
}
