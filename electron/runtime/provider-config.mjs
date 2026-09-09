import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP_CONFIG_DIRECTORY = '.ai-campaign-page-studio'

let configuredPaths = {}
let cachedFileConfig

/** 允许 Electron 主进程和测试显式指定配置根目录。 */
export function configureProviderRuntime(config = {}) {
  configuredPaths = { ...config }
  cachedFileConfig = undefined
}

/** 首次启动时创建不含密钥的 Studio 配置骨架，已有文件绝不覆盖。 */
export function ensureStudioProviderConfig() {
  const filePath = getProviderConfigPaths().app
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          version: 1,
          providers: {
            image: {
              baseUrlEnv: 'IMAGE_BASE_URL',
              apiKeyEnv: 'IMAGE_API_KEY',
              model: 'gpt-image-2',
              models: ['gpt-image-2', 'nano-banana-pro'],
            },
          },
        },
        null,
        2,
      ) + '\n',
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    )
    cachedFileConfig = undefined
    return { path: filePath, created: true }
  } catch (error) {
    if (error?.code === 'EEXIST') return { path: filePath, created: false }
    console.warn('[runtime] studio provider config could not be created', {
      file: filePath,
      reason: error instanceof Error ? error.message : String(error),
    })
    return { path: filePath, created: false }
  }
}

/**
 * 解析只在主进程使用的 Provider 配置。环境变量始终优先，其后依次为
 * Studio 配置、Codex/Claude Code 配置和 Provider 的公共默认值。
 */
export function resolveProviderRuntimeConfig(provider) {
  const files = loadFileConfig()
  const appProvider = normalizeAppProvider(files.app?.providers?.[provider.id])
  const systemProvider =
    provider.id === 'codex' ? files.codex : provider.id === 'claudeCode' ? files.claude : undefined

  const baseUrlCandidates = unique([
    appProvider?.baseUrlEnv,
    ...(provider.baseUrlEnvs ?? []),
    provider.baseUrlEnv,
  ])
  const environmentBaseUrl = firstEnvironmentValue(baseUrlCandidates)
  const configuredBaseUrl = firstNonEmpty([appProvider?.baseUrl, systemProvider?.baseUrl])
  const baseUrl = normalizeBaseUrl(
    environmentBaseUrl?.value || configuredBaseUrl || provider.defaultBaseUrl,
  )
  const baseUrlSource = environmentBaseUrl
    ? 'env:' + environmentBaseUrl.name
    : appProvider?.baseUrl
      ? 'studio-config'
      : systemProvider?.baseUrl
        ? systemProvider.source
        : provider.defaultBaseUrl
          ? 'default'
          : 'unconfigured'

  const apiKeyCandidates = unique([
    appProvider?.apiKeyEnv,
    systemProvider?.apiKeyEnv,
    ...(provider.apiKeyEnvs ?? []),
    provider.apiKeyEnv,
  ])
  const environmentApiKey = firstEnvironmentValue(apiKeyCandidates)
  const canUseSystemApiKey =
    baseUrlSource === systemProvider?.source && !appProvider?.apiKeyEnv && !appProvider?.apiKey
  const apiKey =
    environmentApiKey?.value ||
    appProvider?.apiKey ||
    (canUseSystemApiKey ? systemProvider?.apiKey : '') ||
    ''
  const apiKeyEnv = environmentApiKey?.name || firstNonEmpty(apiKeyCandidates) || ''
  const environmentModel = firstEnvironmentValue(provider.modelEnvs ?? [])
  const configuredModels = appProvider?.models?.length
    ? appProvider.models
    : systemProvider?.model
      ? [systemProvider.model]
      : provider.models
  const defaultModel =
    normalizeModelId(environmentModel?.value) ||
    appProvider?.model ||
    systemProvider?.model ||
    configuredModels[0]
  const models = unique([defaultModel, ...configuredModels])

  return {
    // 直接配置的密钥只在主进程内部使用，不会通过 getPublicRuntimeState 暴露。
    apiKey,
    apiKeyEnv,
    baseUrl,
    baseUrlEnv: firstNonEmpty(baseUrlCandidates) || '',
    baseUrlSource,
    codexCompatibility:
      provider.id === 'codex' &&
      (appProvider?.compatibility === 'aicoding' ||
        environmentBaseUrl?.name === 'AICODING_BASE_URL' ||
        systemProvider?.providerId === 'aicoding'),
    hasApiKey: Boolean(apiKey),
    defaultModel,
    models,
    modelSource: environmentModel
      ? 'env:' + environmentModel.name
      : appProvider?.model || appProvider?.models?.length
        ? 'studio-config'
        : systemProvider?.model
          ? systemProvider.source
          : 'default',
  }
}

export function getProviderConfigPaths() {
  const homeDir = configuredPaths.homeDir || os.homedir()
  const codexHome =
    configuredPaths.codexHome || process.env.CODEX_HOME || path.join(homeDir, '.codex')
  const claudeHome =
    configuredPaths.claudeHome || process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude')
  return {
    app:
      configuredPaths.appConfigPath ||
      process.env.AI_CAMPAIGN_STUDIO_CONFIG ||
      path.join(homeDir, APP_CONFIG_DIRECTORY, 'config.json'),
    codex: configuredPaths.codexConfigPath || path.join(codexHome, 'config.toml'),
    claude: configuredPaths.claudeSettingsPath || path.join(claudeHome, 'settings.json'),
  }
}

