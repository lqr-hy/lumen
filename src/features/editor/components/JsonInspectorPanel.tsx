import { ArrowLeft, Copy, Download, FileJson, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useEditorStore } from '../store/editor-store'
import {
  createInspectorSnapshot,
  stringifyInspectorSnapshot,
  type InspectorScope,
} from '../utils/document-inspector'

interface JsonInspectorPanelProps {
  onBack: () => void
}

export function JsonInspectorPanel({ onBack }: JsonInspectorPanelProps) {
  const document = useEditorStore((state) => state.document)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId)
  const [scope, setScope] = useState<InspectorScope>(
    selectedElementIds.length ? 'selection' : 'artboard',
  )
  const [query, setQuery] = useState('')
  const snapshot = useMemo(
    () =>
      document
        ? createInspectorSnapshot(document, scope, selectedElementIds, activeArtboardId)
        : null,
    [activeArtboardId, document, scope, selectedElementIds],
  )
  const json = useMemo(() => stringifyInspectorSnapshot(snapshot), [snapshot])
  const visibleJson = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return json
    return json
      .split('\n')
      .filter((line) => line.toLowerCase().includes(normalizedQuery))
      .join('\n')
  }, [json, query])

  if (!document) return null

  function download() {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = globalThis.document.createElement('a')
    link.download = `${safeFileName(document?.title || 'design')}-${scope}.json`
    link.href = url
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <aside className="layer-panel json-inspector-panel">
      <div className="panel-title json-inspector-title">
        <button type="button" title="返回图层" onClick={onBack}>
          <ArrowLeft size={15} />
        </button>
        <FileJson size={16} />
        JSON 结构
      </div>
      <div className="json-inspector-controls">
        <div className="json-scope-tabs" role="tablist" aria-label="JSON 检查范围">
          {(
            [
              ['selection', '当前选择'],
              ['artboard', '当前画板'],
              ['document', '整个项目'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={scope === value}
              className={scope === value ? 'active' : undefined}
              disabled={value === 'selection' && !selectedElementIds.length}
              onClick={() => setScope(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="json-search-field">
          <Search size={14} />
          <input
            value={query}
            placeholder="搜索键或值"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="json-inspector-actions">
          <button type="button" onClick={() => void navigator.clipboard.writeText(json)}>
            <Copy size={14} />
            复制
          </button>
          <button type="button" onClick={download}>
            <Download size={14} />
            下载
          </button>
        </div>
      </div>
      <pre className="json-inspector-content">{visibleJson || '没有匹配结果'}</pre>
    </aside>
  )
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]/g, '-')
}
