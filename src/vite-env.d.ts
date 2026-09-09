/// <reference types="vite/client" />

interface Window {
  readonly aiCampaignElectron?: {
    platform: 'electron'
  }
  readonly aiCampaignProjects?: {
    list: () => Promise<
      Array<{
        projectId: string
        title: string
        artboardCount: number
        updatedAt: string
      }>
    >
    load: (projectId: string) => Promise<
      | {
          schemaVersion: 2
          projectId: string
          document: import('./features/editor/types').DesignDocument
          chatThreads: import('./features/editor/store/editor-store').EditorChatThread[]
          activeChatThreadId: string
          mutationLedger: import('./features/editor/utils/mutation-ledger').MutationLedgerEntry[]
          createdAt: string
          updatedAt: string
        }
      | undefined
    >
    save: (snapshot: unknown) => Promise<unknown>
    delete: (projectId: string) => Promise<boolean>
    export: (projectId: string) => Promise<
      | {
          projectId: string
          title: string
          artboardCount: number
          updatedAt: string
        }
      | undefined
    >
    import: () => Promise<
      | {
          projectId: string
          title: string
          artboardCount: number
          updatedAt: string
        }
      | undefined
    >
    listVersions: (projectId: string) => Promise<
      Array<{
        id: string
        documentVersion: number
        updatedAt: string
      }>
    >
    loadVersion: (
      projectId: string,
      versionId: string,
    ) => Promise<
      | {
          schemaVersion: 2
          projectId: string
          document: import('./features/editor/types').DesignDocument
          chatThreads: import('./features/editor/store/editor-store').EditorChatThread[]
          activeChatThreadId: string
          mutationLedger: import('./features/editor/utils/mutation-ledger').MutationLedgerEntry[]
          createdAt: string
          updatedAt: string
        }
      | undefined
    >
  }
  readonly aiCampaignRuntime?: {
    listComponentPacks: (projectId: string) => Promise<
      Array<{
        id: string
        label: string
        version: number
        skill: string
        components: Array<{
          name: string
          label: string
          kind: 'design' | 'structural'
          aliases: string[]
        }>
      }>
    >
    importProjectComponent: (input: {
      projectId: string
      fileName: string
      source: string
    }) => Promise<{
      packId: string
      componentName: string
      label: string
    }>
    adaptComponentExport: (input: {
      packId: string
      componentName: string
      profile: string
      standardPackage: Uint8Array
    }) => Promise<{
      applied: boolean
      adapterId?: string
      package?: Uint8Array
    }>
    getPublicState: () => Promise<{
      providers: Array<{
        id: string
        label: string
        models: string[]
        defaultModel: string
        modelSource: string
        wireApi: string
        baseUrlHost?: string
        baseUrlSource: string
        hasApiKey: boolean
        apiKeyEnv: string
        baseUrlEnv: string
        capabilities: {
          chat: boolean
          vision: boolean
          structuredOutput?: boolean
          rasterImage: boolean
        }
      }>
      skills: Array<{
        name: string
        description: string
        triggers: string[]
        tools: string[]
        source: 'built-in' | 'user'
        enabled: boolean
        executable: boolean
      }>
      stylePacks: Array<import('./features/ai/style-packs').StylePackSummary>
    }>
    listUserExtensions: () => Promise<{
      skills: Array<{
        id: string
        name: string
        description: string
        source: 'user'
        enabled: boolean
        executable: false
      }>
      stylePacks: Array<import('./features/ai/style-packs').StylePackSummary>
    }>
    importUserSkill: () => Promise<{ id: string; name: string; description: string } | undefined>
    importStylePack: () => Promise<import('./features/ai/style-packs').StylePackSummary | undefined>
    exportStylePack: (id: string) => Promise<boolean>
    setUserExtensionEnabled: (
      kind: 'skills' | 'stylePacks',
      id: string,
      enabled: boolean,
    ) => Promise<boolean>
    removeUserExtension: (kind: 'skills' | 'stylePacks', id: string) => Promise<boolean>
    cancelAgent: (sessionId: string) => Promise<boolean>
    ackDeliverable: (
      deliveryId: string,
      observation: import('./features/ai/types').CanvasWriteObservation,
    ) => Promise<boolean>
    ackCanvasTarget: (
      requestId: string,
      resolution: import('./features/ai/types').CanvasTargetResolution,
    ) => Promise<boolean>
    ackCanvasSnapshot: (
      requestId: string,
      resolution: import('./features/ai/types').CanvasSnapshotResolution,
    ) => Promise<boolean>
    startStream: (payload: unknown) => Promise<{
      text?: string
      artifact?: import('./features/ai/types').RuntimeImageArtifact
      artifacts?: Array<import('./features/ai/types').RuntimeImageArtifact>
      blueprint?: import('./features/editor/types').DesignBlueprint
      qualityReview?: import('./features/editor/types').ArtifactQualityReview
      refined?: boolean
      canvasDelivered?: boolean
      componentDesign?: import('./features/editor/types').ComponentDesignMeta
      pageDesign?: import('./features/editor/types').PageDesignMeta
      pageComponents?: Array<{
        index?: number
        pageSectionId?: string
        componentDesign: import('./features/editor/types').ComponentDesignMeta
        artifacts: Array<import('./features/ai/types').RuntimeImageArtifact>
      }>
      pageShellArtifact?: import('./features/ai/types').RuntimeImageArtifact
      awaitingConfirmation?: import('./features/ai/types').BlueprintConfirmation
      editScope?: import('./features/ai/types').SelectionScope
      genericUiSchema?: import('./features/editor/types').GenericUiSchema
      visualAssetReport?: import('./features/ai/types').GenericUiRuntimeCanvasDeliverable['visualAssetReport']
      agent?: {
        id: string
        goal?: string
        status: string
        skills?: string[]
        plan: Array<{
          id: string
          title: string
          tool: string
          status: string
          error?: string
          partialFailure?: boolean
          partialSummary?: string
        }>
      }
      error?: { message?: string }
    }>
    onStreamToken: (listener: (data: { streamId: string; token: string }) => void) => () => void
    onStreamDone: (listener: (data: { streamId: string }) => void) => () => void
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
          step?: {
            id: string
            title: string
            tool: string
            status: string
            error?: string
            partialFailure?: boolean
            partialSummary?: string
          }
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
        } & (
          | {
              kind: 'page-component'
              component: {
                index?: number
                pageSectionId?: string
                bounds?: { x: number; y: number; width: number; height: number }
                componentDesign: import('./features/editor/types').ComponentDesignMeta
                artifacts: Array<import('./features/ai/types').RuntimeImageArtifact>
              }
            }
          | {
              kind: 'page-shell'
              blueprint: import('./features/editor/types').PageCompositionBlueprint
              pageShellArtifact: import('./features/ai/types').RuntimeImageArtifact
            }
          | {
              kind: 'image'
              artifacts: Array<import('./features/ai/types').RuntimeImageArtifact>
            }
          | {
              kind: 'asset-set'
              artifacts: Array<import('./features/ai/types').RuntimeImageArtifact>
            }
          | {
              kind: 'component'
              componentDesign: import('./features/editor/types').ComponentDesignMeta
              artifacts: Array<import('./features/ai/types').RuntimeImageArtifact>
              editScope?: import('./features/ai/types').SelectionScope
            }
          | {
              kind: 'component-slot'
              artifact: import('./features/ai/types').RuntimeImageArtifact
              editScope: import('./features/ai/types').SelectionScope
            }
          | {
              kind: 'page-shell-edit'
              artifact: import('./features/ai/types').RuntimeImageArtifact
              editScope: import('./features/ai/types').SelectionScope
            }
          | {
              kind: 'generic-ui'
              uiSchema: import('./features/editor/types').GenericUiSchema
            }
          | {
              kind: 'generic-ui-section'
              uiSchema: import('./features/editor/types').GenericUiSchema
              section: { index: number; id: string; kind: string; label: string }
              deliveredBlockIds: string[]
            }
          | {
              kind: 'generic-ui-finalize'
              uiSchema: import('./features/editor/types').GenericUiSchema
              expectedBlockIds: string[]
              failedSectionIndexes: number[]
            }
          | {
              kind: 'generic-ui-runtime'
              sceneGraph: import('./features/editor/scene/scene-graph').SceneGraph
              runtimeDraft?: {
                version: 1
                title: string
                viewport: { width: number; height: number }
              }
              expectedNodeCount: number
              visualAssetReport?: import('./features/ai/types').GenericUiRuntimeCanvasDeliverable['visualAssetReport']
            }
          | {
              kind: 'page-finalize'
              blueprint: import('./features/editor/types').PageCompositionBlueprint
              expectedComponentCount: number
              expectedPageSectionIds: string[]
            }
        )
      }) => void,
    ) => () => void
    onCanvasTargetRequest: (
      listener: (data: {
        streamId: string
        request: import('./features/ai/types').CanvasTargetRequest
      }) => void,
    ) => () => void
    onCanvasSnapshotRequest: (
      listener: (data: {
        streamId: string
        request: import('./features/ai/types').CanvasSnapshotRequest
      }) => void,
    ) => () => void
  }
}
