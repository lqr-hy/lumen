import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('aiCampaignElectron', {
  platform: 'electron',
})

contextBridge.exposeInMainWorld('aiCampaignProjects', {
  list: () => ipcRenderer.invoke('project:list'),
  load: (projectId) => ipcRenderer.invoke('project:load', projectId),
  save: (snapshot) => ipcRenderer.invoke('project:save', snapshot),
  delete: (projectId) => ipcRenderer.invoke('project:delete', projectId),
  export: (projectId) => ipcRenderer.invoke('project:export', projectId),
  import: () => ipcRenderer.invoke('project:import'),
  listVersions: (projectId) => ipcRenderer.invoke('project:listVersions', projectId),
  loadVersion: (projectId, versionId) =>
    ipcRenderer.invoke('project:loadVersion', projectId, versionId),
})

contextBridge.exposeInMainWorld('aiCampaignRuntime', {
  getPublicState: () => ipcRenderer.invoke('runtime:getPublicState'),
  listUserExtensions: () => ipcRenderer.invoke('runtime:listUserExtensions'),
  importUserSkill: () => ipcRenderer.invoke('runtime:importUserSkill'),
  importStylePack: () => ipcRenderer.invoke('runtime:importStylePack'),
  exportStylePack: (id) => ipcRenderer.invoke('runtime:exportStylePack', id),
  setUserExtensionEnabled: (kind, id, enabled) =>
    ipcRenderer.invoke('runtime:setUserExtensionEnabled', kind, id, enabled),
  removeUserExtension: (kind, id) => ipcRenderer.invoke('runtime:removeUserExtension', kind, id),
  listComponentPacks: (projectId) => ipcRenderer.invoke('runtime:listComponentPacks', projectId),
  importProjectComponent: (input) => ipcRenderer.invoke('runtime:importProjectComponent', input),
  adaptComponentExport: (input) => ipcRenderer.invoke('runtime:adaptComponentExport', input),
  cancelAgent: (sessionId) => ipcRenderer.invoke('runtime:cancelAgent', sessionId),
  ackDeliverable: (deliveryId, observation) =>
    ipcRenderer.invoke('runtime:ackDeliverable', deliveryId, observation),
  ackCanvasTarget: (requestId, resolution) =>
    ipcRenderer.invoke('runtime:ackCanvasTarget', requestId, resolution),
  ackCanvasSnapshot: (requestId, resolution) =>
    ipcRenderer.invoke('runtime:ackCanvasSnapshot', requestId, resolution),
  startStream: (payload) => ipcRenderer.invoke('runtime:startStream', payload),
  onStreamToken: (listener) => {
    const wrapped = (_event, data) => listener(data)
    ipcRenderer.on('runtime:streamToken', wrapped)
    return () => ipcRenderer.off('runtime:streamToken', wrapped)
  },
  onStreamDone: (listener) => {
    const wrapped = (_event, data) => listener(data)
    ipcRenderer.on('runtime:streamDone', wrapped)
    return () => ipcRenderer.off('runtime:streamDone', wrapped)
  },
  onStreamError: (listener) => {
    const wrapped = (_event, data) => listener(data)
    ipcRenderer.on('runtime:streamError', wrapped)
    return () => ipcRenderer.off('runtime:streamError', wrapped)
  },
  onAgentEvent: (listener) => {
    const wrapped = (_event, data) => listener(data)
    ipcRenderer.on('runtime:agentEvent', wrapped)
    return () => ipcRenderer.off('runtime:agentEvent', wrapped)
  },
  onDeliverable: (listener) => {
    const wrapped = (_event, data) => listener(data)
    ipcRenderer.on('runtime:deliverable', wrapped)
    return () => ipcRenderer.off('runtime:deliverable', wrapped)
  },
  onCanvasTargetRequest: (listener) => {
    const wrapped = (_event, data) => listener(data)
    ipcRenderer.on('runtime:canvasTargetRequest', wrapped)
    return () => ipcRenderer.off('runtime:canvasTargetRequest', wrapped)
  },
  onCanvasSnapshotRequest: (listener) => {
    const wrapped = (_event, data) => listener(data)
    ipcRenderer.on('runtime:canvasSnapshotRequest', wrapped)
    return () => ipcRenderer.off('runtime:canvasSnapshotRequest', wrapped)
  },
})
