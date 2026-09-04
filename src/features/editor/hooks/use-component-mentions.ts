import { useCallback, useEffect, useState } from 'react'
import type { PromptMentionOption } from '../../../components/ui/PromptComposer'

export function useComponentMentions(projectId?: string) {
  const [options, setOptions] = useState<PromptMentionOption[]>([])

  const refresh = useCallback(async () => {
    if (!projectId || !window.aiCampaignRuntime?.listComponentPacks) {
      setOptions([])
      return
    }
    const packs = await window.aiCampaignRuntime.listComponentPacks(projectId)
    setOptions(
      packs.flatMap((pack) =>
        pack.components
          .filter((component) => component.kind === 'design')
          .map((component) => ({
            id: `component:${pack.id}:${component.name}`,
            resourceId: `${pack.id}:${component.name}`,
            type: 'component' as const,
            group: 'component' as const,
            name: component.name,
            label: component.name,
            description: [component.label, pack.label, ...component.aliases]
              .filter(Boolean)
              .join(' · '),
            packId: pack.id,
            componentName: component.name,
          })),
      ),
    )
  }, [projectId])

  useEffect(() => {
    void refresh().catch((error) => {
      console.warn('[component-mentions] load failed', error)
      setOptions([])
    })
  }, [refresh])

  const importComponent = useCallback(
    async (file: File) => {
      if (!projectId || !window.aiCampaignRuntime?.importProjectComponent) {
        throw new Error('当前 Runtime 不支持导入组件 JSON。')
      }
      if (!file.name.toLowerCase().endsWith('.json')) throw new Error('只支持导入 .json 组件文件。')
      if (file.size > 2 * 1024 * 1024) throw new Error('组件 JSON 不能超过 2MB。')
      const imported = await window.aiCampaignRuntime.importProjectComponent({
        projectId,
        fileName: file.name,
        source: await file.text(),
      })
      await refresh()
      return {
        id: `component:${imported.packId}:${imported.componentName}`,
        resourceId: `${imported.packId}:${imported.componentName}`,
        type: 'component' as const,
        group: 'component' as const,
        name: imported.componentName,
        label: imported.componentName,
        description: `${imported.label} · 项目导入组件`,
        packId: imported.packId,
        componentName: imported.componentName,
      } satisfies PromptMentionOption
    },
    [projectId, refresh],
  )

  return {
    componentMentionOptions: options,
    importComponent: window.aiCampaignRuntime?.importProjectComponent ? importComponent : undefined,
  }
}
