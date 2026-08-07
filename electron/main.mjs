import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { getPublicRuntimeState } from './runtime/env.mjs'
import { startRuntimeStream } from './runtime/request.mjs'
import { cancelAgentRun } from './runtime/agent.mjs'
import { configureAgentSessionStore } from './runtime/agent-session-store.mjs'
import { configureSkillRuntime, listPublicSkills } from './runtime/skills.mjs'
import {
  configureProjectRepository,
  deleteProject,
  listProjects,
  listProjectVersions,
  loadProjectVersion,
  loadProjectSnapshot,
  saveProjectSnapshot,
} from './projects/project-repository.mjs'
import { configureArtifactRepository } from './artifacts/artifact-repository.mjs'

// 某些 Electron/Node 网络连接在远端提前断开时，会绕过 fetch Promise，
// 直接从底层 Socket 抛出 EPIPE。该错误不能让桌面主进程退出。
process.on('uncaughtException', (error) => {
  if (error?.code === 'EPIPE' || error?.message === 'write EPIPE') {
    console.warn('[runtime] ignored broken network pipe:', error)
    return
  }
  console.error('[main] uncaught exception:', error)
  app.quit()
})

process.on('unhandledRejection', (reason) => {
  if (reason?.code === 'EPIPE' || reason?.message === 'write EPIPE') {
    console.warn('[runtime] ignored broken network pipe rejection:', reason)
    return
  }
  console.error('[main] unhandled rejection:', reason)
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

let mainWindow
const pendingDeliverableAcks = new Map()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    title: 'AI Campaign Page Studio',
    backgroundColor: '#f6f7fb',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 9 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalUrl(url)) {
      const childWindow = createChildWindow()
      childWindow.loadURL(url)
      return { action: 'deny' }
    }

    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternalUrl(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.setVisualZoomLevelLimits(1, 1)
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(appRoot, 'dist', 'index.html'))
  }
}

function createChildWindow() {
  return new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1040,
    minHeight: 720,
    title: 'AI Campaign Page Studio',
    backgroundColor: '#f6f7fb',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
}

function isInternalUrl(url) {
  if (!url) return false
  if (isDev) return url.startsWith(process.env.VITE_DEV_SERVER_URL)
  return url.startsWith('file://')
}

app.whenReady().then(() => {
  configureAgentSessionStore(app.getPath('userData'))
  configureProjectRepository(app.getPath('userData'))
  configureArtifactRepository(app.getPath('userData'))
  configureSkillRuntime({
    appRoot,
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
  })
  registerRuntimeHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerRuntimeHandlers() {
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:load', (_event, projectId) => loadProjectSnapshot(projectId))
  ipcMain.handle('project:save', (_event, snapshot) => saveProjectSnapshot(snapshot))
  ipcMain.handle('project:delete', (_event, projectId) => deleteProject(projectId))
  ipcMain.handle('project:listVersions', (_event, projectId) => listProjectVersions(projectId))
  ipcMain.handle('project:loadVersion', (_event, projectId, versionId) => loadProjectVersion(projectId, versionId))

  ipcMain.handle('runtime:getPublicState', async () => ({
    ...getPublicRuntimeState(),
    skills: await listPublicSkills(),
  }))
  ipcMain.handle('runtime:cancelAgent', (_event, sessionId) => cancelAgentRun(sessionId))
  ipcMain.handle('runtime:ackDeliverable', (event, deliveryId, observation) => {
    const pending = pendingDeliverableAcks.get(deliveryId)
    if (!pending || pending.senderId !== event.sender.id) return false
    pendingDeliverableAcks.delete(deliveryId)
    clearTimeout(pending.timer)
    pending.resolve(observation)
    return true
  })

  ipcMain.handle('runtime:startStream', async (event, payload) => {
    try {
      const streamId = payload?.streamId
      const result = await startRuntimeStream(payload, {
        onToken: (token) => {
          if (!streamId) return
          event.sender.send('runtime:streamToken', { streamId, token })
        },
        onAgentEvent: (agentEvent) => {
          if (!streamId) return
          event.sender.send('runtime:agentEvent', { streamId, event: agentEvent })
        },
        onDeliverable: (deliverable) => waitForRendererDeliverable(event, streamId, deliverable),
      })
      if (streamId) event.sender.send('runtime:streamDone', { streamId })
      return result
    } catch (error) {
      const safeError = sanitizeRuntimeError(error)
      const streamId = payload?.streamId
      if (streamId) event.sender.send('runtime:streamError', { streamId, error: safeError })
      return { error: safeError }
    }
  })
}

function waitForRendererDeliverable(event, streamId, deliverable) {
  if (!streamId || event.sender.isDestroyed()) {
    return Promise.resolve({
      status: 'failed',
      summary: 'Renderer 不可用，增量交付未写入画布。',
      errorCode: 'RENDERER_UNAVAILABLE',
    })
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingDeliverableAcks.delete(deliverable.id)
      resolve({
        status: 'failed',
        summary: 'Renderer 增量交付确认超时。',
        errorCode: 'CANVAS_DELIVERY_TIMEOUT',
      })
    }, 30_000)
    pendingDeliverableAcks.set(deliverable.id, { resolve, timer, senderId: event.sender.id })
    event.sender.send('runtime:deliverable', { streamId, deliverable })
  })
}

function sanitizeRuntimeError(error) {
  if (!error || typeof error !== 'object') {
    return { code: 'RUNTIME_ERROR', message: 'runtime 请求失败。' }
  }
  return {
    code: typeof error.code === 'string' ? error.code : 'RUNTIME_ERROR',
    message: typeof error.message === 'string' ? error.message : 'runtime 请求失败。',
    details: error.details && typeof error.details === 'object' ? error.details : undefined,
  }
}
