import type { RuntimeModelSelection } from '../../ai/types'
import { RuntimeModelSelect } from './RuntimeModelSelect'
import { StylePackSelect } from './StylePackSelect'

interface ComposerRuntimeControlsProps {
  runtimeModel: RuntimeModelSelection
  imageModel: RuntimeModelSelection
  stylePackId: string
  onRuntimeModelChange: (value: RuntimeModelSelection) => void
  onImageModelChange: (value: RuntimeModelSelection) => void
  onStylePackChange: (value: string) => void
}

export function ComposerRuntimeControls({
  runtimeModel,
  imageModel,
  stylePackId,
  onRuntimeModelChange,
  onImageModelChange,
  onStylePackChange,
}: ComposerRuntimeControlsProps) {
  return (
    <>
      <RuntimeModelSelect value={runtimeModel} onChange={onRuntimeModelChange} purpose="chat" />
      <RuntimeModelSelect value={imageModel} onChange={onImageModelChange} purpose="image" />
      <StylePackSelect value={stylePackId} onChange={onStylePackChange} />
    </>
  )
}
