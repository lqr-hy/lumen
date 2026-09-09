import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getProviderRuntime, getPublicRuntimeState } from '../electron/runtime/env.mjs'
import {
  configureProviderRuntime,
  ensureStudioProviderConfig,
  getProviderConfigPaths,
} from '../electron/runtime/provider-config.mjs'
import { PROVIDERS, resolveProvider } from '../electron/runtime/providers.mjs'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-provider-config-'))
const appConfigPath = path.join(root, 'studio.json')
const codexConfigPath = path.join(root, 'codex.toml')
const claudeSettingsPath = path.join(root, 'claude.json')
const environmentNames = [
  'AICODING_BASE_URL',
  'AICODING_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'IMAGE_BASE_URL',
  'IMAGE_API_KEY',
  'CUSTOM_OPENAI_KEY',
]
const originalEnvironment = Object.fromEntries(
  environmentNames.map((name) => [name, process.env[name]]),
)

try {
  for (const name of environmentNames) delete process.env[name]
  configureProviderRuntime({ appConfigPath, codexConfigPath, claudeSettingsPath })
  const createdConfig = ensureStudioProviderConfig()
  assert.equal(createdConfig.created, true)
  const defaultStudioConfig = JSON.parse(await fs.readFile(appConfigPath, 'utf8'))
  assert.equal(defaultStudioConfig.providers.image.model, 'gpt-image-2')
  assert.deepEqual(defaultStudioConfig.providers.image.models, ['gpt-image-2', 'nano-banana-pro'])
  await fs.writeFile(
    appConfigPath,
    JSON.stringify({
      providers: {
        image: {
          baseUrl: 'https://legacy-image.example.test/v1',
          apiKey: 'legacy-image-secret',
        },
        openai: {
          baseUrl: 'https://openai-compatible.example/v1',
          apiKeyEnv: 'CUSTOM_OPENAI_KEY',
          model: 'custom-latest',
          models: ['custom-latest', 'custom-fast'],
        },
      },
    }),
  )
  await fs.writeFile(
    codexConfigPath,
    [
      'model_provider = "aicoding"',
      'model = "gpt-5.6-configured"',
      '[model_providers.aicoding]',
      'base_url = "https://codex.example.test/v1"',
      'env_key = "AICODING_API_KEY"',
      '[shell_environment_policy.set]',
      'AICODING_API_KEY = "codex-config-secret"',
    ].join('\n'),
  )
  await fs.writeFile(
    claudeSettingsPath,
    JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'https://claude.example.test',
        ANTHROPIC_AUTH_TOKEN: 'claude-settings-secret',
        ANTHROPIC_MODEL: 'claude-configured',
      },
    }),
  )
  process.env.CUSTOM_OPENAI_KEY = 'custom-openai-secret'
  configureProviderRuntime({ appConfigPath, codexConfigPath, claudeSettingsPath })

  const codex = getProviderRuntime(PROVIDERS.codex)
  assert.equal(codex.baseUrl, 'https://codex.example.test/v1')
  assert.equal(codex.apiKey, 'codex-config-secret')
  assert.equal(codex.baseUrlSource, 'codex-config')
  assert.equal(codex.codexCompatibility, true)
  assert.equal(codex.defaultModel, 'gpt-5.6-configured')
  assert.deepEqual(codex.models, ['gpt-5.6-configured'])

  const claude = getProviderRuntime(PROVIDERS.claudeCode)
  assert.equal(claude.baseUrl, 'https://claude.example.test')
  assert.equal(claude.apiKey, 'claude-settings-secret')
  assert.equal(claude.baseUrlSource, 'claude-config')
  assert.equal(claude.defaultModel, 'claude-configured')

  const image = getProviderRuntime(PROVIDERS.image)
  assert.equal(image.baseUrl, 'https://legacy-image.example.test/v1')
  assert.equal(image.apiKey, 'legacy-image-secret')
  assert.equal(resolveProvider('image').id, 'image')
  assert.throws(() => resolveProvider('biliImage'), /未被应用支持/)

  const openai = getProviderRuntime(PROVIDERS.openai)
  assert.equal(openai.baseUrl, 'https://openai-compatible.example/v1')
  assert.equal(openai.apiKey, 'custom-openai-secret')
  assert.deepEqual(openai.models, ['custom-latest', 'custom-fast'])
  assert.equal(openai.defaultModel, 'custom-latest')

  process.env.AICODING_BASE_URL = 'https://environment.example.test/codex'
  process.env.AICODING_API_KEY = 'codex-env-secret'
  configureProviderRuntime({ appConfigPath, codexConfigPath, claudeSettingsPath })
  const overriddenCodex = getProviderRuntime(PROVIDERS.codex)
  assert.equal(overriddenCodex.baseUrl, 'https://environment.example.test/codex')
  assert.equal(overriddenCodex.baseUrlSource, 'env:AICODING_BASE_URL')
  assert.equal(overriddenCodex.apiKey, 'codex-env-secret')

  delete process.env.AICODING_API_KEY
  configureProviderRuntime({ appConfigPath, codexConfigPath, claudeSettingsPath })
  const isolatedCodex = getProviderRuntime(PROVIDERS.codex)
  assert.equal(isolatedCodex.baseUrl, 'https://environment.example.test/codex')
  assert.equal(isolatedCodex.apiKey, '')
  assert.equal(isolatedCodex.hasApiKey, false)

  const publicState = getPublicRuntimeState()
  assert.equal(JSON.stringify(publicState).includes('secret'), false)
  assert.equal(
    publicState.providers.find((provider) => provider.id === 'codex')?.baseUrlHost,
    'environment.example.test',
  )
  assert.deepEqual(getProviderConfigPaths(), {
    app: appConfigPath,
    codex: codexConfigPath,
    claude: claudeSettingsPath,
  })

  console.log(
    JSON.stringify(
      {
        studioConfig: true,
        studioConfigCreated: true,
        codexConfig: true,
        configuredModels: true,
        claudeSettings: true,
        environmentOverride: true,
        endpointCredentialIsolation: true,
        directApiKey: true,
        secretsRedacted: true,
      },
      null,
      2,
    ),
  )
} finally {
  configureProviderRuntime()
  for (const name of environmentNames) {
    const value = originalEnvironment[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  await fs.rm(root, { recursive: true, force: true })
}
