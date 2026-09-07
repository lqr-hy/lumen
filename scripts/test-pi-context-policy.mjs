import assert from 'node:assert/strict'
import { estimateContextTokens } from '@earendil-works/pi-agent-core'
import { createStudioContextTransformer } from '../electron/runtime/pi/context-policy.mjs'
import { assembleRuntimeContext } from '../electron/runtime/pi/context-runtime.mjs'

const model = { contextWindow: 1_200, maxTokens: 512 }
const messages = Array.from({ length: 8 }, (_, index) => [
  {
    role: 'user',
    content: `第 ${index + 1} 轮设计要求：${'要求'.repeat(140)}`,
    timestamp: index * 2,
  },
  {
    role: 'assistant',
    content: [{ type: 'text', text: `第 ${index + 1} 轮结果：${'结果'.repeat(140)}` }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'stop',
    timestamp: index * 2 + 1,
  },
]).flat()

let summarized = 0
let summaryCalls = 0
const transform = createStudioContextTransformer({
  model,
  systemPrompt: 'Studio 固定系统提示',
  tools: [],
  settings: { reserveTokens: 300, keepRecentTokens: 300 },
  summarize: async (source) => {
    summaryCalls += 1
    summarized = source.length
    return '旧对话摘要：保留设计目标与已完成结果。'
  },
})
const transformed = await transform(messages)
assert(summarized > 0)
assert.equal(transformed[0].role, 'compactionSummary')
assert.equal(transformed.at(-1).content[0].text, messages.at(-1).content[0].text)
assert(estimateContextTokens(transformed).tokens < estimateContextTokens(messages).tokens)
await transform(messages)
assert.equal(summaryCalls, 1)

const short = messages.slice(-2)
const untouched = await transform(short)
assert.equal(untouched.length, short.length)
assert.equal(untouched.at(-1).content[0].text, short.at(-1).content[0].text)

const fallbackTransform = createStudioContextTransformer({
  model,
  systemPrompt: 'Studio 固定系统提示',
  tools: [],
  settings: { reserveTokens: 300, keepRecentTokens: 300 },
  summarize: async () => {
    throw new Error('摘要模型暂时不可用')
  },
})
const fallback = await fallbackTransform(messages)
assert(fallback.length > 0)
assert.equal(fallback.at(-1).content[0].text, messages.at(-1).content[0].text)

const runtimeContext = assembleRuntimeContext(
  {
    sessionId: 'context-session',
    projectId: 'context-project',
    question: '使用之前上传的图片',
    uploads: [],
  },
  {
    status: 'completed',
    references: [
      {
        name: 'hero.png',
        role: 'kv',
        mime: 'image/png',
        assetRef: 'sha256:test',
      },
    ],
  },
)
assert.deepEqual(runtimeContext.references, [
  {
    name: 'hero.png',
    role: 'kv',
    requestedRole: 'kv',
    roleConfidence: undefined,
    roleReason: '',
    mime: 'image/png',
    source: 'session',
  },
])

console.log(
  JSON.stringify(
    {
      piTokenEstimator: true,
      piCompactionThreshold: true,
      studioRecentTurnRetention: true,
      repeatedPrefixSummaryCache: true,
      studioSummaryFallback: true,
      persistedReferenceContext: true,
    },
    null,
    2,
  ),
)
