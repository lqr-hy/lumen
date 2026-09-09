export const DEFAULT_PROVIDER_ID = 'codex'

export const PROVIDERS = {
  openai: {
    id: 'openai',
    label: 'OpenAI Compatible',
    wireApi: 'openai-responses',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlEnv: 'OPENAI_BASE_URL',
    baseUrlEnvs: ['OPENAI_BASE_URL'],
    apiKeyEnv: 'OPENAI_API_KEY',
    apiKeyEnvs: ['OPENAI_API_KEY'],
    modelEnvs: ['OPENAI_MODEL'],
    models: ['gpt-5.5'],
    capabilities: { chat: true, vision: true, structuredOutput: true, rasterImage: false },
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    wireApi: 'openai-responses',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlEnv: 'AICODING_BASE_URL',
    baseUrlEnvs: ['AICODING_BASE_URL', 'OPENAI_BASE_URL'],
    apiKeyEnv: 'AICODING_API_KEY',
    apiKeyEnvs: ['AICODING_API_KEY', 'OPENAI_API_KEY'],
    modelEnvs: ['AICODING_MODEL', 'OPENAI_MODEL'],
    models: ['gpt-5.6-sol', 'gpt-5.6-terra'],
    capabilities: { chat: true, vision: true, structuredOutput: true, rasterImage: false },
  },
  claudeCode: {
    id: 'claudeCode',
    label: 'Claude Code',
    wireApi: 'anthropic-messages',
    defaultBaseUrl: 'https://api.anthropic.com',
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
    apiKeyEnv: 'ANTHROPIC_AUTH_TOKEN',
    apiKeyEnvs: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'],
    modelEnvs: ['ANTHROPIC_MODEL'],
    models: ['claude-opus-4-8'],
    capabilities: { chat: true, vision: true, structuredOutput: true, rasterImage: false },
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Compatible',
    wireApi: 'anthropic-messages',
    defaultBaseUrl: 'https://api.anthropic.com',
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
    baseUrlEnvs: ['ANTHROPIC_BASE_URL'],
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    apiKeyEnvs: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
    modelEnvs: ['ANTHROPIC_MODEL'],
    models: ['claude-opus-4-8'],
    capabilities: { chat: true, vision: true, structuredOutput: true, rasterImage: false },
  },
  image: {
    id: 'image',
    label: 'Image',
    wireApi: 'openai_images',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlEnv: 'IMAGE_BASE_URL',
    baseUrlEnvs: ['IMAGE_BASE_URL', 'OPENAI_BASE_URL'],
    apiKeyEnv: 'IMAGE_API_KEY',
    apiKeyEnvs: ['IMAGE_API_KEY', 'OPENAI_API_KEY'],
    modelEnvs: ['IMAGE_MODEL'],
    models: ['gpt-image-2', 'nano-banana-pro'],
    capabilities: {
      chat: false,
      vision: false,
      structuredOutput: false,
      rasterImage: true,
      transparentGenerationParameter: true,
      transparentEditParameter: false,
    },
  },
}

export function resolveProvider(providerId = DEFAULT_PROVIDER_ID) {
  const provider = PROVIDERS[providerId]
  if (!provider) {
    throw createRuntimeError(
      'UNSUPPORTED_PROVIDER',
      `当前模型供应商未被应用支持：${providerId}。`,
      { provider: providerId },
    )
  }
  return provider
}

export function resolveModel(provider, model, runtime) {
  const models = runtime?.models?.length ? runtime.models : provider.models
  const selectedModel = model || runtime?.defaultModel || models[0]
  if (!models.includes(selectedModel)) {
    throw createRuntimeError(
      'UNSUPPORTED_MODEL',
      `当前模型不属于 ${provider.label} 可选列表：${selectedModel}。`,
      { provider: provider.id, model: selectedModel },
    )
  }
  return selectedModel
}

export function createRuntimeError(code, message, details = {}) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}
