import { useEffect, useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import { ChevronDown, ChevronRight, Eye, GripVertical, Lock, Rows3 } from 'lucide-react'
import { useEditorStore } from '../store/editor-store'
import { cn } from '../../../lib/cn'
import type { DesignElement } from '../types'
import {
  canContainLayers,
  isLayerStructureEditable,
  type LayerDropPosition,
} from '../utils/layer-tree'
import { buildLayerIndex } from '../utils/layer-index'

export function LayerPanel() {
  const document = useEditorStore((state) => state.document)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId)
  const selectElement = useEditorStore((state) => state.selectElement)
  const selectArtboard = useEditorStore((state) => state.selectArtboard)
  const moveLayer = useEditorStore((state) => state.moveLayer)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [draggedId, setDraggedId] = useState<string>()
  const [dropTarget, setDropTarget] = useState<{
    id: string
    position: LayerDropPosition
  }>()
  const layerIndex = useMemo(() => buildLayerIndex(document?.elements ?? []), [document?.elements])

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

  const freeElements = layerIndex.rootsByArtboard.get(undefined) ?? []
  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const expandAll = () =>
    setExpandedIds(
      new Set(
        document.elements
          .map((element) => element.id)
          .concat(document.artboards.map((item) => item.id)),
      ),
    )
  const collapseAll = () => setExpandedIds(new Set())
  const handleLayerDrop = (sourceId: string, targetId: string, position: LayerDropPosition) => {
    const changed = moveLayer(sourceId, targetId, position)
    if (changed && position === 'inside') {
      setExpandedIds((current) => new Set(current).add(targetId))
    }
    setDraggedId(undefined)
    setDropTarget(undefined)
  }

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
                childrenByParent={layerIndex.childrenByParent}
                expandedIds={expandedIds}
                toggleExpanded={toggleExpanded}
                selectedElementIds={selectedElementIds}
                draggedId={draggedId}
                dropTarget={dropTarget}
                onDragStart={setDraggedId}
                onDragTarget={setDropTarget}
                onDragEnd={() => {
                  setDraggedId(undefined)
                  setDropTarget(undefined)
                }}
                onDrop={handleLayerDrop}
                onSelect={(id) => selectElement(id)}
              />
            ))}
          </div>
        ) : null}
        {document.artboards.map((artboard) => {
          const roots = layerIndex.rootsByArtboard.get(artboard.id) ?? []
          return (
            <div key={artboard.id} className="layer-section">
              <div
                className={cn('layer-artboard-row', activeArtboardId === artboard.id && 'active')}
              >
                <LayerDisclosure
                  id={artboard.id}
                  hasChildren={roots.length > 0}
                  expanded={expandedIds.has(artboard.id)}
                  onToggle={() => toggleExpanded(artboard.id)}
                />
                <button
                  className="layer-artboard"
                  type="button"
                  onClick={() => selectArtboard(artboard.id)}
                >
                  {artboard.name}
                </button>
              </div>
              {expandedIds.has(artboard.id)
                ? roots.map((element) => (
                    <LayerRow
                      key={element.id}
                      element={element}
                      depth={0}
                      childrenByParent={layerIndex.childrenByParent}
                      expandedIds={expandedIds}
                      toggleExpanded={toggleExpanded}
                      selectedElementIds={selectedElementIds}
                      draggedId={draggedId}
                      dropTarget={dropTarget}
                      onDragStart={setDraggedId}
                      onDragTarget={setDropTarget}
                      onDragEnd={() => {
                        setDraggedId(undefined)
                        setDropTarget(undefined)
                      }}
                      onDrop={handleLayerDrop}
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
  childrenByParent,
  expandedIds,
  toggleExpanded,
  selectedElementIds,
  draggedId,
  dropTarget,
  onDragStart,
  onDragTarget,
  onDragEnd,
  onDrop,
  onSelect,
}: {
  element: DesignElement
  depth: number
  childrenByParent: Map<string, DesignElement[]>
  expandedIds: Set<string>
  toggleExpanded: (id: string) => void
  selectedElementIds: string[]
  draggedId?: string
  dropTarget?: { id: string; position: LayerDropPosition }
  onDragStart: (id: string) => void
  onDragTarget: (target?: { id: string; position: LayerDropPosition }) => void
  onDragEnd: () => void
  onDrop: (sourceId: string, targetId: string, position: LayerDropPosition) => void
  onSelect: (id: string) => void
}) {
  const children = childrenByParent.get(element.id) ?? []
  const expanded = expandedIds.has(element.id)
  const selected = selectedElementIds.includes(element.id)
  const editable = isLayerStructureEditable(element)
  const activeDrop = dropTarget?.id === element.id ? dropTarget.position : undefined
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggedId || draggedId === element.id || !editable) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    onDragTarget({
      id: element.id,
      position: resolveLayerDropPosition(event, canContainLayers(element)),
    })
  }
  return (
    <>
      <div
        className={cn(
          'layer-item-row',
          selected && 'active',
          draggedId === element.id && 'dragging',
          activeDrop && `drop-${activeDrop}`,
        )}
        style={{ paddingLeft: 10 + depth * 14 }}
        draggable={editable}
        onDragStart={(event) => {
          if (!editable) return
          event.stopPropagation()
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', element.id)
          onDragStart(element.id)
        }}
        onDragOver={handleDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            onDragTarget(undefined)
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          const sourceId = draggedId || event.dataTransfer.getData('text/plain')
          const position = resolveLayerDropPosition(event, canContainLayers(element))
          if (sourceId) onDrop(sourceId, element.id, position)
        }}
        onDragEnd={onDragEnd}
      >
        <LayerDisclosure
          id={element.id}
          hasChildren={children.length > 0}
          expanded={expanded}
          onToggle={() => toggleExpanded(element.id)}
        />
        {editable ? (
          <GripVertical className="layer-drag-handle" size={13} aria-hidden="true" />
        ) : (
          <span className="layer-drag-placeholder" aria-hidden="true" />
        )}
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
              childrenByParent={childrenByParent}
              expandedIds={expandedIds}
              toggleExpanded={toggleExpanded}
              selectedElementIds={selectedElementIds}
              draggedId={draggedId}
              dropTarget={dropTarget}
              onDragStart={onDragStart}
              onDragTarget={onDragTarget}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
              onSelect={onSelect}
            />
          ))
        : null}
    </>
  )
}

function resolveLayerDropPosition(
  event: DragEvent<HTMLDivElement>,
  acceptsChildren: boolean,
): LayerDropPosition {
  const bounds = event.currentTarget.getBoundingClientRect()
  const ratio = (event.clientY - bounds.top) / Math.max(1, bounds.height)
  if (acceptsChildren && ratio >= 0.3 && ratio <= 0.7) return 'inside'
  return ratio < 0.5 ? 'before' : 'after'
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
    <button
      className="layer-disclosure"
      type="button"
      title={expanded ? '收起图层' : '展开图层'}
      aria-label={`${expanded ? '收起' : '展开'}图层 ${id}`}
      onClick={onToggle}
    >
      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
    </button>
  )
}
