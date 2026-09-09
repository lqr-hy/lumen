import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getPublicRuntimeState } from './runtime/env.mjs'
import { ensureStudioProviderConfig } from './runtime/provider-config.mjs'
import { startRuntimeStream } from './runtime/request.mjs'
import { cancelDesignWorkflow } from './runtime/agent.mjs'
import { configureAgentSessionStore } from './runtime/agent-session-store.mjs'
import { closePiSessionStore, configurePiSessionStore } from './runtime/pi/session-store.mjs'
import { configureSkillRuntime, invalidateSkillCache, listPublicSkills } from './runtime/skills.mjs'
import {
  installStylePack,
  installUserSkill,
  listStylePacks,
  listUserExtensions,
  removeUserExtension,
  resolveStylePack,
  setUserExtensionEnabled,
} from './runtime/user-extensions.mjs'
import {
  executeComponentPackExportAdapter,
  importProjectComponent,
  listPublicComponentPacks,
} from './runtime/component-packs.mjs'
import {
  configureProjectRepository,
  deleteProject,
  listProjects,
  listProjectVersions,
  loadProjectVersion,
  loadProjectSnapshot,
  saveProjectSnapshot,
  exportProjectArchive,
  importProjectArchive,
} from './projects/project-repository.mjs'
import { configureArtifactRepository } from './artifacts/artifact-repository.mjs'
import { appendAgentRunLog, configureAgentRunLogger } from './runtime/agent-run-logger.mjs'

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
const pendingCanvasTargetAcks = new Map()
const pendingCanvasSnapshotAcks = new Map()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    title: 'Lumen',
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
    title: 'Lumen',
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
  ensureStudioProviderConfig()
  configureAgentSessionStore(app.getPath('userData'))
  configurePiSessionStore(app.getPath('userData'))
  configureProjectRepository(app.getPath('userData'))
  configureArtifactRepository(app.getPath('userData'))
  configureAgentRunLogger(app.getPath('userData'), {
    enabled: isDev || process.env.AI_STUDIO_AGENT_LOGS === '1',
  })
  configureSkillRuntime({
    appRoot,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
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

app.on('before-quit', () => {
  void closePiSessionStore()
})

function registerRuntimeHandlers() {
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:load', (_event, projectId) => loadProjectSnapshot(projectId))
  ipcMain.handle('project:save', (_event, snapshot) => saveProjectSnapshot(snapshot))
  ipcMain.handle('project:delete', (_event, projectId) => deleteProject(projectId))
  ipcMain.handle('project:export', async (_event, projectId) => {
    const snapshot = await loadProjectSnapshot(projectId)
    if (!snapshot) throw new Error('项目不存在，无法导出。')
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${snapshot.document.title || '未命名项目'}.lumen.zip`,
      filters: [{ name: 'Lumen Project', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return undefined
    return exportProjectArchive(projectId, result.filePath)
  })
  ipcMain.handle('project:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Lumen Project', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePaths[0]) return undefined
    return importProjectArchive(result.filePaths[0])
  })
  ipcMain.handle('project:listVersions', (_event, projectId) => listProjectVersions(projectId))
  ipcMain.handle('project:loadVersion', (_event, projectId, versionId) =>
    loadProjectVersion(projectId, versionId),
  )

  ipcMain.handle('runtime:getPublicState', async () => ({
    ...getPublicRuntimeState(),
    skills: await listPublicSkills(),
    stylePacks: await listStylePacks(),
  }))
  ipcMain.handle('runtime:listUserExtensions', () => listUserExtensions())
  ipcMain.handle('runtime:importUserSkill', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入用户 Skill',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Skill Package', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePaths[0]) return undefined
    const installed = await installUserSkill(result.filePaths[0])
    invalidateSkillCache()
    return installed
  })
  ipcMain.handle('runtime:importStylePack', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入设计风格',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Style Pack', extensions: ['json', 'zip'] }],
    })
    if (result.canceled || !result.filePaths[0]) return undefined
    return installStylePack(result.filePaths[0])
  })
  ipcMain.handle('runtime:exportStylePack', async (_event, id) => {
    const pack = (await listStylePacks()).find((item) => item.id === id)
    if (!pack) throw new Error(`设计风格不存在：${id}`)
    const { source: _source, enabled: _enabled, ...exportable } = pack
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出设计风格',
      defaultPath: `${pack.id}.style.json`,
      filters: [{ name: 'Style Pack JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return false
    await fs.writeFile(result.filePath, JSON.stringify(exportable, null, 2), 'utf8')
    return true
  })
  ipcMain.handle('runtime:setUserExtensionEnabled', async (_event, kind, id, enabled) => {
    const changed = await setUserExtensionEnabled(kind, id, enabled)
    if (kind === 'skills') invalidateSkillCache()
    return changed
  })
  ipcMain.handle('runtime:removeUserExtension', async (_event, kind, id) => {
    const removed = await removeUserExtension(kind, id)
    if (kind === 'skills') invalidateSkillCache()
    return removed
  })
  ipcMain.handle('runtime:listComponentPacks', (_event, projectId) =>
    listPublicComponentPacks(projectId),
  )
  ipcMain.handle('runtime:importProjectComponent', (_event, input) => importProjectComponent(input))
  ipcMain.handle('runtime:cancelAgent', (_event, sessionId) => cancelDesignWorkflow(sessionId))
  ipcMain.handle('runtime:adaptComponentExport', (_event, input) =>
    executeComponentPackExportAdapter(input),
  )
  ipcMain.handle('runtime:ackDeliverable', (event, deliveryId, observation) => {
    const pending = pendingDeliverableAcks.get(deliveryId)
    if (!pending || pending.senderId !== event.sender.id) return false
    pendingDeliverableAcks.delete(deliveryId)
    clearTimeout(pending.timer)
    pending.resolve(observation)
    return true
  })
  ipcMain.handle('runtime:ackCanvasTarget', (event, requestId, resolution) => {
    const pending = pendingCanvasTargetAcks.get(requestId)
    if (!pending || pending.senderId !== event.sender.id) return false
    pendingCanvasTargetAcks.delete(requestId)
    clearTimeout(pending.timer)
    pending.resolve(resolution)
    return true
  })
  ipcMain.handle('runtime:ackCanvasSnapshot', (event, requestId, resolution) => {
    const pending = pendingCanvasSnapshotAcks.get(requestId)
    if (!pending || pending.senderId !== event.sender.id) return false
    pendingCanvasSnapshotAcks.delete(requestId)
    clearTimeout(pending.timer)
    pending.resolve(sanitizeCanvasSnapshotResolution(resolution))
    return true
  })

  ipcMain.handle('runtime:startStream', async (event, payload) => {
    try {
      const streamId = payload?.streamId
      let agentEventSequence = 0
      const stylePack = payload?.stylePackId
        ? await resolveStylePack(payload.stylePackId)
        : undefined
      const result = await startRuntimeStream(
        { ...payload, stylePack },
        {
          onToken: (token) => {
            if (!streamId) return
            event.sender.send('runtime:streamToken', { streamId, token })
          },
          onAgentEvent: (agentEvent) => {
            if (!streamId) return
            const enrichedEvent = {
              version: 1,
              ...agentEvent,
              runId: agentEvent.runId || streamId,
              sequence: ++agentEventSequence,
              timestamp: Date.now(),
            }
            appendAgentRunLog(enrichedEvent)
            event.sender.send('runtime:agentEvent', {
              streamId,
              event: enrichedEvent,
            })
          },
          onDeliverable: (deliverable) => waitForRendererDeliverable(event, streamId, deliverable),
          onCanvasTargetRequest: (request) => waitForRendererCanvasTarget(event, streamId, request),
          onCanvasSnapshotRequest: (request) =>
            waitForRendererCanvasSnapshot(event, streamId, request),
        },
      )
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

function waitForRendererCanvasSnapshot(event, streamId, request) {
  if (!streamId || event.sender.isDestroyed()) {
    return Promise.resolve({
      status: 'failed',
      reason: 'Renderer 不可用，无法生成画板快照。',
      errorCode: 'RENDERER_UNAVAILABLE',
    })
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCanvasSnapshotAcks.delete(request.id)
      resolve({
        status: 'failed',
        reason: 'Renderer 画板快照生成超时。',
        errorCode: 'CANVAS_SNAPSHOT_TIMEOUT',
      })
    }, 30_000)
    pendingCanvasSnapshotAcks.set(request.id, { resolve, timer, senderId: event.sender.id })
    event.sender.send('runtime:canvasSnapshotRequest', { streamId, request })
  })
}

function sanitizeCanvasSnapshotResolution(value) {
  const snapshot = value?.snapshot
  const valid =
    value?.status === 'ready' &&
    snapshot?.mime === 'image/png' &&
    typeof snapshot.data === 'string' &&
    snapshot.data.startsWith('data:image/png;base64,') &&
    snapshot.data.length <= 24 * 1024 * 1024 &&
    Number.isFinite(snapshot.width) &&
    snapshot.width > 0 &&
    Number.isFinite(snapshot.height) &&
    snapshot.height > 0
  if (valid) {
    return {
      status: 'ready',
      snapshot: {
        data: snapshot.data,
        mime: 'image/png',
        width: snapshot.width,
        height: snapshot.height,
      },
    }
  }
  return {
    status: 'failed',
    reason:
      typeof value?.reason === 'string'
        ? value.reason
        : 'Renderer 返回的 PNG 快照无效或超过 18MB。',
    errorCode: typeof value?.errorCode === 'string' ? value.errorCode : 'CANVAS_SNAPSHOT_INVALID',
  }
}

function waitForRendererCanvasTarget(event, streamId, request) {
  if (!streamId || event.sender.isDestroyed()) {
    return Promise.resolve({
      status: 'failed',
      reason: 'Renderer 不可用，无法创建或选择目标画板。',
      errorCode: 'RENDERER_UNAVAILABLE',
    })
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCanvasTargetAcks.delete(request.id)
      resolve({
        status: 'failed',
        reason: 'Renderer 目标画板确认超时。',
        errorCode: 'CANVAS_TARGET_TIMEOUT',
      })
    }, 30_000)
    pendingCanvasTargetAcks.set(request.id, { resolve, timer, senderId: event.sender.id })
    event.sender.send('runtime:canvasTargetRequest', { streamId, request })
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
