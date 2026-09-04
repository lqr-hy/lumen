import { createRuntimeError } from '../providers.mjs'
import { coreDesignPlugin } from './core-design-plugin.mjs'

export function createRuntimePluginRegistry(plugins = []) {
  const enabled = normalizePlugins([coreDesignPlugin, ...plugins])

  return {
    plugins: enabled,

    resolvePlan(taskKind) {
      const owners = enabled.filter((plugin) => plugin.plans?.[taskKind])
      if (owners.length > 1) {
        throw createRuntimeError(
          'RUNTIME_PLUGIN_PLAN_CONFLICT',
          `任务 ${taskKind} 同时由多个插件声明：${owners.map((plugin) => plugin.id).join('、')}`,
        )
      }
      const factory = owners[0]?.plans?.[taskKind]
      return typeof factory === 'function' ? clonePlan(factory()) : undefined
    },

    resolveSourceAdapter(taskKind) {
      const matches = enabled.flatMap((plugin) =>
        Object.values(plugin.sourceAdapters ?? {})
          .filter((adapter) => adapter.taskKinds?.includes(taskKind))
          .map((adapter) => ({ ...adapter, pluginId: plugin.id })),
      )
      if (matches.length > 1) {
        throw createRuntimeError(
          'SOURCE_ADAPTER_CONFLICT',
          `任务 ${taskKind} 同时匹配多个 Source Adapter：${matches.map((item) => item.id).join('、')}`,
        )
      }
      return matches[0]
    },

    installTools(toolCatalog, target) {
      const owners = new Map()
      for (const plugin of enabled) {
        for (const name of plugin.tools ?? []) {
          if (owners.has(name)) {
            throw createRuntimeError(
              'RUNTIME_PLUGIN_TOOL_CONFLICT',
              `工具 ${name} 同时由 ${owners.get(name)} 和 ${plugin.id} 声明。`,
            )
          }
          const implementation = toolCatalog.get(name)
          if (typeof implementation !== 'function') {
            throw createRuntimeError(
              'RUNTIME_PLUGIN_TOOL_MISSING',
              `插件 ${plugin.id} 声明的工具没有实现：${name}`,
            )
          }
          owners.set(name, plugin.id)
          target.set(name, implementation)
        }
      }
      for (const plugin of enabled) {
        for (const adapter of Object.values(plugin.sourceAdapters ?? {})) {
          for (const entries of Object.values(adapter.stages ?? {})) {
            for (const entry of entries) {
              const name = typeof entry === 'string' ? entry : entry?.tool
              if (!name || typeof toolCatalog.get(name) !== 'function') {
                throw createRuntimeError(
                  'SOURCE_ADAPTER_TOOL_MISSING',
                  `Source Adapter ${adapter.id} 缺少内部实现：${name || 'unknown'}`,
                )
              }
            }
          }
        }
      }
      return owners
    },

    hasCapability(capability) {
      return enabled.some((plugin) => plugin.capabilities?.includes(capability))
    },

    isAdapterInternalTool(name) {
      return enabled.some((plugin) =>
        Object.values(plugin.sourceAdapters ?? {}).some((adapter) =>
          Object.values(adapter.stages ?? {}).some((entries) =>
            entries.some((entry) => (typeof entry === 'string' ? entry : entry?.tool) === name),
          ),
        ),
      )
    },
  }
}

export function requirePluginPlan(registry, taskKind) {
  const plan = registry.resolvePlan(taskKind)
  if (plan) return plan
  throw createRuntimeError(
    'COMPONENT_PLUGIN_MISSING',
    `当前未启用可处理 ${taskKind} 的组件插件。请先安装或启用 Campaign Component Plugin。`,
  )
}

function normalizePlugins(plugins) {
  if (!Array.isArray(plugins)) throw new TypeError('Runtime plugins 必须是数组。')
  const ids = new Set()
  return plugins
    .filter((plugin) => plugin?.enabled !== false)
    .map((plugin) => {
      if (!plugin || typeof plugin.id !== 'string' || !plugin.id.trim()) {
        throw new TypeError('Runtime plugin 缺少有效 id。')
      }
      if (ids.has(plugin.id)) throw new TypeError(`Runtime plugin id 重复：${plugin.id}`)
      ids.add(plugin.id)
      return plugin
    })
}

function clonePlan(plan) {
  if (!Array.isArray(plan) || !plan.length) throw new TypeError('Plugin plan 不能为空。')
  return plan.map((step) => ({ ...step, status: 'pending' }))
}
