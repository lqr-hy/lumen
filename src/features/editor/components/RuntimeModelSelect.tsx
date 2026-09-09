import { useEffect, useMemo, useState } from 'react'
import { BrainCircuit, Image } from 'lucide-react'
import type { RuntimeModelSelection } from '../../ai/types'
import { CompactSelectMenu } from './CompactSelectMenu'

export type { RuntimeModelSelection } from '../../ai/types'

interface RuntimeProviderState {
  id: string
  label: string
  models: string[]
  hasApiKey: boolean
  apiKeyEnv: string
  baseUrlHost?: string
  capabilities: {
    chat: boolean
    vision?: boolean
    structuredOutput?: boolean
    rasterImage: boolean
  }
}

interface RuntimeModelSelectProps {
  value: RuntimeModelSelection
  onChange: (selection: RuntimeModelSelection) => void
  purpose?: 'chat' | 'image'
}

const BUILT_IN_IMAGE_PROVIDER: RuntimeProviderState = {
  id: 'image',
  label: 'Image',
  models: ['gpt-image-2', 'nano-banana-pro'],
  hasApiKey: true,
  apiKeyEnv: 'IMAGE_API_KEY',
  baseUrlHost: 'configured',
  capabilities: {
    chat: false,
    vision: false,
    structuredOutput: false,
    rasterImage: true,
  },
}

export function RuntimeModelSelect({ value, onChange, purpose = 'chat' }: RuntimeModelSelectProps) {
  const [providers, setProviders] = useState<RuntimeProviderState[]>([])

  useEffect(() => {
    let cancelled = false
    window.lumenRuntime
      ?.getPublicState()
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

  const options = useMemo(() => {
    const effectiveProviders =
      purpose === 'image' && !providers.some((provider) => provider.capabilities?.rasterImage)
        ? [...providers, BUILT_IN_IMAGE_PROVIDER]
        : providers
    return effectiveProviders
      .filter((provider) =>
        purpose === 'image' ? provider.capabilities?.rasterImage : provider.capabilities?.chat,
      )
      .filter((provider) => provider.hasApiKey && Boolean(provider.baseUrlHost))
      .flatMap((provider) =>
        provider.models.map((model) => ({
          key: `${provider.id}:${model}`,
          provider: provider.id,
          model,
          providerLabel: provider.label,
          label: purpose === 'image' ? `生图 / ${model}` : `推理 / ${model}`,
        })),
      )
  }, [providers, purpose])

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

  const selected = options.find((option) => option.key === selectedKey) ?? options[0]
  const ariaLabel = purpose === 'image' ? '生图模型' : '推理模型'
  return (
    <CompactSelectMenu
      ariaLabel={ariaLabel}
      className={purpose === 'image' ? 'image-model' : 'chat-model'}
      icon={purpose === 'image' ? <Image size={14} /> : <BrainCircuit size={14} />}
      value={selectedKey}
      displayValue={shortModelLabel(selected.model)}
      options={options.map((option) => ({
        value: option.key,
        label: shortModelLabel(option.model),
        description: `${option.providerLabel} · ${option.model}`,
      }))}
      onChange={(key) => selectOption(key, options, onChange)}
    />
  )
}

function selectOption(
  key: string,
  options: Array<{ key: string; provider: string; model: string }>,
  onChange: RuntimeModelSelectProps['onChange'],
) {
  const option = options.find((item) => item.key === key)
  if (option) onChange({ provider: option.provider, model: option.model })
}

function shortModelLabel(model: string) {
  if (/nano-banana-pro/i.test(model)) return 'Banana Pro'
  if (/gpt-image-2/i.test(model)) return 'Image-2'
  return model
    .replace(/^gpt-/i, 'GPT-')
    .replace(/claude-/i, 'Claude ')
    .replace(/-/g, ' ')
}
