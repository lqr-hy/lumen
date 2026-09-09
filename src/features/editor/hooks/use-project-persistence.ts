import { useEffect, useState } from 'react'
import { useEditorStore } from '../store/editor-store'

export type ProjectSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function useProjectPersistence(projectId: string | undefined, ready: boolean) {
  const [status, setStatus] = useState<ProjectSaveStatus>('idle')
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    if (!ready || !projectId || !window.aiCampaignProjects) {
      setStatus('idle')
      return undefined
    }

    let timer: number | undefined
    let saving = false
    let pending = false

    function scheduleSave() {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => void saveNow(), 800)
    }

    async function saveNow() {
      const state = useEditorStore.getState()
      const document = state.document
      if (!document || document.id !== projectId) return
      if (saving) {
        pending = true
        return
      }
      saving = true
      setStatus('saving')
      try {
        await window.aiCampaignProjects?.save({
          schemaVersion: 1,
          projectId: document.id,
          document: { ...document, viewport: state.viewport },
          chatThreads: state.chatThreads,
          activeChatThreadId: state.activeChatThreadId,
          mutationLedger: state.mutationLedger,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
        })
        setStatus('saved')
      } catch {
        setStatus('error')
      } finally {
        saving = false
        if (pending) {
          pending = false
          scheduleSave()
        }
      }
    }

    scheduleSave()
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (
        state.document !== previous.document ||
        state.chatThreads !== previous.chatThreads ||
        state.activeChatThreadId !== previous.activeChatThreadId ||
        state.mutationLedger !== previous.mutationLedger
      ) {
        scheduleSave()
      }
    })
    const flush = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      void saveNow()
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      unsubscribe()
      if (timer !== undefined) window.clearTimeout(timer)
      window.removeEventListener('beforeunload', flush)
    }
  }, [projectId, ready, retryToken])

  return {
    status,
    retry: () => setRetryToken((value) => value + 1),
  }
}
