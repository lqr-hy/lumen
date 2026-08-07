import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('aiCampaignElectron', {
  platform: 'electron',
})

contextBridge.exposeInMainWorld('aiCampaignProjects', {
  list: () => ipcRenderer.invoke('project:list'),
  load: (projectId) => ipcRenderer.invoke('project:load', projectId),
  save: (snapshot) => ipcRenderer.invoke('project:save', snapshot),
  delete: (projectId) => ipcRenderer.invoke('project:delete', projectId),
  listVersions: (projectId) => ipcRenderer.invoke('project:listVersions', projectId),
  loadVersion: (projectId, versionId) => ipcRenderer.invoke('project:loadVersion', projectId, versionId),
})

contextBridge.exposeInMainWorld('aiCampaignRuntime', {
  getPublicState: () => ipcRenderer.invoke('runtime:getPublicState'),
  cancelAgent: (sessionId) => ipcRenderer.invoke('runtime:cancelAgent', sessionId),
  ackDeliverable: (deliveryId, observation) => (
    ipcRenderer.invoke('runtime:ackDeliverable', deliveryId, observation)
  ),
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
})
