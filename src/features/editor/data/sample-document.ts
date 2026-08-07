import type { DesignDocument } from '../types'
import { DEFAULT_CANVAS_VIEWPORT } from '../constants'

export function createBlankDocument(title = '未命名项目', projectId?: string): DesignDocument {
  const now = new Date().toISOString()

  return {
    id: projectId || `project-${Date.now()}`,
    title,
    version: 1,
    viewport: { ...DEFAULT_CANVAS_VIEWPORT },
    settings: {
      canvasMode: 'light',
      globalPrompt: '',
      gridVisible: true,
    },
    createdAt: now,
    updatedAt: now,
    assets: [],
    artboards: [],
    elements: [],
  }
}
