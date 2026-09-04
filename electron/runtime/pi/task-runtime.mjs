import { createStudioPiModels } from './model-runtime.mjs'
import { createDesignSpecExample, describeDesignBlockRegistry } from '../design-catalog.mjs'

export async function requestPiTextTask({ provider, runtime, model, payload, callbacks = {} }) {
  const { models, model: selectedModel } = createStudioPiModels({ provider, runtime, model })
  const stream = models.streamSimple(
    selectedModel,
    {
      systemPrompt: buildTaskSystemPrompt(payload.type),
      messages: [
        {
          role: 'user',
          content: buildTaskContent(payload),
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: runtime.apiKey || 'provider-key-optional',
      signal: payload.signal,
      sessionId: payload.sessionId,
      reasoning: 'medium',
    },
  )
  let text = ''
  let finalMessage
  for await (const event of stream) {
    if (event.type === 'text_delta') {
      text += event.delta
      if (payload.type === 'chat') callbacks.onToken?.(event.delta)
    }
    if (event.type === 'done') finalMessage = event.message
    if (event.type === 'error') {
      throw new Error(event.error?.errorMessage || event.error?.message || 'Pi 模型请求失败。')
    }
  }
  if (finalMessage?.stopReason === 'error') {
    throw new Error(finalMessage.errorMessage || 'Pi 模型请求失败。')
  }
  const output =
    text ||
    finalMessage?.content
      ?.filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('') ||
    ''
  return {
    text: output,
    ...(payload.type === 'chat' ? {} : { data: parseJsonObject(output) }),
  }
}

function buildTaskContent(payload) {
  return [
    { type: 'text', text: payload.question },
    ...(payload.uploads ?? [])
      .filter((upload) => typeof upload?.data === 'string' && upload.data.startsWith('data:image/'))
      .map((upload) => ({
        type: 'image',
        data: upload.data.slice(upload.data.indexOf(',') + 1),
        mimeType: upload.mime || upload.data.match(/^data:([^;]+);/)?.[1] || 'image/png',
      })),
  ]
}

function buildTaskSystemPrompt(type) {
  const contracts = {
    extract_visual_theme:
      '输出 VisualThemeContract：source、referenceImageIndex、colors、colorTokens、typography、surfaces、effects、imagery、decoration、spacing、visualStyle、confidence。',
    extract_design_tree: [
      '输出 Thumbnail Vision Design Tree JSON：version=1、componentName、width、height、nodes、diagnostics。',
      'node type 只能是 container、surface、text、heading、button、image、icon、input、progress、list、list-item、divider、badge。',
      '每个 node 必须包含 id、type、role、bounds{x,y,width,height}、confidence；bounds 必须位于组件画布内。',
      '只在明确识别且给定的允许 Props 路径中填写 propPath；不确定时 bindingStatus=visual-only，不要猜测业务字段。',
      '保留缩略图中可见的标题、按钮、任务项、进度、分割线和装饰节点；不要把整个组件返回为 image。',
      '除非缩略图确实只有一个视觉对象，否则禁止只返回一个覆盖整个画布的根 container/surface。必须拆分可见的标题、列表项、按钮、图标、进度、分割线和装饰区域；通常至少返回 5 个节点，并使用 parentId 表达层级。',
    ].join('\\n'),
    vision_review: '输出 Vision Review：scores、issues、message。',
    generate_ui_schema: [
      '输出 DesignSpec JSON：version、surfaceKind、designArchetype、title、viewport、theme、blocks。',
      `可用 Block：${describeDesignBlockRegistry()}。`,
      '每个 Block 必须包含 id、kind、label；内容只能放在 title、items、fields、actions、columns、rows、children、media、layout 中。不得输出未注册类型。',
      `严格结构示例：${JSON.stringify(createDesignSpecExample('desktop-admin'))}`,
    ].join('\n'),
    generate_ui_runtime: [
      '输出 StaticUiRuntimeDraft JSON：version=1、title、viewport{width,height}、html、css。',
      'html 只能包含 body 内的静态语义 HTML，不得包含 script、style、iframe、object、embed、link、meta、事件属性或 javascript: URL。',
      'css 必须完成最终视觉设计，允许 Grid、Flex、绝对定位、伪元素、渐变和阴影；禁止 @import、expression 和脚本。',
      '使用 data-region-id 和 data-role 标记重要区域；所有用户可见文案必须直接存在于 HTML 中，不得使用伪文字或截图替代 UI。',
      'html 必须只有一个覆盖完整 viewport 的根元素；不要返回 body、html 或 head 标签，不要把 Header、Sidebar、Main 作为互相独立的顶层兄弟节点。',
      '页面必须铺满 viewport，专业工具界面应使用明确的工具栏、面板、工作区和检查器布局，不得退化为普通 Dashboard 卡片模板。',
    ].join('\n'),
    generate_design_patch:
      '输出 DesignPatch JSON：version=1、baseRevision、artboardId、summary、operations。优先使用 semantic-update 修改布局与外观语义；semantic-update 包含 elementId、semantic.layout 或 semantic.appearance。其他 operation 为 update、move、delete、add、replace-image、replace-text-range、replace-image-region，具体允许类型必须服从当前 SelectionScope。',
    generate_design_action:
      '输出 DesignAction JSON。action 只能是 replace-text、set-style、set-layout、move、set-visibility、replace-image；target.nodeId 必须来自 writableNodeIds。replace-text 使用 value；set-style 使用 property 和 value；set-layout 使用 layout；move 使用 x/y；set-visibility 使用 visible；replace-image 使用 prompt。只输出一个动作，不要输出 DesignPatch。',
    generate_design_spec_patch:
      '输出 DesignSpecPatch JSON：version=1、baseRevision、artboardId、summary、operations。operation 只能是 insert-block、update-block、remove-block、move-block。insert-block 包含 block 及可选 beforeBlockId/afterBlockId；update-block 包含 blockId、changes；remove-block 包含 blockId；move-block 包含 blockId 及 beforeBlockId/afterBlockId。不得同时使用 beforeBlockId 和 afterBlockId。',
  }
  if (type === 'chat') {
    return '你是 AI Campaign Page Studio 助手。直接正常回答，不输出 operations 或 DesignDocument。'
  }
  return [
    '你是 AI Campaign Page Studio 的结构化设计任务模型。',
    contracts[type] || '输出任务要求的结构化结果。',
    '只返回一个 JSON 对象，不要使用 Markdown 代码块，不要解释，不要调用文件或命令工具。',
  ].join('\n')
}

function parseJsonObject(value) {
  const source = String(value || '').trim()
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  for (const candidate of [source, fenced, sliceJsonObject(source)].filter(Boolean)) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      // Try the next supported envelope.
    }
  }
  throw new Error('Pi 模型没有返回有效 JSON 对象。')
}

function sliceJsonObject(source) {
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  return start >= 0 && end > start ? source.slice(start, end + 1) : ''
}
