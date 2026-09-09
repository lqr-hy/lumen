import {
  createImagesModels,
  createImagesProvider,
  createModels,
  createProvider,
  envApiKeyAuth,
} from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'

/** 根据项目 Provider 配置创建 Pi 文本模型注册表和当前模型定义。 */
export function createStudioPiModels({ provider, runtime, model }) {
  const models = createModels()
  const modelDefinition = createReasoningModel(provider, runtime, model)
  const api = resolveReasoningApi(provider, runtime)
  models.setProvider(
    createProvider({
      id: provider.id,
      name: provider.label,
      baseUrl: runtime.baseUrl,
      auth: { apiKey: envApiKeyAuth(provider.id, [runtime.apiKeyEnv || provider.apiKeyEnv]) },
      models: [modelDefinition],
      api,
    }),
  )
  return { models, model: modelDefinition }
}

/**
 * 通过 Pi ImagesModels 执行图片任务；具体 HTTP 传输仍由项目 Provider 适配层控制。
 */
export async function requestPiImages({ provider, runtime, model, payload, transport }) {
  const imageModels = createImagesModels()
  const modelDefinition = createImageModel(provider, model, runtime)
  let transportResult
  let transportError
  imageModels.setProvider(
    createImagesProvider({
      id: provider.id,
      name: provider.label,
      auth: { apiKey: envApiKeyAuth(provider.id, [runtime.apiKeyEnv || provider.apiKeyEnv]) },
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
            api: 'studio-openai-images',
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

/** 将项目 Provider 能力转换为 Pi 可识别的推理模型定义。 */
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

function createImageModel(provider, model, runtime) {
  return {
    id: model,
    name: model,
    api: 'studio-openai-images',
    provider: provider.id,
    baseUrl: runtime.baseUrl,
    input: ['text', 'image'],
    output: ['image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
}

/** 选择标准 Responses 或 Anthropic Messages 协议适配器。 */
function resolveReasoningApi(provider, runtime) {
  if (provider.wireApi === 'openai-responses') {
    const api = openAIResponsesApi()
    return runtime.codexCompatibility ? withBiliCodexProtocol(api) : api
  }
  if (provider.wireApi === 'anthropic-messages') return anthropicMessagesApi()
  throw new Error(`Pi 不支持推理协议：${provider.wireApi}`)
}

/**
 * 为内部 Codex 网关补齐请求头和 Payload 契约，同时保留 Pi 的事件流解析能力。
 */
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

/**
 * 包装 fetch，在 HTTP 200 但响应体为空时使用新的请求 ID 有限重试，
 * 最终仍为空则返回明确的上游协议错误。
 */
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
