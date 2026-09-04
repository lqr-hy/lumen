const step = (id, title, tool) => ({ id, title, tool, status: 'pending' })

const COMPONENT_DESIGN_PLAN = () => [
  step('prepare-references', '准备设计参考', 'reference.prepare'),
  step('inspect-source', '检查设计来源', 'source.inspect'),
  step('create-scene', '转换可编辑场景', 'source.to-scene'),
  step('transform-design', '应用视觉设计', 'design.transform'),
  step('validate-scene', '校验场景质量', 'scene.validate'),
  step('commit-scene', '提交设计到画布', 'canvas.commit'),
]

const COMPONENT_SLOT_EDIT_PLAN = () => [
  step('prepare-references', '准备局部设计参考', 'reference.prepare'),
  step('regenerate-component-slot', '重新生成组件素材', 'component.regenerate-slot'),
  step('validate-component-slot', '验证组件素材', 'component.validate-slot'),
  step('present-component-slot', '替换组件素材', 'canvas.present-slot'),
]

const COMPONENT_SLOT_BATCH_EDIT_PLAN = () => [
  step('prepare-references', '准备批量设计参考', 'reference.prepare'),
  step('regenerate-component-slots', '批量重新生成组件素材', 'component.regenerate-slots'),
  step('validate-component-slots', '批量验证组件素材', 'component.validate-slots'),
  step('present-component-slots', '批量替换组件素材', 'canvas.present-slots'),
]

const PAGE_DESIGN_PLAN = () => [
  step('prepare-references', '准备页面设计参考', 'reference.prepare'),
  step('resolve-page-components', '检查页面设计来源', 'source.inspect'),
  step('create-page-blueprint', '转换页面可编辑场景', 'source.to-scene'),
  step('confirm-page-blueprint', '确认页面结构', 'source.confirm'),
  step('generate-page-shell', '应用页面视觉设计', 'design.transform'),
  step('review-page', '校验完整页面场景', 'scene.validate'),
  step('present-page', '提交完整页面到画布', 'canvas.commit'),
]

const PAGE_SHELL_EDIT_PLAN = () => [
  step('prepare-references', '准备页面视觉参考', 'reference.prepare'),
  step('regenerate-page-shell', '重新生成页面视觉外壳', 'page.regenerate-shell'),
  step('validate-page-shell', '验证页面视觉外壳', 'page.validate-shell'),
  step('present-page-shell', '替换页面视觉外壳', 'canvas.present-page-shell'),
]

export const campaignComponentPlugin = Object.freeze({
  id: 'campaign-component',
  version: 1,
  capabilities: [
    'component-pack',
    'component-props-binding',
    'component-slot-binding',
    'component-export',
    'campaign-page-composition',
  ],
  plans: {
    'component-design': COMPONENT_DESIGN_PLAN,
    'component-slot-edit': COMPONENT_SLOT_EDIT_PLAN,
    'component-slot-batch-edit': COMPONENT_SLOT_BATCH_EDIT_PLAN,
    'page-design': PAGE_DESIGN_PLAN,
    'page-shell-edit': PAGE_SHELL_EDIT_PLAN,
  },
  sourceAdapters: {
    component: {
      id: 'campaign-component-source',
      taskKinds: ['component-design'],
      stages: {
        'source.inspect': [
          'component.resolve',
          'component.inspect-runtime',
          'component.inspect-thumbnail',
        ],
        'source.to-scene': ['component.plan', 'component.plan-image'],
        'design.transform': [
          'component.generate-image',
          'component.validate-image',
          'component.package-image',
        ],
        'canvas.commit': ['canvas.present-component'],
      },
    },
    page: {
      id: 'campaign-page-source',
      taskKinds: ['page-design'],
      stageSignals: {
        'source.confirm': ['pause'],
        'design.transform': ['nextSteps'],
        'scene.validate': ['decision'],
      },
      stageOutputs: {
        'design.transform': 'page-shell',
        'canvas.commit': 'page',
      },
      stages: {
        'source.inspect': ['page.resolve-components'],
        'source.to-scene': ['page.blueprint'],
        'source.confirm': ['page.confirm-blueprint'],
        'design.transform': ['page.extract-theme', 'page.generate-shell'],
        'scene.validate': ['page.review'],
        'canvas.commit': ['canvas.present-page'],
      },
    },
  },
  tools: [
    'component.regenerate-slot',
    'component.validate-slot',
    'component.regenerate-slots',
    'component.validate-slots',
    'page.generate-component',
    'page.regenerate-shell',
    'page.validate-shell',
    'canvas.present-component',
    'canvas.present-slot',
    'canvas.present-slots',
    'canvas.present-page-shell',
  ],
})

export function createDefaultRuntimePlugins() {
  return [campaignComponentPlugin]
}
