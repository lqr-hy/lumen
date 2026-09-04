import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Code2, Copy, X } from 'lucide-react'
import Prism from 'prismjs'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-css'
import type { CodeDocument, CodeNode } from '../../codegen/types'

export function CodePreviewDialog({
  code,
  onClose,
}: {
  code: CodeDocument
  onClose: () => void
}) {
  const [tab, setTab] = useState<'preview' | 'html' | 'css'>('preview')
  const html = code.files.find((file) => file.path === 'index.html')?.content ?? ''
  const css = code.files.find((file) => file.path.endsWith('.css'))?.content ?? ''
  const srcDoc = useMemo(() => {
    if (!html) return ''
    const inlineCss = `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`
    return html.replace(/<link[^>]+href=["']styles\.css["'][^>]*>/i, inlineCss)
  }, [css, html])
  useEffect(() => {
    const body = globalThis.document.body
    const previousOverflow = body.style.overflow
    body.style.overflow = 'hidden'
    body.classList.add('code-preview-open')
    return () => {
      body.style.overflow = previousOverflow
      body.classList.remove('code-preview-open')
    }
  }, [])
  async function copy(value: string) { await navigator.clipboard?.writeText(value) }
  return createPortal(<div className="code-preview-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 2147483647 }} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onWheel={(event) => event.stopPropagation()} onTouchMove={(event) => event.stopPropagation()}><section className="code-preview-dialog" role="dialog" aria-modal="true" aria-label="HTML 结构预览" onWheel={(event) => event.stopPropagation()} onTouchMove={(event) => event.stopPropagation()}><header className="code-preview-header"><div><Code2 size={17} /><strong>{code.meta.title} · HTML 结构预览</strong><span>{code.meta.surface.width} × {code.meta.surface.height}</span></div><button type="button" title="关闭" onClick={onClose}><X size={18} /></button></header><div className="code-preview-body"><aside className="code-preview-tree"><strong>Scene Graph</strong><Tree node={code.root} /></aside><main className="code-preview-main"><nav className="code-preview-tabs" role="tablist">{(['preview', 'html', 'css'] as const).map((item) => <button key={item} type="button" className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item === 'preview' ? '渲染预览' : item.toUpperCase()}</button>)}</nav>{tab === 'preview' ? <div className="code-preview-frame"><iframe title="HTML 渲染预览" srcDoc={srcDoc} sandbox="allow-scripts" style={{ '--preview-surface-width': `${code.meta.surface.width}px`, '--preview-surface-height': `${code.meta.surface.height}px` } as CSSProperties} /></div> : <CodeBlock code={tab === 'html' ? html : css} language={tab === 'html' ? 'markup' : 'css'} onCopy={() => copy(tab === 'html' ? html : css)} />}</main></div>{code.diagnostics.length ? <footer className="code-preview-diagnostics">{code.diagnostics.map((item, index) => <span key={`${item.code}-${index}`} className={item.severity}>{item.code} · {item.message}</span>)}</footer> : null}</section></div>, globalThis.document.body)
}
function CodeBlock({ code, language, onCopy }: { code: string; language: 'markup' | 'css'; onCopy: () => Promise<void> }) { const highlighted = Prism.highlight(code, Prism.languages[language], language); return <div className="code-preview-code"><button type="button" title="复制代码" onClick={() => void onCopy()}><Copy size={15} /></button><pre className="code-preview-pre" data-language={language}>{highlighted.split('\n').map((line, index) => <span className="code-preview-line" key={`${index}-${line}`}><i>{String(index + 1).padStart(3, ' ')}</i><code dangerouslySetInnerHTML={{ __html: line || ' ' }} /></span>)}</pre></div> }
function Tree({ node, depth = 0 }: { node: CodeNode; depth?: number }) { const runtime = node.meta.runtime; const kind = runtime ? 'runtime-component' : 'native'; return <div className="code-preview-tree-branch"><div className="code-preview-tree-node" style={{ paddingLeft: depth * 12 }}><span className={kind}>{runtime ? '◇' : '□'}</span><span>{node.meta.name ?? node.role}</span><small>{runtime ? runtime.componentName : node.tag}</small></div>{node.children.map((child) => <Tree key={child.key} node={child} depth={depth + 1} />)}</div> }
