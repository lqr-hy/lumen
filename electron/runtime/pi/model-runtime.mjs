import {
  createAssistantMessageEventStream,
  createImagesModels,
  createImagesProvider,
  createModels,
  createProvider,
  envApiKeyAuth,
} from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'

const EMPTY_USAGE = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
})

export function createStudioPiModels({ provider, runtime, model }) {
  const models = createModels()
  const modelDefinition = createReasoningModel(provider, runtime, model)
  const api = resolveReasoningApi(provider, runtime)
  models.setProvider(
    createProvider({
      id: provider.id,
      name: provider.label,
      baseUrl: runtime.baseUrl,
      auth: { apiKey: envApiKeyAuth(provider.id, [provider.apiKeyEnv]) },
      models: [modelDefinition],
      api,
    }),
  )
  return { models, model: modelDefinition }
}

export async function requestPiImages({ provider, runtime, model, payload, transport }) {
  const imageModels = createImagesModels()
  const modelDefinition = createImageModel(provider, model)
  let transportResult
  let transportError
  imageModels.setProvider(
    createImagesProvider({
      id: provider.id,
      name: provider.label,
      auth: { apiKey: envApiKeyAuth(provider.id, [provider.apiKeyEnv]) },
      models: [modelDefinition],
      api: {
        async generateImages(_selectedModel, context, options) {
          try {
            transportResult = await transport({
              provider,
              runtime,
              model,
              payload,
              context,
              options,
            })
          } catch (error) {
            transportError = error
            throw error
          }
          const artifacts =
            transportResult.artifacts ??
            (transportResult.artifact ? [transportResult.artifact] : [])
          return {
            api: 'bili-openai-images',
            provider: provider.id,
            model,
            output: artifacts.map((artifact) => ({
              type: 'image',
              data: artifact.content,
              mimeType: artifact.mime || 'image/png',
            })),
            stopReason: 'stop',
            timestamp: Date.now(),
          }
        },
      },
    }),
  )
  const selectedModel = imageModels.getModel(provider.id, model)
  if (!selectedModel) throw new Error(`Pi ImagesModels 未注册模型：${model}`)
  const result = await imageModels.generateImages(
    selectedModel,
    {
      input: [
        { type: 'text', text: payload.question },
        ...(payload.uploads ?? [])
          .filter(
            (upload) => typeof upload?.data === 'string' && upload.data.startsWith('data:image/'),
          )
          .map((upload) => ({
            type: 'image',
            data: upload.data.slice(upload.data.indexOf(',') + 1),
            mimeType: upload.mime || upload.data.match(/^data:([^;]+);/)?.[1] || 'image/png',
          })),
      ],
    },
    {
      apiKey: runtime.apiKey,
      signal: payload.signal,
      metadata: { taskType: payload.type, taskCount: payload.imageTasks?.length ?? 1 },
    },
  )
  if (result.stopReason === 'error' || !transportResult) {
    if (transportError) throw transportError
    throw new Error(result.errorMessage || 'Pi ImagesModels 生图请求失败。')
  }
  return transportResult
}

function createReasoningModel(provider, runtime, model) {
  return {
    id: model,
    name: model,
    api: provider.wireApi,
    provider: provider.id,
    baseUrl: runtime.baseUrl,
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 32768,
    ...(provider.id === 'codex'
      ? {
          compat: {
            sessionAffinityFormat: 'none',
            supportsDeveloperRole: true,
            supportsStrictMode: false,
          },
        }
      : {}),
  }
}

