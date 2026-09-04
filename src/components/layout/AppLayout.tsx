import { useEffect, useMemo, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import {
  BookOpen,
  Brush,
  Folder,
  Home,
  Images,
  LayoutDashboard,
  Plus,
  Sparkles,
  X,
} from 'lucide-react'
import type { AppTabRequest } from '../../app/app-tabs'
import { cn } from '../../lib/cn'

const links = [
  { to: '/', label: '灵感', icon: LayoutDashboard },
  { to: '/generate', label: '生成', icon: Sparkles },
  { to: '/projects', label: '资产', icon: Folder },
  { to: '/templates', label: '画布', icon: Images },
  { to: '/skills', label: '能力', icon: BookOpen },
]

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const editorMode = location.pathname.startsWith('/editor/')
  const electronMode = Boolean(window.aiCampaignElectron)
  const [tabs, setTabs] = useState<AppTabRequest[]>([{ path: '/', title: '首页' }])

  const activePath = location.pathname
  const activeTabTitle = useMemo(() => {
    if (activePath === '/') return '首页'
    if (activePath.startsWith('/editor/new')) return '新建画布'
    if (activePath === '/editor/recent-qinglan-packaging') return '青岚品牌包装'
    if (activePath.startsWith('/editor/')) return '画布'
    return links.find((item) => item.to === activePath)?.label ?? '页面'
  }, [activePath])

  useEffect(() => {
    if (!electronMode) return undefined

    function onOpenAppTab(event: Event) {
      const request = (event as CustomEvent<AppTabRequest>).detail
      if (!request?.path) return
      setTabs((current) => {
        if (current.some((tab) => tab.path === request.path)) return current
        return [...current, request]
      })
      navigate(request.path)
    }

    window.addEventListener('app-tab-open', onOpenAppTab)
    return () => window.removeEventListener('app-tab-open', onOpenAppTab)
  }, [electronMode, navigate])

  useEffect(() => {
    if (!electronMode) return
    setTabs((current) => {
      if (current.some((tab) => tab.path === activePath)) {
        return current.map((tab) =>
          tab.path === activePath ? { ...tab, title: activeTabTitle } : tab,
        )
      }
      return [...current, { path: activePath, title: activeTabTitle }]
    })
  }, [activePath, activeTabTitle, electronMode])

  function openNewCanvasTab() {
    const path = `/editor/new-${Date.now()}`
    setTabs((current) => [...current, { path, title: '新建画布' }])
    navigate(path)
  }

  function closeTab(path: string) {
    setTabs((current) => {
      const nextTabs = current.filter((tab) => tab.path !== path)
      if (path === activePath) {
        const nextTab = nextTabs[nextTabs.length - 1] ?? { path: '/', title: '首页' }
        window.setTimeout(() => navigate(nextTab.path), 0)
      }
      return nextTabs.length ? nextTabs : [{ path: '/', title: '首页' }]
    })
  }

  return (
    <div className={cn('app-frame', electronMode && 'electron-frame')}>
      {electronMode ? (
        <div className="app-tabs" data-tauri-drag-region>
          <button
            className={cn('app-tab home-tab', activePath === '/' && 'active')}
            type="button"
            onClick={() => navigate('/')}
            title="首页"
          >
            <Home size={20} />
          </button>
          <div className="app-tab-list">
            {tabs
              .filter((tab) => tab.path !== '/')
              .map((tab) => (
                <button
                  key={tab.path}
                  className={cn('app-tab project-tab', activePath === tab.path && 'active')}
                  type="button"
                  onClick={() => navigate(tab.path)}
                  title={tab.title}
                >
                  <span>{tab.title}</span>
                  <span
                    className="tab-close"
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation()
                      closeTab(tab.path)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      event.stopPropagation()
                      closeTab(tab.path)
                    }}
                  >
                    <X size={13} />
                  </span>
                </button>
              ))}
          </div>
          <button
            className="app-tab add-tab"
            type="button"
            onClick={openNewCanvasTab}
            title="新建画布"
          >
            <Plus size={20} />
          </button>
        </div>
      ) : null}
      <div className={cn('app-shell', editorMode && 'editor-mode')}>
        <aside className="app-sidebar">
          <div className="brand">
            <Brush size={22} />
          </div>
          <nav className="nav-list">
            {links.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => cn('nav-link', isActive && 'active')}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </nav>
          <div className="sidebar-footer">
            <button className="credit-pill" type="button">
              ✦ 60
            </button>
            <div className="avatar-dot" />
          </div>
        </aside>
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
