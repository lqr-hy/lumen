import { createRuntimeError, PROVIDERS } from './providers.mjs'
import { resolveProviderRuntimeConfig } from './provider-config.mjs'

export function getProviderRuntime(provider) {
  return resolveProviderRuntimeConfig(provider)
}

export function assertProviderRuntime(provider, runtime = getProviderRuntime(provider)) {
  if (!runtime.baseUrl) {
    throw createRuntimeError(
      'MISSING_BASE_URL',
      `${provider.label} 没有可用的 API 地址，请通过本地配置文件或 ${runtime.baseUrlEnv || provider.baseUrlEnv} 配置。`,
      { provider: provider.id, baseUrlEnv: runtime.baseUrlEnv || provider.baseUrlEnv },
    )
  }
  if (!runtime.hasApiKey && !provider.apiKeyOptional) {
    throw createRuntimeError(
      'MISSING_API_KEY',
      `未检测到 ${runtime.apiKeyEnv || provider.apiKeyEnv}，请配置后重启应用。`,
      { provider: provider.id, apiKeyEnv: runtime.apiKeyEnv || provider.apiKeyEnv },
    )
  }
  return runtime
}

export function getPublicRuntimeState() {
  return {
    providers: Object.values(PROVIDERS).map((provider) => {
      const runtime = getProviderRuntime(provider)
      return {
        id: provider.id,
        label: provider.label,
        models: runtime.models,
        defaultModel: runtime.defaultModel,
        modelSource: runtime.modelSource,
        wireApi: provider.wireApi,
        baseUrlHost: getUrlHost(runtime.baseUrl),
        baseUrlSource: runtime.baseUrlSource,
        hasApiKey: runtime.hasApiKey,
        apiKeyEnv: runtime.apiKeyEnv || provider.apiKeyEnv,
        baseUrlEnv: runtime.baseUrlEnv || provider.baseUrlEnv,
        capabilities: provider.capabilities,
      }
    }),
  }
}

function getUrlHost(url) {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}
