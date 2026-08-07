import { Layers3 } from 'lucide-react'

export function TemplatesPage() {
  return (
    <div className="page compact-page">
      <div className="empty-state">
        <Layers3 size={32} />
        <h1>模板库</h1>
        <p>模板沉淀能力会复用 `DesignDocument` 数据模型。</p>
      </div>
    </div>
  )
}
