import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Download,
  Palette,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react'
import {
  importBrowserStylePack,
  exportBrowserStylePack,
  listAvailableStylePacks,
  removeBrowserStylePack,
  setBrowserStylePackEnabled,
  type StylePackSummary,
} from '../features/ai/style-packs'

type PublicSkill = {
  id: string
  name: string
  description: string
  triggers: string[]
  tools: string[]
  source: 'built-in' | 'user'
  enabled: boolean
  executable: boolean
}

type LibraryTab = 'styles' | 'skills'

export function SkillsPage() {
  const [skills, setSkills] = useState<PublicSkill[]>([])
  const [stylePacks, setStylePacks] = useState<StylePackSummary[]>([])
  const [tab, setTab] = useState<LibraryTab>('styles')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const browserStyleInput = useRef<HTMLInputElement>(null)
  const desktop = Boolean(window.lumenRuntime)

  async function refresh() {
    setError('')
    if (!window.lumenRuntime) {
      setSkills([])
      setStylePacks(await listAvailableStylePacks())
      return
    }
    const [state, extensions] = await Promise.all([
      window.lumenRuntime.getPublicState(),
      window.lumenRuntime.listUserExtensions(),
    ])
    const skillMap = new Map<string, PublicSkill>()
    state.skills.forEach((skill) => skillMap.set(skill.name, { id: skill.name, ...skill }))
    extensions.skills.forEach((skill) => {
      const current = skillMap.get(skill.id)
      skillMap.set(skill.id, {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        triggers: current?.triggers ?? [],
        tools: current?.tools ?? [],
        source: 'user',
        enabled: skill.enabled,
        executable: false,
      })
    })
    setSkills([...skillMap.values()].sort((a, b) => a.name.localeCompare(b.name)))
    setStylePacks(state.stylePacks)
  }

  useEffect(() => {
    refresh()
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false))
  }, [])

  const normalizedQuery = query.trim().toLowerCase()
  const visibleSkills = useMemo(
    () =>
      skills.filter(
        (skill) =>
          !normalizedQuery ||
          [skill.name, skill.description, ...skill.triggers, ...skill.tools].some((value) =>
            value.toLowerCase().includes(normalizedQuery),
          ),
      ),
    [normalizedQuery, skills],
  )
  const visibleStylePacks = useMemo(
    () =>
      stylePacks.filter(
        (pack) =>
          !normalizedQuery ||
          [pack.name, pack.id, pack.description, ...(pack.constraints ?? [])].some((value) =>
            value.toLowerCase().includes(normalizedQuery),
          ),
      ),
    [normalizedQuery, stylePacks],
  )

  async function perform(operation: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await operation()
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  function importSkill() {
    if (!window.lumenRuntime) return
    void perform(() => window.lumenRuntime!.importUserSkill())
  }

  function importStyle() {
    if (window.lumenRuntime) {
      void perform(() => window.lumenRuntime!.importStylePack())
      return
    }
    browserStyleInput.current?.click()
  }

  function onBrowserStyleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    void perform(() => importBrowserStylePack(file))
  }

  function setEnabled(kind: 'skills' | 'stylePacks', id: string, enabled: boolean) {
    if (window.lumenRuntime) {
      void perform(() => window.lumenRuntime!.setUserExtensionEnabled(kind, id, enabled))
      return
    }
    if (kind === 'stylePacks') {
      setBrowserStylePackEnabled(id, enabled)
      void refresh()
    }
  }

  function exportStyle(pack: StylePackSummary) {
    if (window.lumenRuntime) {
      void perform(() => window.lumenRuntime!.exportStylePack(pack.id))
      return
    }
    exportBrowserStylePack(pack)
  }

  function remove(kind: 'skills' | 'stylePacks', id: string) {
    if (!window.confirm('确定删除这个用户扩展吗？')) return
    if (window.lumenRuntime) {
      void perform(() => window.lumenRuntime!.removeUserExtension(kind, id))
      return
    }
    if (kind === 'stylePacks') {
      removeBrowserStylePack(id)
      void refresh()
    }
  }

  const empty = tab === 'styles' ? !visibleStylePacks.length : !visibleSkills.length

  return (
    <div className="page skills-page">
      <header className="skills-header">
        <div>
          <span className="eyebrow">Extensions</span>
          <h1>能力与风格</h1>
          <p>管理可复用的设计语言和 Agent 能力。</p>
        </div>
        <div className="skills-header-actions">
          <label className="skills-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索"
            />
          </label>
          <button
            className="extension-import-button"
            type="button"
            disabled={busy}
            onClick={tab === 'styles' ? importStyle : importSkill}
          >
            <Upload size={16} />
            {tab === 'styles' ? '导入风格' : '导入 Skill'}
          </button>
          <input
            ref={browserStyleInput}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={onBrowserStyleFile}
          />
        </div>
      </header>

      <div className="extension-tabs" role="tablist">
        <button
          type="button"
          className={tab === 'styles' ? 'active' : ''}
          onClick={() => setTab('styles')}
        >
          <Palette size={16} />
          设计风格<span>{stylePacks.length}</span>
        </button>
        <button
          type="button"
          className={tab === 'skills' ? 'active' : ''}
          onClick={() => setTab('skills')}
        >
          <BookOpen size={16} />
          Agent Skill<span>{skills.length}</span>
        </button>
      </div>

      {loading ? <div className="skills-status">正在读取…</div> : null}
      {error ? <div className="skills-status error">{error}</div> : null}
      {!loading && !error && empty ? <div className="skills-status">没有匹配的内容。</div> : null}

      {tab === 'styles' ? (
        <div className="skills-grid style-pack-grid">
          {visibleStylePacks.map((pack) => (
            <article
              className={`skill-card style-pack-card${pack.enabled ? '' : ' disabled'}`}
              key={pack.id}
            >
              <div className="style-pack-preview" aria-label={`${pack.name} 色板`}>
                {Object.values(pack.colors)
                  .slice(0, 6)
                  .map((color, index) => (
                    <span key={`${color}-${index}`} style={{ background: color }} title={color} />
                  ))}
              </div>
              <div className="skill-card-title">
                <Palette size={19} />
                <div>
                  <h2>{pack.name}</h2>
                  <span>
                    {sourceLabel(pack.source)} · v{pack.version}
                  </span>
                </div>
                <StylePackActions
                  enabled={pack.enabled}
                  removable={pack.source !== 'built-in'}
                  onEnabled={(enabled) => setEnabled('stylePacks', pack.id, enabled)}
                  onRemove={() => remove('stylePacks', pack.id)}
                  onExport={() => exportStyle(pack)}
                />
              </div>
              <p>{pack.description || pack.id}</p>
              <div className="skill-tags">
                {Object.entries(pack.colors)
                  .slice(0, 5)
                  .map(([role, color]) => (
                    <span key={role}>
                      <i style={{ background: color }} />
                      {role}
                    </span>
                  ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="skills-grid">
          {visibleSkills.map((skill) => (
            <article className={`skill-card${skill.enabled ? '' : ' disabled'}`} key={skill.name}>
              <div className="skill-card-title">
                {skill.executable ? <Wrench size={19} /> : <BookOpen size={19} />}
                <div>
                  <h2>{skill.name}</h2>
                  <span>{skill.source === 'built-in' ? '内置能力' : '用户能力'}</span>
                </div>
                <ExtensionActions
                  enabled={skill.enabled}
                  removable={skill.source === 'user'}
                  onEnabled={(enabled) => setEnabled('skills', skill.id, enabled)}
                  onRemove={() => remove('skills', skill.id)}
                />
              </div>
              <p>{skill.description}</p>
              <div className="skill-security">
                {skill.executable ? <Wrench size={14} /> : <ShieldCheck size={14} />}
                {skill.executable
                  ? `${skill.tools.length} 个可信 Runtime Tool`
                  : '仅指导内容，不执行本地代码'}
              </div>
              <code>${skill.name}</code>
            </article>
          ))}
        </div>
      )}

      {!desktop && tab === 'skills' ? (
        <div className="skills-status">浏览器模式只支持声明式设计风格。</div>
      ) : null}
    </div>
  )
}

function ExtensionActions({
  enabled,
  removable,
  onEnabled,
  onRemove,
}: {
  enabled: boolean
  removable: boolean
  onEnabled: (enabled: boolean) => void
  onRemove: () => void
}) {
  if (!removable) return <ShieldCheck className="extension-built-in" size={16} />
  return (
    <div className="extension-actions">
      <label className="extension-toggle" title={enabled ? '停用' : '启用'}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabled(event.target.checked)}
        />
        <span />
      </label>
      <button type="button" title="删除" aria-label="删除" onClick={onRemove}>
        <Trash2 size={15} />
      </button>
    </div>
  )
}

function StylePackActions({
  enabled,
  removable,
  onEnabled,
  onRemove,
  onExport,
}: {
  enabled: boolean
  removable: boolean
  onEnabled: (enabled: boolean) => void
  onRemove: () => void
  onExport: () => void
}) {
  return (
    <div className="extension-actions">
      {removable ? (
        <label className="extension-toggle" title={enabled ? '停用' : '启用'}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabled(event.target.checked)}
          />
          <span />
        </label>
      ) : null}
      <button type="button" title="导出" aria-label="导出" onClick={onExport}>
        <Download size={15} />
      </button>
      {removable ? (
        <button type="button" title="删除" aria-label="删除" onClick={onRemove}>
          <Trash2 size={15} />
        </button>
      ) : null}
    </div>
  )
}

function sourceLabel(source: StylePackSummary['source']) {
  if (source === 'built-in') return '内置风格'
  if (source === 'browser') return '浏览器风格'
  return '用户风格'
}
