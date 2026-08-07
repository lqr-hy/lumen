export const DEFAULT_PROVIDER_ID = 'codex'

export const PROVIDERS = {
  codex: {
    id: 'codex',
    label: 'Codex',
    wireApi: 'codex_cli',
    defaultBaseUrl: 'http://api-ai-coding.bilibili.co/api/v1/codex',
    baseUrlEnv: 'AICODING_BASE_URL',
    apiKeyEnv: 'AICODING_API_KEY',
    inputModeEnv: 'AICODING_INPUT_MODE',
    models: ['gpt-5.6-sol', 'gpt-5.6-terra'],
    capabilities: { chat: true, vision: true, svgDesign: true, rasterImage: false },
  },
  claudeCode: {
    id: 'claudeCode',
    label: 'Claude Code',
    wireApi: 'anthropic_messages',
    defaultBaseUrl: 'http://api-ai-coding.bilibili.co/api',
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
    apiKeyEnv: 'ANTHROPIC_AUTH_TOKEN',
    models: ['claude-opus-4-8'],
    capabilities: { chat: true, vision: true, svgDesign: false, rasterImage: false },
  },
  copilot: {
    id: 'copilot',
    label: 'Copilot',
    wireApi: 'copilot_prediction',
    defaultBaseUrl: 'https://copilot.bilibili.co/api/v1/prediction/e3558bcf-64ee-4522-85a5-e07ccfc7d99f',
    baseUrlEnv: 'COPILOT_API_URL',
    apiKeyEnv: 'COPILOT_API_KEY',
    models: ['default'],
    apiKeyOptional: true,
    capabilities: { chat: true, vision: true, svgDesign: false, rasterImage: false },
  },
  biliImage: {
    id: 'biliImage',
    label: 'Bilibili Image',
    wireApi: 'openai_images',
    defaultBaseUrl: 'http://llmapi.bilibili.co/v1',
    defaultApiKey: 'bsk-f8f0c4d36ce44f053ef55555cf889164',
    baseUrlEnv: 'BILI_IMAGE_BASE_URL',
    apiKeyEnv: 'BILI_IMAGE_API_KEY',
    models: ['gpt-image-2', 'nano-banana-pro'],
    capabilities: { chat: false, vision: false, svgDesign: false, rasterImage: true },
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

export function resolveModel(provider, model) {
  const selectedModel = model || provider.models[0]
  if (!provider.models.includes(selectedModel)) {
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
