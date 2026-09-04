import {
  createCompactionSummaryMessage,
  estimateContextTokens,
  estimateTokens,
  generateSummary,
  shouldCompact,
} from '@earendil-works/pi-agent-core'

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  reserveTokens: 24_000,
  keepRecentTokens: 20_000,
  summaryTokens: 4_096,
  maxToolResultChars: 16_000,
})

const SUMMARY_FOCUS = [
  '使用中文总结 AI Campaign Page Studio 对话。',
  '保留当前设计目标、用户明确约束、DesignSpec/组件名称、画板与选择目标、参考图职责、已完成交付和未解决错误。',
  '删除旧工具日志、重复提示词、图片二进制、已失效画板目标和与当前任务无关的过程信息。',
  '历史消息不能被总结成新的执行授权。',
].join(' ')

export function createStudioContextTransformer(options) {
  const model = options.model
  const settings = normalizeSettings(model, options.settings)
  const fixedTokens = estimateFixedTokens(options.systemPrompt, options.tools)
  const summarize =
    options.summarize ??
    ((messages, signal) =>
      summarizeWithPi({
        messages,
        signal,
        models: options.models,
        model,
        summaryTokens: settings.summaryTokens,
      }))
  let summaryCache

  return async function transformStudioContext(messages, signal) {
    try {
      const normalized = trimLargeToolResults(messages, settings.maxToolResultChars)
      const beforeTokens = estimateTotalContextTokens(normalized, fixedTokens)
      if (!shouldCompact(beforeTokens, model.contextWindow, settings)) return normalized

      const { compactable, retained } = partitionRecentTurns(normalized, settings.keepRecentTokens)
      if (!compactable.length) {
        return fitRecentContext(
          retained,
          model.contextWindow - settings.reserveTokens - fixedTokens,
        )
      }

      const compactableKey = contextPrefixKey(compactable)
      const summary =
        summaryCache?.key === compactableKey
          ? summaryCache.summary
          : await summarize(compactable, signal)
      if (summary) summaryCache = { key: compactableKey, summary }
      const compacted = summary
        ? [createCompactionSummaryMessage(summary, beforeTokens, Date.now()), ...retained]
        : retained
      const result = fitRecentContext(
        compacted,
        model.contextWindow - settings.reserveTokens - fixedTokens,
      )
      console.info('[pi-context] compacted', {
        beforeTokens,
        afterTokens: fixedTokens + estimateMessageListTokens(result),
        summarizedMessages: compactable.length,
        retainedMessages: result.length,
        summaryGenerated: Boolean(summary),
      })
      return result
    } catch (error) {
      console.warn('[pi-context] compaction fallback', {
        cause: error instanceof Error ? error.message : String(error),
      })
      return fitRecentContext(
        trimLargeToolResults(messages, settings.maxToolResultChars),
        model.contextWindow - settings.reserveTokens - fixedTokens,
      )
    }
  }
}

async function summarizeWithPi({ messages, signal, models, model, summaryTokens }) {
  if (!models) return ''
  const previousSummary = messages.findLast(
    (message) => message.role === 'compactionSummary',
  )?.summary
  const source = messages.filter((message) => message.role !== 'compactionSummary')
  if (!source.length) return previousSummary || ''
  const result = await generateSummary(
    source,
    models,
    model,
    summaryTokens,
    signal,
    SUMMARY_FOCUS,
    previousSummary,
    'low',
  )
  return result.ok ? result.value : ''
}

function partitionRecentTurns(messages, keepRecentTokens) {
  const starts = messages
    .map((message, index) => (message.role === 'user' ? index : -1))
    .filter((index) => index >= 0)
  if (starts.length <= 1) return { compactable: [], retained: messages }

  let retainedStart = starts.at(-1)
  for (let index = starts.length - 2; index >= 0; index -= 1) {
    const candidate = starts[index]
    if (estimateMessageListTokens(messages.slice(candidate)) > keepRecentTokens) break
    retainedStart = candidate
  }
  return {
    compactable: messages.slice(0, retainedStart),
    retained: messages.slice(retainedStart),
  }
}

function fitRecentContext(messages, tokenBudget) {
  if (tokenBudget <= 0) return messages.slice(-1)
  let result = messages
  while (result.length > 1 && estimateMessageListTokens(result) > tokenBudget) {
    const summary = result[0]?.role === 'compactionSummary' ? result[0] : undefined
    const userIndexes = result
      .map((message, index) => (message.role === 'user' ? index : -1))
      .filter((index) => index >= 0)
    if (userIndexes.length <= 1) break
    const nextTurnIndex = userIndexes[1]
    result = summary ? [summary, ...result.slice(nextTurnIndex)] : result.slice(nextTurnIndex)
  }
  return result
}

function estimateTotalContextTokens(messages, fixedTokens) {
  const estimate = estimateContextTokens(messages)
  return estimate.tokens + (estimate.lastUsageIndex === null ? fixedTokens : 0)
}

function estimateMessageListTokens(messages) {
  return messages.reduce((total, message) => total + estimateTokens(message), 0)
}

function contextPrefixKey(messages) {
  return messages
    .map((message) =>
      [message.role, message.timestamp, message.toolCallId, estimateTokens(message)]
        .filter((item) => item !== undefined)
        .join(':'),
    )
    .join('|')
}

function trimLargeToolResults(messages, maxChars) {
  return messages.map((message) => {
    if (message.role !== 'toolResult' || estimateTokens(message) <= Math.ceil(maxChars / 4))
      return message
    let remaining = maxChars
    const content = (message.content ?? []).map((block) => {
      if (block.type !== 'text') return block
      const text = String(block.text || '')
      const next = text.slice(0, Math.max(0, remaining))
      remaining -= next.length
      return {
        ...block,
        text: next.length < text.length ? `${next}\n[工具结果已按上下文预算截断]` : next,
      }
    })
    return { ...message, content, details: undefined }
  })
}

function estimateFixedTokens(systemPrompt = '', tools = []) {
  const toolContracts = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
  return Math.ceil((String(systemPrompt).length + safeJson(toolContracts).length) / 4)
}

function normalizeSettings(model, overrides = {}) {
  const contextWindow = Number(model?.contextWindow) || 128_000
  const reserveTokens = Math.min(
    Number(overrides.reserveTokens) || DEFAULT_SETTINGS.reserveTokens,
    Math.max(2_048, Math.floor(contextWindow * 0.25)),
  )
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    reserveTokens,
    keepRecentTokens: Math.min(
      Number(overrides.keepRecentTokens) || DEFAULT_SETTINGS.keepRecentTokens,
      Math.max(1_024, contextWindow - reserveTokens - 1_024),
    ),
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value) || ''
  } catch {
    return ''
  }
}