function loadFileConfig() {
  if (cachedFileConfig) return cachedFileConfig
  const paths = getProviderConfigPaths()
  cachedFileConfig = {
    app: readJson(paths.app),
    codex: readCodexConfig(paths.codex),
    claude: readClaudeConfig(paths.claude),
  }
  return cachedFileConfig
}

function readCodexConfig(filePath) {
  const source = readText(filePath)
  if (!source) return undefined
  const parsed = parseCodexProviderToml(source)
  const selected = parsed.modelProvider ? parsed.providers[parsed.modelProvider] : undefined
  if (!selected && !parsed.model) return undefined
  return {
    baseUrl: normalizeBaseUrl(selected?.base_url),
    apiKeyEnv: normalizeEnvironmentName(selected?.env_key),
    apiKey: normalizeSecret(parsed.shellEnvironment[selected?.env_key]),
    model: normalizeModelId(parsed.model),
    source: 'codex-config',
    providerId: parsed.modelProvider,
  }
}

function readClaudeConfig(filePath) {
  const settings = readJson(filePath)
  if (!settings) return undefined
  const env =
    settings.env && typeof settings.env === 'object' && !Array.isArray(settings.env)
      ? settings.env
      : {}
  const result = {
    baseUrl: normalizeBaseUrl(env.ANTHROPIC_BASE_URL),
    apiKey: normalizeSecret(env.ANTHROPIC_AUTH_TOKEN) || normalizeSecret(env.ANTHROPIC_API_KEY),
    apiKeyEnv: env.ANTHROPIC_AUTH_TOKEN
      ? 'ANTHROPIC_AUTH_TOKEN'
      : env.ANTHROPIC_API_KEY
        ? 'ANTHROPIC_API_KEY'
        : undefined,
    model: normalizeModelId(settings.model) || normalizeModelId(env.ANTHROPIC_MODEL),
    source: 'claude-config',
  }
  return result.baseUrl || result.apiKey || result.model ? result : undefined
}

function normalizeAppProvider(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const configuredApiKey = normalizeSecret(value.apiKey)
  return {
    baseUrl: normalizeBaseUrl(value.baseUrl),
    baseUrlEnv: normalizeEnvironmentName(value.baseUrlEnv),
    apiKeyEnv: normalizeEnvironmentName(value.apiKeyEnv),
    apiKey: configuredApiKey,
    model: normalizeModelId(value.model),
    models: normalizeModels(value.models),
    compatibility: value.compatibility === 'aicoding' ? 'aicoding' : undefined,
  }
}

function parseCodexProviderToml(source) {
  const providers = {}
  const shellEnvironment = {}
  let modelProvider
  let model
  let section = ''
  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim()
    if (!line) continue
    const sectionMatch = line.match(/^\[([^\]]+)]$/)
    if (sectionMatch) {
      section = sectionMatch[1].trim()
      continue
    }
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/)
    if (!assignment) continue
    const value = parseTomlString(assignment[2].trim())
    if (value === undefined) continue
    if (!section && assignment[1] === 'model_provider') modelProvider = value
    if (!section && assignment[1] === 'model') model = value
    if (section === 'shell_environment_policy.set') {
      shellEnvironment[assignment[1]] = value
      continue
    }
    const providerMatch = section.match(
      /^model_providers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))$/,
    )
    if (!providerMatch) continue
    const providerId = providerMatch[1] || providerMatch[2] || providerMatch[3]
    providers[providerId] ||= {}
    providers[providerId][assignment[1]] = value
  }
  return { modelProvider, model, providers, shellEnvironment }
}

function stripTomlComment(line) {
  let quote = ''
  let escaped = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (quote === '"' && character === '\\') {
      escaped = true
      continue
    }
    if ((character === '"' || character === "'") && (!quote || quote === character)) {
      quote = quote ? '' : character
      continue
    }
    if (character === '#' && !quote) return line.slice(0, index)
  }
  return line
}

function parseTomlString(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value)
    } catch {
      return undefined
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
  return undefined
}

function readJson(filePath) {
  const source = readText(filePath)
  if (!source) return undefined
  try {
    const value = JSON.parse(source)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch (error) {
    console.warn('[runtime] provider config ignored', {
      file: filePath,
      reason: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[runtime] provider config unavailable', {
        file: filePath,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
    return ''
  }
}

function normalizeBaseUrl(value) {
  const normalized = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
  if (!normalized) return ''
  try {
    const url = new URL(normalized)
    return url.protocol === 'http:' || url.protocol === 'https:' ? normalized : ''
  } catch {
    return ''
  }
}

function normalizeEnvironmentName(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return /^[A-Z_][A-Z0-9_]*$/.test(normalized) ? normalized : undefined
}

function normalizeSecret(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeModelId(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized && normalized.length <= 160 && !/[\0\r\n]/.test(normalized)
    ? normalized
    : undefined
}

function normalizeModels(value) {
  if (!Array.isArray(value)) return []
  return unique(value.map(normalizeModelId).filter(Boolean)).slice(0, 50)
}

function firstEnvironmentValue(names) {
  for (const name of unique(names)) {
    const value = normalizeSecret(process.env[name])
    if (value) return { name, value }
  }
  return undefined
}

function firstNonEmpty(values) {
  return values.find((value) => typeof value === 'string' && value.trim())
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}
