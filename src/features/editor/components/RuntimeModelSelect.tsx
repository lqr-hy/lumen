import { useEffect, useMemo, useState } from 'react'

export interface RuntimeModelSelection {
  provider: string
  model: string
}

interface RuntimeProviderState {
  id: string
  label: string
  models: string[]
  hasApiKey: boolean
  apiKeyEnv: string
  capabilities: {
    chat: boolean
    svgDesign: boolean
    rasterImage: boolean
  }
}

interface RuntimeModelSelectProps {
  value: RuntimeModelSelection
  onChange: (selection: RuntimeModelSelection) => void
  compact?: boolean
  purpose?: 'chat' | 'image'
}

const BUILT_IN_IMAGE_PROVIDER: RuntimeProviderState = {
  id: 'biliImage',
  label: 'Bilibili Image',
  models: ['gpt-image-2', 'nano-banana-pro'],
  hasApiKey: true,
  apiKeyEnv: 'BILI_IMAGE_API_KEY',
  capabilities: {
    chat: false,
    svgDesign: false,
    rasterImage: true,
  },
}

export function RuntimeModelSelect({
  value,
  onChange,
  compact = false,
  purpose = 'chat',
}: RuntimeModelSelectProps) {
  const [providers, setProviders] = useState<RuntimeProviderState[]>([])

  useEffect(() => {
    let cancelled = false
    window.aiCampaignRuntime?.getPublicState()
      .then((state) => {
        if (cancelled) return
        setProviders(state.providers)
      })
      .catch(() => {
        if (!cancelled) setProviders([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const options = useMemo(
    () => {
      const effectiveProviders = purpose === 'image' && !providers.some((provider) => (
        provider.capabilities?.rasterImage
      ))
        ? [...providers, BUILT_IN_IMAGE_PROVIDER]
        : providers
      return effectiveProviders.filter((provider) => (
      purpose === 'image'
        ? provider.capabilities?.rasterImage
        : provider.capabilities?.chat
    )).flatMap((provider) =>
      provider.models.map((model) => ({
        key: `${provider.id}:${model}`,
        provider: provider.id,
        model,
        label: purpose === 'image' ? `生图 / ${model}` : `推理 / ${model}`,
        hasApiKey: provider.hasApiKey,
        apiKeyEnv: provider.apiKeyEnv,
      })),
      )
    },
    [providers, purpose],
  )

  useEffect(() => {
    if (!options.length) return
    const selectedExists = options.some(
      (option) => option.provider === value.provider && option.model === value.model,
    )
    if (!selectedExists) {
      onChange({ provider: options[0].provider, model: options[0].model })
    }
  }, [onChange, options, value.model, value.provider])

  if (!options.length) return null

  const selectedKey = options.some(
    (option) => option.provider === value.provider && option.model === value.model,
  )
    ? `${value.provider}:${value.model}`
    : options[0].key

  return (
    <label className={compact ? 'runtime-model-select compact' : 'runtime-model-select'}>
      <span>{purpose === 'image' ? '生图模型' : '推理模型'}</span>
      <select
        aria-label={purpose === 'image' ? '生图模型' : '推理模型'}
        title={purpose === 'image' ? '生图模型' : '推理模型'}
        value={selectedKey}
        onChange={(event) => {
          const option = options.find((item) => item.key === event.target.value)
          if (!option) return
          onChange({ provider: option.provider, model: option.model })
        }}
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.hasApiKey ? option.label : `${option.label}（缺少 ${option.apiKeyEnv}）`}
          </option>
        ))}
      </select>
    </label>
  )
}
