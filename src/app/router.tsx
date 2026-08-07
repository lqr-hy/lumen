import { createBrowserRouter, createHashRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { EditorPage } from '../pages/EditorPage'
import { GeneratePage } from '../pages/GeneratePage'
import { HomePage } from '../pages/HomePage'
import { ProjectsPage } from '../pages/ProjectsPage'
import { TemplatesPage } from '../pages/TemplatesPage'

const createAppRouter = window.aiCampaignElectron ? createHashRouter : createBrowserRouter

export const router = createAppRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'generate', element: <GeneratePage /> },
      { path: 'editor/:projectId', element: <EditorPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'templates', element: <TemplatesPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
