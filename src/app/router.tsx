import { createBrowserRouter, createHashRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { EditorPage } from '../pages/EditorPage'
import { GeneratePage } from '../pages/GeneratePage'
import { HomePage } from '../pages/HomePage'
import { ProjectsPage } from '../pages/ProjectsPage'
import { SkillsPage } from '../pages/SkillsPage'
import { TemplatesPage } from '../pages/TemplatesPage'
import { ResponsiveVisualFixturePage } from '../pages/ResponsiveVisualFixturePage'
import { CodegenParityFixturePage } from '../pages/CodegenParityFixturePage'
import { SnapshotFixturePage } from '../pages/SnapshotFixturePage'

const createAppRouter = window.aiCampaignElectron ? createHashRouter : createBrowserRouter

export const router = createAppRouter([
  { path: '/__visual__/responsive', element: <ResponsiveVisualFixturePage /> },
  { path: '/__visual__/codegen-parity', element: <CodegenParityFixturePage /> },
  { path: '/__visual__/snapshot', element: <SnapshotFixturePage /> },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'generate', element: <GeneratePage /> },
      { path: 'editor/:projectId', element: <EditorPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'skills', element: <SkillsPage /> },
      { path: 'templates', element: <TemplatesPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