function createImageModel(provider, model) {
  return {
    id: model,
    name: model,
    api: 'bili-openai-images',
    provider: provider.id,
    baseUrl: provider.defaultBaseUrl,
    input: ['text', 'image'],
    output: ['image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
}

function resolveReasoningApi(provider, runtime) {
  if (provider.wireApi === 'openai-responses') {
    const api = openAIResponsesApi()
    return provider.id === 'codex' ? withBiliCodexProtocol(api) : api
  }
  if (provider.wireApi === 'anthropic-messages') return anthropicMessagesApi()
  if (provider.wireApi === 'copilot-prediction') return createCopilotPredictionApi(runtime)
  throw new Error(`Pi 不支持推理协议：${provider.wireApi}`)
}

function withBiliCodexProtocol(api) {
  const normalizeOptions = (options = {}) => {
    const sessionId = options.sessionId
    const previousPayload = options.onPayload
    return {
      ...options,
      fetch: createNonEmptyResponseFetch(options.fetch),
      headers: {
        ...options.headers,
        'OpenAI-Beta': 'responses=experimental',
        originator: 'pi',
        'User-Agent': createPiUserAgent(),
        ...(sessionId
          ? {
              'session-id': sessionId,
              'x-client-request-id': sessionId,
            }
          : {}),
      },
      onPayload: async (payload, model) => {
        const transformed = (await previousPayload?.(payload, model)) ?? payload
        return toBiliCodexPayload(transformed)
      },
    }
  }
  return {
    stream: (model, context, options) => api.stream(model, context, normalizeOptions(options)),
    streamSimple: (model, context, options) =>
      api.streamSimple(model, context, normalizeOptions(options)),
  }
}

function toBiliCodexPayload(payload) {
  const input = Array.isArray(payload?.input) ? payload.input : []
  const instructions = input
    .filter((item) => item?.role === 'system' || item?.role === 'developer')
    .map((item) =>
      typeof item.content === 'string'
        ? item.content
        : (item.content ?? [])
            .map((part) => part?.text)
            .filter(Boolean)
            .join('\n'),
    )
    .filter(Boolean)
    .join('\n\n')
  const {
    max_output_tokens: _maxOutputTokens,
    prompt_cache_options: _promptCacheOptions,
    prompt_cache_retention: _promptCacheRetention,
    ...supported
  } = payload
  return {
    ...supported,
    store: false,
    stream: true,
    instructions: instructions || payload.instructions || 'You are a helpful assistant.',
    input: input.filter((item) => item?.role !== 'system' && item?.role !== 'developer'),
    text: { verbosity: 'low', ...(payload.text ?? {}) },
    include: [...new Set([...(payload.include ?? []), 'reasoning.encrypted_content'])],
    tool_choice: payload.tool_choice ?? 'auto',
    parallel_tool_calls: true,
  }
}

function createNonEmptyResponseFetch(customFetch) {
  const request = customFetch ?? globalThis.fetch.bind(globalThis)
  return async (...args) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request(...withRetryRequestId(args, attempt))
      if (!response.ok || !response.body) return response
      const reader = response.body.getReader()
      let first = await reader.read()
      while (!first.done && first.value?.byteLength === 0) first = await reader.read()
      if (!first.done) return rebuildResponse(response, reader, first.value)

      if (attempt < 2) {
        console.warn('[pi-runtime] gateway empty response, retrying', {
          attempt: attempt + 1,
          maxAttempts: 3,
          status: response.status,
        })
        await waitForRetry(300 * 2 ** attempt + Math.floor(Math.random() * 180), args[1]?.signal)
        continue
      }
      return new Response(
        JSON.stringify({
          error: {
            type: 'gateway_empty_response',
            message: '推理网关没有返回有效内容，已自动重试 2 次。',
            retryable: true,
          },
        }),
        {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            'x-studio-error-code': 'gateway-empty-response',
          },
        },
      )
    }
    throw new Error('推理网关重试状态异常。')
  }
}

function withRetryRequestId(args, attempt) {
  if (attempt === 0) return args
  const [input, init = {}] = args
  const headers = new Headers(init.headers)
  const base = headers.get('x-client-request-id') || headers.get('session-id') || 'studio'
  headers.set('x-client-request-id', `${base}-${Date.now()}-${attempt}`)
  return [input, { ...init, headers }]
}

function rebuildResponse(response, reader, firstValue) {
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(firstValue)
      const pump = () =>
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              controller.close()
              return
            }
            controller.enqueue(value)
            return pump()
          })
          .catch((error) => controller.error(error))
      return pump()
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function waitForRetry(delay, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error('请求已取消。'))
      return
    }
    const timer = setTimeout(resolve, delay)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason || new Error('请求已取消。'))
      },
      { once: true },
    )
  })
}

function createPiUserAgent() {
  if (typeof process === 'undefined') return 'pi (browser)'
  return `pi (${process.platform}; ${process.arch})`
}

function createCopilotPredictionApi(runtime) {
  const stream = (model, context, options) =>
    createDirectTextStream(
      model,
      async () => {
        const response = await fetch(runtime.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream, application/json, text/plain',
            ...(runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {}),
          },
          body: JSON.stringify({
            question: flattenContext(context),
            stream: false,
            streaming: false,
          }),
          signal: options?.signal,
        })
        if (!response.ok) throw new Error(`Copilot 请求失败：${response.status}`)
        return extractDirectText(await response.text())
      },
      options?.signal,
    )
  return { stream, streamSimple: stream }
}

function createDirectTextStream(model, produce, signal) {
  const stream = createAssistantMessageEventStream()
  queueMicrotask(async () => {
    const base = createAssistantMessage(model)
    try {
      if (signal?.aborted) throw signal.reason || new Error('请求已取消。')
      stream.push({ type: 'start', partial: base })
      const text = String((await produce()) || '')
      const partial = { ...base, content: [{ type: 'text', text }], stopReason: 'stop' }
      stream.push({ type: 'text_start', contentIndex: 0, partial: base })
      if (text) stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial })
      stream.push({ type: 'text_end', contentIndex: 0, content: text, partial })
      stream.push({ type: 'done', reason: 'stop', message: partial })
      stream.end(partial)
    } catch (error) {
      const failed = {
        ...base,
        stopReason: signal?.aborted ? 'aborted' : 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      }
      stream.push({ type: 'error', reason: failed.stopReason, error: failed })
      stream.end(failed)
    }
  })
  return stream
}

function flattenContext(context) {
  return [
    context.systemPrompt,
    ...(context.messages ?? []).map((message) => {
      if (typeof message.content === 'string') return message.content
      return (message.content ?? [])
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n')
    }),
  ]
    .filter(Boolean)
    .join('\n\n')
}

function extractDirectText(source) {
  try {
    const value = JSON.parse(source)
    return value.text || value.answer || value.output_text || value.result || source
  } catch {
    return source
      .split(/\r?\n/)
      .map((line) => line.replace(/^data:\s*/, ''))
      .filter(Boolean)
      .join('')
  }
}

function createAssistantMessage(model) {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: 'pending',
    timestamp: Date.now(),
  }
}
