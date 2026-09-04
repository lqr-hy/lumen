import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  configureSkillRuntime,
  executeSkillTool,
  resolveSkillNames,
} from '../electron/runtime/skills.mjs'
import { prepareImageGenerationTask } from '../electron/runtime/request.mjs'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
configureSkillRuntime({ appRoot, isPackaged: false })

const selected = await resolveSkillNames('根据 KV 和原型图生成设计图')
assert.ok(selected.includes('design-image-generation'))

const pageSkills = await resolveSkillNames('根据黄色 KV 生成完整页面设计稿')
assert.ok(pageSkills.includes('page-visual-direction'))
const pageDirection = await executeSkillTool('page-visual-direction.compile', {
  goal: '根据黄色 KV 生成抽奖活动完整页面',
  componentCount: 2,
  visualTheme: {
    colors: ['#ffbf1f', '#ff8a00', '#fff7d6', '#7a3500'],
    visualStyle: '黄色放射活动视觉',
  },
})
assert.equal(pageDirection.signature.owner, 'page-shell')
assert.equal(pageDirection.density.componentSurface, 'quiet')
assert.ok(pageDirection.embeddedComponentRules.some((rule) => rule.includes('不得重复页面主放射')))
assert.ok(pageDirection.antiPatterns.some((rule) => rule.includes('同一完整构图')))

const contrastDirection = await executeSkillTool('page-visual-direction.compile', {
  goal: '生成完整页面',
  visualTheme: {
    colors: ['#ffc928', '#ffffff'],
    colorTokens: [
      { role: 'background', value: '#ffc928' },
      { role: 'text', value: '#ffd95a' },
    ],
  },
})
assert.equal(contrastDirection.palette.text, '#181818', '低对比主题文字色没有被校正')

const uiBrief = await executeSkillTool('design-image-generation.compile-brief', {
  question: '根据原型图和黄色 KV 生成抽奖 H5 设计稿，标题保持“幸运抽奖”',
  requestType: 'generate_image',
  model: 'gpt-image-2',
  uploads: [
    { name: 'lottery-prototype.png', role: 'prototype' },
    { name: 'yellow-kv.png', role: 'kv' },
  ],
  imageTasks: [
    {
      id: 'design-image',
      name: 'lottery-page.png',
      kind: 'full-background',
      targetSize: { width: 375, height: 812 },
      prompt: '输出完整 H5 页面',
    },
  ],
})
assert.equal(uiBrief.mode, 'ui-page')
assert.match(uiBrief.question, /原始任务（完整保留）/)
assert.match(uiBrief.question, /Prototype 的基本布局/)
assert.match(uiBrief.question, /KV 延续主色/)
assert.match(uiBrief.question, /逐字文案约束/)
assert.match(uiBrief.tasks[0].prompt, /375 x 812px/)

const assetTask = {
  id: 'draw-button',
  name: 'draw-button.png',
  kind: 'button',
  targetSize: { width: 240, height: 80 },
  transparent: true,
  textPolicy: 'embedded-exact',
  prompt: '按钮文字严格为“抽一次”',
}
const assetCompiled = await prepareImageGenerationTask(
  {
    type: 'generate_assets',
    question: '单独生成抽一次按钮',
    imageModel: 'nano-banana-pro',
  },
  assetTask,
  [{ name: 'kv.png', role: 'kv', data: 'data:image/png;base64,ignored' }],
)
assert.equal(assetCompiled.brief.mode, 'isolated-asset')
assert.match(assetCompiled.question, /多参考图职责和不变量/)
assert.match(assetCompiled.taskPrompt, /真实透明 PNG/)
assert.match(assetCompiled.taskPrompt, /抽一次/)
assert.match(assetCompiled.taskPrompt, /纯图形底图/)
assert.match(assetCompiled.taskPrompt, /禁止出现任何汉字/)

const directTextAsset = await prepareImageGenerationTask(
  {
    type: 'generate_image',
    question: '生成抽一次按钮图片',
    imageModel: 'gpt-image-2',
  },
  {
    id: 'draw-one-button',
    name: 'draw-one-button.png',
    kind: 'component-slot',
    targetSize: { width: 160, height: 48 },
    transparent: true,
    textPolicy: 'model-exact',
    exactText: '抽一次',
    prompt: '生成按钮图片',
  },
  [],
)
assert.match(directTextAsset.taskPrompt, /准确文案“抽一次”/)
assert.doesNotMatch(directTextAsset.taskPrompt, /Runtime 合成准确文案/)

const filteredReferences = await prepareImageGenerationTask(
  {
    type: 'generate_image',
    question: '按 KV 生成按钮',
    imageModel: 'gpt-image-2',
  },
  assetTask,
  [{ name: 'selected-kv.png', role: 'kv' }],
)
assert.match(filteredReferences.question, /selected-kv\.png/)
assert.doesNotMatch(filteredReferences.question, /unused-prototype/)

const backgroundBrief = await executeSkillTool('design-image-generation.compile-brief', {
  question: '生成活动页面背景',
  requestType: 'generate_assets',
  model: 'gpt-image-2',
  imageTasks: [
    {
      id: 'page-shell',
      name: 'page-shell.png',
      kind: 'page-background',
      targetSize: { width: 375, height: 1200 },
    },
  ],
})
assert.equal(backgroundBrief.mode, 'page-background')
assert.match(backgroundBrief.question, /禁止烘焙文字、按钮、卡片/)

const componentShellBrief = await executeSkillTool('design-image-generation.compile-brief', {
  question: '生成任务组件视觉外壳',
  requestType: 'generate_image',
  model: 'gpt-image-2',
  uploads: [{ name: 'pink-kv.png', role: 'kv' }],
  imageTasks: [
    {
      id: 'component-shell',
      name: 'component-shell.png',
      kind: 'component-shell',
      targetSize: { width: 375, height: 480 },
    },
  ],
})
assert.equal(componentShellBrief.mode, 'component-shell')
assert.match(componentShellBrief.question, /允许铺满画布的底色、渐变/)
assert.match(componentShellBrief.question, /禁止卡片、列表项、按钮底座/)
assert.doesNotMatch(componentShellBrief.question, /禁止烘焙文字、按钮、卡片/)

console.log(
  JSON.stringify(
    {
      skillSelected: true,
      uiPromptCompiled: true,
      referenceRolesSeparated: true,
      transparentAssetContract: true,
      modelExactTextContract: true,
      pageBackgroundContract: true,
      componentShellContract: true,
      providerPayloadIntegrated: true,
      pageVisualDirection: true,
    },
    null,
    2,
  ),
)
