/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COPILOT_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  readonly aiCampaignElectron?: {
    platform: 'electron'
  }
  readonly aiCampaignProjects?: {
    list: () => Promise<Array<{
      projectId: string
      title: string
      artboardCount: number
      updatedAt: string
    }>>
    load: (projectId: string) => Promise<{
      schemaVersion: 2
      projectId: string
      document: import('./features/editor/types').DesignDocument
      chatThreads: import('./features/editor/store/editor-store').EditorChatThread[]
      activeChatThreadId: string
      createdAt: string
      updatedAt: string
    } | undefined>
    save: (snapshot: unknown) => Promise<unknown>
    delete: (projectId: string) => Promise<boolean>
    listVersions: (projectId: string) => Promise<Array<{
      id: string
      documentVersion: number
      updatedAt: string
    }>>
    loadVersion: (projectId: string, versionId: string) => Promise<{
      schemaVersion: 2
      projectId: string
      document: import('./features/editor/types').DesignDocument
      chatThreads: import('./features/editor/store/editor-store').EditorChatThread[]
      activeChatThreadId: string
      createdAt: string
      updatedAt: string
    } | undefined>
  }
  readonly aiCampaignRuntime?: {
    getPublicState: () => Promise<{
      providers: Array<{
        id: string
        label: string
        models: string[]
        wireApi: string
        baseUrlHost?: string
        hasApiKey: boolean
        apiKeyEnv: string
        baseUrlEnv: string
        capabilities: {
          chat: boolean
          vision: boolean
          svgDesign: boolean
          rasterImage: boolean
        }
      }>
      skills: Array<{
        name: string
        description: string
        triggers: string[]
        tools: string[]
      }>
    }>
    cancelAgent: (sessionId: string) => Promise<boolean>
    ackDeliverable: (
      deliveryId: string,
      observation: import('./features/ai/types').CanvasWriteObservation,
    ) => Promise<boolean>
    startStream: (payload: unknown) => Promise<{
      text?: string
      artifact?: import('./features/ai/types').RuntimeImageArtifact
      artifacts?: Array<import('./features/ai/types').RuntimeImageArtifact>
      visualShellArtifact?: import('./features/ai/types').RuntimeImageArtifact
      blueprint?: import('./features/editor/types').DesignBlueprint
      qualityReview?: import('./features/editor/types').ArtifactQualityReview
      refined?: boolean
      componentDesign?: import('./features/editor/types').ComponentDesignMeta
      pageDesign?: import('./features/editor/types').PageDesignMeta
      pageComponents?: Array<{
        index?: number
        pageSectionId?: string
        componentDesign: import('./features/editor/types').ComponentDesignMeta
        artifacts: Array<import('./features/ai/types').RuntimeImageArtifact>
        visualShellArtifact?: import('./features/ai/types').RuntimeImageArtifact
      }>
      pageShellArtifact?: import('./features/ai/types').RuntimeImageArtifact
      awaitingConfirmation?: import('./features/ai/types').BlueprintConfirmation
      editScope?: import('./features/ai/types').ComponentEditScope
      agent?: {
        id: string
        goal?: string
        status: string
        skills?: string[]
        plan: Array<{ id: string; title: string; tool: string; status: string; error?: string }>
      }
      error?: { message?: string }
    }>
    onStreamToken: (
      listener: (data: { streamId: string; token: string }) => void,
    ) => () => void
    onStreamDone: (
      listener: (data: { streamId: string }) => void,
    ) => () => void
    onStreamError: (
      listener: (data: { streamId: string; error?: { message?: string } }) => void,
    ) => () => void
    onAgentEvent: (
      listener: (data: {
        streamId: string
        event: {
          type: string
          sessionId: string
          status?: string
          step?: { id: string; title: string; tool: string; status: string; error?: string }
          error?: string
        }
      }) => void,
    ) => () => void
    onDeliverable: (
      listener: (data: {
        streamId: string
        deliverable: {
          id: string
          sessionId: string
          runId: string
          stepId: string
          target?: import('./features/ai/types').ChatEditRequest['canvasTarget']
        } & ({
          kind: 'page-component'
          component: {
            index?: number
            pageSectionId?: string
            bounds?: { x: number; y: number; width: number; height: number }
            componentDesign: import('./features/editor/types').ComponentDesignMeta
            artifacts: Array<import('./features/ai/types').RuntimeImageArtifact>
            visualShellArtifact?: import('./features/ai/types').RuntimeImageArtifact
          }
        } | {
          kind: 'page-shell'
          blueprint: import('./features/editor/types').PageCompositionBlueprint
          pageShellArtifact: import('./features/ai/types').RuntimeImageArtifact
        })
      }) => void,
    ) => () => void
  }
}
