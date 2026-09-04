import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Eye, Lock, Rows3 } from 'lucide-react'
import { useEditorStore } from '../store/editor-store'
import { cn } from '../../../lib/cn'
import type { DesignElement } from '../types'

export function LayerPanel() {
  const document = useEditorStore((state) => state.document)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId)
  const selectElement = useEditorStore((state) => state.selectElement)
  const selectArtboard = useEditorStore((state) => state.selectArtboard)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const currentDocument = useEditorStore.getState().document
    if (!currentDocument) {
      setExpandedIds(new Set())
      return
    }
    setExpandedIds(
      new Set([
        ...currentDocument.artboards.map((artboard) => artboard.id),
        ...currentDocument.elements
          .filter((element) => !element.parentId)
          .map((element) => element.id),
      ]),
    )
  }, [document?.id])

  if (!document) return null

  const freeElements = document.elements
    .filter((element) => !element.artboardId)
    .sort((a, b) => b.zIndex - a.zIndex)
  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const expandAll = () => setExpandedIds(new Set(document.elements.map((element) => element.id).concat(document.artboards.map((item) => item.id))))
  const collapseAll = () => setExpandedIds(new Set())

  return (
    <aside className="layer-panel">
      <div className="panel-title">
        <Rows3 size={16} />
        <span>图层</span>
        <div className="layer-panel-actions">
          <button type="button" title="全部展开" onClick={expandAll}>
            <ChevronDown size={14} />
          </button>
          <button type="button" title="全部收起" onClick={collapseAll}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div className="layer-list">
        {freeElements.length ? (
          <div className="layer-section">
            <div className="layer-artboard passive">自由画布</div>
            {freeElements.map((element) => (
              <LayerRow
                key={element.id}
                element={element}
                depth={0}
                elements={document.elements}
                expandedIds={expandedIds}
                toggleExpanded={toggleExpanded}
                selected={selectedElementIds.includes(element.id)}
                onSelect={(id) => selectElement(id)}
              />
            ))}
          </div>
        ) : null}
        {document.artboards.map((artboard) => {
          const elements = document.elements.filter((element) => element.artboardId === artboard.id)
          const roots = elements
            .filter((element) => !element.parentId || !elements.some((item) => item.id === element.parentId))
            .sort((a, b) => b.zIndex - a.zIndex)
          return (
            <div key={artboard.id} className="layer-section">
              <div className={cn('layer-artboard-row', activeArtboardId === artboard.id && 'active')}>
                <LayerDisclosure id={artboard.id} hasChildren={roots.length > 0} expanded={expandedIds.has(artboard.id)} onToggle={() => toggleExpanded(artboard.id)} />
                <button className="layer-artboard" type="button" onClick={() => selectArtboard(artboard.id)}>
                  {artboard.name}
                </button>
              </div>
              {expandedIds.has(artboard.id)
                ? roots.map((element) => (
                    <LayerRow
                      key={element.id}
                      element={element}
                      depth={0}
                      elements={elements}
                      expandedIds={expandedIds}
                      toggleExpanded={toggleExpanded}
                      selected={selectedElementIds.includes(element.id)}
                      onSelect={(id) => selectElement(id)}
                    />
                  ))
                : null}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function LayerRow({
  element,
  depth,
  elements,
  expandedIds,
  toggleExpanded,
  selected,
  onSelect,
}: {
  element: DesignElement
  depth: number
  elements: DesignElement[]
  expandedIds: Set<string>
  toggleExpanded: (id: string) => void
  selected: boolean
  onSelect: (id: string) => void
}) {
  const children = elements.filter((item) => item.parentId === element.id).sort((a, b) => b.zIndex - a.zIndex)
  const expanded = expandedIds.has(element.id)
  return (
    <>
      <div className={cn('layer-item-row', selected && 'active')} style={{ paddingLeft: 10 + depth * 14 }}>
        <LayerDisclosure id={element.id} hasChildren={children.length > 0} expanded={expanded} onToggle={() => toggleExpanded(element.id)} />
        <button className="layer-item" type="button" onClick={() => onSelect(element.id)}>
          <span>{element.name}</span>
          <small>{element.type}</small>
          {element.visible === false ? <Eye size={13} /> : null}
          {element.locked ? <Lock size={13} /> : null}
        </button>
      </div>
      {expanded
        ? children.map((child) => (
            <LayerRow
              key={child.id}
              element={child}
              depth={depth + 1}
              elements={elements}
              expandedIds={expandedIds}
              toggleExpanded={toggleExpanded}
              selected={false}
              onSelect={onSelect}
            />
          ))
        : null}
    </>
  )
}

function LayerDisclosure({
  id,
  hasChildren,
  expanded,
  onToggle,
}: {
  id: string
  hasChildren: boolean
  expanded: boolean
  onToggle: () => void
}) {
  if (!hasChildren) return <span className="layer-disclosure-placeholder" aria-hidden="true" />
  return (
    <button className="layer-disclosure" type="button" title={expanded ? '收起图层' : '展开图层'} aria-label={`${expanded ? '收起' : '展开'}图层 ${id}`} onClick={onToggle}>
      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
    </button>
  )
}
