import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, createHashRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
const EditorPage = lazy(() =>
  import('../pages/EditorPage').then((module) => ({ default: module.EditorPage })),
)
const GeneratePage = lazy(() =>
  import('../pages/GeneratePage').then((module) => ({ default: module.GeneratePage })),
)
const HomePage = lazy(() =>
  import('../pages/HomePage').then((module) => ({ default: module.HomePage })),
)
const ProjectsPage = lazy(() =>
  import('../pages/ProjectsPage').then((module) => ({ default: module.ProjectsPage })),
)
const SkillsPage = lazy(() =>
  import('../pages/SkillsPage').then((module) => ({ default: module.SkillsPage })),
)
const TemplatesPage = lazy(() =>
  import('../pages/TemplatesPage').then((module) => ({ default: module.TemplatesPage })),
)
import { ResponsiveVisualFixturePage } from '../pages/ResponsiveVisualFixturePage'
import { CodegenParityFixturePage } from '../pages/CodegenParityFixturePage'
import { SnapshotFixturePage } from '../pages/SnapshotFixturePage'

const createAppRouter = window.lumenElectron ? createHashRouter : createBrowserRouter

function lazyElement(element: ReactNode) {
  return <Suspense fallback={<div className="route-loading">加载中…</div>}>{element}</Suspense>
}

export const router = createAppRouter([
  { path: '/__visual__/responsive', element: <ResponsiveVisualFixturePage /> },
  { path: '/__visual__/codegen-parity', element: <CodegenParityFixturePage /> },
  { path: '/__visual__/snapshot', element: <SnapshotFixturePage /> },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: lazyElement(<HomePage />) },
      { path: 'generate', element: lazyElement(<GeneratePage />) },
      { path: 'editor/:projectId', element: lazyElement(<EditorPage />) },
      { path: 'projects', element: lazyElement(<ProjectsPage />) },
      { path: 'skills', element: lazyElement(<SkillsPage />) },
      { path: 'templates', element: lazyElement(<TemplatesPage />) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
