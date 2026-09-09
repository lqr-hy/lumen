import { useCallback, useState } from 'react'
import type { RuntimeModelSelection } from './types'
import { getSelectedStylePackId, saveSelectedStylePackId } from './style-packs'

const CHAT_MODEL_KEY = 'lumen-chat-model-v1'
const IMAGE_MODEL_KEY = 'lumen-image-model-v1'

const DEFAULT_CHAT_MODEL: RuntimeModelSelection = { provider: 'codex', model: 'gpt-5.6-sol' }
const DEFAULT_IMAGE_MODEL: RuntimeModelSelection = { provider: 'image', model: 'gpt-image-2' }

export function useRuntimeSettings() {
  const [runtimeModel, setRuntimeModelState] = useState(() =>
    readModel(CHAT_MODEL_KEY, DEFAULT_CHAT_MODEL),
  )
  const [imageModel, setImageModelState] = useState(() =>
    readModel(IMAGE_MODEL_KEY, DEFAULT_IMAGE_MODEL),
  )
  const [stylePackId, setStylePackIdState] = useState(getSelectedStylePackId)

  const setRuntimeModel = useCallback((value: RuntimeModelSelection) => {
    setRuntimeModelState(value)
    saveModel(CHAT_MODEL_KEY, value)
  }, [])
  const setImageModel = useCallback((value: RuntimeModelSelection) => {
    setImageModelState(value)
    saveModel(IMAGE_MODEL_KEY, value)
  }, [])
  const setStylePackId = useCallback((value: string) => {
    setStylePackIdState(value)
    saveSelectedStylePackId(value)
  }, [])

  return {
    runtimeModel,
    imageModel,
    stylePackId,
    setRuntimeModel,
    setImageModel,
    setStylePackId,
  }
}

function readModel(key: string, fallback: RuntimeModelSelection) {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(key) || 'null',
    ) as Partial<RuntimeModelSelection> | null
    return value?.provider && value.model ? { provider: value.provider, model: value.model } : fallback
  } catch {
    return fallback
  }
}

function saveModel(key: string, value: RuntimeModelSelection) {
  window.localStorage.setItem(key, JSON.stringify(value))
}
