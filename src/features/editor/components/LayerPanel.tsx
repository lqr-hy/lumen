import { Eye, Lock, Rows3 } from 'lucide-react'
import { useEditorStore } from '../store/editor-store'
import { cn } from '../../../lib/cn'

export function LayerPanel() {
  const document = useEditorStore((state) => state.document)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId)
  const selectElement = useEditorStore((state) => state.selectElement)
  const selectArtboard = useEditorStore((state) => state.selectArtboard)

  if (!document) return null
  const freeElements = document.elements
    .filter((element) => !element.artboardId)
    .sort((a, b) => b.zIndex - a.zIndex)

  return (
    <aside className="layer-panel">
      <div className="panel-title">
        <Rows3 size={16} />
        图层
      </div>
      <div className="layer-list">
        {freeElements.length ? (
          <div className="layer-section">
            <div className="layer-artboard passive">自由画布</div>
            {freeElements.map((element) => (
              <button
                key={element.id}
                className={cn(
                  'layer-item',
                  selectedElementIds.includes(element.id) && 'active',
                )}
                type="button"
                onClick={() => selectElement(element.id)}
              >
                <span>{element.name}</span>
                <small>{element.type}</small>
                {element.visible === false ? <Eye size={13} /> : null}
                {element.locked ? <Lock size={13} /> : null}
              </button>
            ))}
          </div>
        ) : null}
        {document.artboards.map((artboard) => {
          const elements = document.elements
            .filter((element) => element.artboardId === artboard.id)
          const roots = elements
            .filter((element) => !element.parentId)
            .sort((a, b) => b.zIndex - a.zIndex)
          const orderedElements = roots.flatMap((root) => [
            root,
            ...elements
              .filter((element) => element.parentId === root.id)
              .sort((a, b) => b.zIndex - a.zIndex),
          ])

          return (
            <div key={artboard.id} className="layer-section">
              <button
                className={cn('layer-artboard', activeArtboardId === artboard.id && 'active')}
                type="button"
                onClick={() => selectArtboard(artboard.id)}
              >
                {artboard.name}
              </button>
              {orderedElements.map((element) => (
                <button
                  key={element.id}
                  className={cn(
                    'layer-item',
                    element.parentId && 'child',
                    selectedElementIds.includes(element.id) && 'active',
                  )}
                  type="button"
                  onClick={() => selectElement(element.id)}
                >
                  <span>{element.name}</span>
                  <small>{element.type}</small>
                  {element.visible === false ? <Eye size={13} /> : null}
                  {element.locked ? <Lock size={13} /> : null}
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
