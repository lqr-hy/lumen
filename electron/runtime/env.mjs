import { PROVIDERS } from './providers.mjs'

export function getProviderRuntime(provider) {
  const apiKey = process.env[provider.apiKeyEnv] || provider.defaultApiKey || ''
  const baseUrl = process.env[provider.baseUrlEnv] || provider.defaultBaseUrl
  return {
    apiKey,
    baseUrl,
    hasApiKey: Boolean(apiKey),
  }
}

export function getPublicRuntimeState() {
  return {
    providers: Object.values(PROVIDERS).map((provider) => {
      const runtime = getProviderRuntime(provider)
      return {
        id: provider.id,
        label: provider.label,
        models: provider.models,
        wireApi: provider.wireApi,
        baseUrlHost: getUrlHost(runtime.baseUrl),
        hasApiKey: runtime.hasApiKey,
        apiKeyEnv: provider.apiKeyEnv,
        baseUrlEnv: provider.baseUrlEnv,
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
