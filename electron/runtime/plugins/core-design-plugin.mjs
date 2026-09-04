const step = (id, title, tool) => ({ id, title, tool, status: 'pending' })

const GENERIC_UI_PLAN = () => [
  step('prepare-generic-ui-references', '准备 UI 视觉参考', 'reference.prepare'),
  step('inspect-prompt-source', '检查 UI 设计来源', 'source.inspect'),
  step('create-design-spec-scene', '转换可编辑页面场景', 'source.to-scene'),
  step('transform-ui-design', '应用 UI 视觉设计', 'design.transform'),
  step('validate-generic-ui', '校验页面场景', 'scene.validate'),
  step('commit-generic-ui', '提交页面到画布', 'canvas.commit'),
]

export const coreDesignPlugin = Object.freeze({
  id: 'core-design',
  version: 1,
  required: true,
  capabilities: ['prompt-source', 'generic-ui', 'design-spec'],
  plans: {
    'generic-ui': GENERIC_UI_PLAN,
  },
  sourceAdapters: {
    prompt: {
      id: 'prompt-design-spec-source',
      taskKinds: ['generic-ui'],
      stageSignals: {
        'scene.validate': ['nextSteps'],
      },
      stageOutputs: {
        'canvas.commit': 'generic-ui',
      },
      stages: {
        'source.inspect': ['ui.extract-theme'],
        'source.to-scene': ['ui.plan'],
        'design.transform': ['ui.transform'],
        'scene.validate': ['ui.validate'],
        'canvas.commit': ['canvas.present-ui'],
      },
    },
  },
})
