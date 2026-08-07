export async function reviewPageVision({ invokeProvider, payload, blueprint, shellArtifact, components, callbacks }) {
  if (!payload.enableVisionReview) {
    return { status: 'unsupported', provider: payload.provider, issues: [], message: '本次未启用 Vision Review。' }
  }
  const snapshot = composePageReviewSnapshot(blueprint, shellArtifact, components)
  try {
    const result = await invokeProvider({
      ...payload,
      type: 'vision_review',
      question: [
        '评审附带的完整活动页面设计快照。',
        '重点比较 KV 视觉语言、组件层级、文字可读性、模块间节奏和页面完整度。',
        '每个问题必须定位到 page-shell 或具体 pageSectionId，禁止只给泛泛建议。',
      ].join('\n'),
      uploads: [{
        type: 'file',
        name: 'page-review.svg',
        mime: 'image/svg+xml',
        role: 'visual',
        data: `data:image/svg+xml;base64,${Buffer.from(snapshot.content).toString('base64')}`,
      }],
    }, callbacks)
    const review = normalizeVisionReview(result.visionReview ?? parseJsonText(result.text))
    return review ?? {
      status: 'failed',
      provider: payload.provider,
      issues: [],
      message: 'Vision Provider 没有返回有效的结构化评审。',
    }
  } catch (error) {
    // Vision Review 是质量增强步骤，快照转码或 Provider 暂时不可用时不能阻断页面交付。
    return {
      status: 'degraded',
      provider: payload.provider,
      issues: [],
      message: error instanceof Error ? `Vision Review 已跳过：${error.message}` : 'Vision Review 已跳过。',
    }
  }
}

export function composePageReviewSnapshot(blueprint, shellArtifact, components) {
  const width = blueprint.width
  const height = blueprint.estimatedHeight
  const layers = [svgImage(shellArtifact, 0, 0, width, height)]
  for (const component of components) {
    const section = blueprint.sections[Number(component.index) || 0]
    if (!section || !component.previewArtifact) continue
    layers.push(svgImage(
      component.previewArtifact,
      section.bounds.x,
      section.bounds.y,
      section.bounds.width,
      section.bounds.height,
    ))
  }
  return {
    kind: 'svg',
    name: 'page-review.svg',
    content: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${layers.join('')}</svg>`,
  }
}

function svgImage(artifact, x, y, width, height) {
  if (!artifact?.content) return ''
  const data = Buffer.from(artifact.content).toString('base64')
  return `<image x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="none" href="data:image/svg+xml;base64,${data}"/>`
}

function normalizeVisionReview(value) {
  if (!value || typeof value !== 'object') return undefined
  const scores = value.scores
  if (!scores || !['theme', 'readability', 'hierarchy', 'referenceSimilarity'].every((key) => (
    Number.isFinite(scores[key]) && scores[key] >= 0 && scores[key] <= 1
  ))) return undefined
  const issues = Array.isArray(value.issues) ? value.issues.filter((issue) => (
    issue && typeof issue.targetId === 'string' && typeof issue.message === 'string'
  )).map((issue) => ({
    scope: issue.scope === 'component' ? 'component' : 'page',
    targetId: issue.targetId,
    severity: issue.severity === 'warning' ? 'warning' : 'error',
    message: issue.message,
    repairPrompt: String(issue.repairPrompt || issue.message),
  })) : []
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
