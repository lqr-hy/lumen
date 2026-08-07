export type PlacementMode =
  | 'auto'
  | 'new-artboard'
  | 'append-section'
  | 'duplicate-variant'
  | 'asset-board'

export interface PlacementDecision {
  mode: Exclude<PlacementMode, 'auto'>
  source: 'prompt' | 'control' | 'default'
}

const VARIANT_PATTERN = /(?:再来|再做|生成|创建).{0,12}(?:版本|变体|方案)|(?:另一个|新的).{0,8}(?:版本|变体|方案)|换(?:个|一套).{0,8}(?:版本|方案|风格)/i
const ASSET_PATTERN = /(?:独立|单独|分别|逐个).{0,20}(?:素材|按钮|图标|背景|装饰)|(?:按钮|图标|背景|装饰).{0,12}素材|素材画板|素材区/i
const APPEND_PATTERN = /(?:当前|这个|现有).{0,10}(?:画板|页面).{0,12}(?:增加|新增|添加|补充|继续)|(?:继续|往下|下面|底部|末尾).{0,12}(?:增加|新增|添加|生成|扩展)|(?:新增|添加|补充).{0,10}(?:模块|区块|section)/i
const NEW_ARTBOARD_PATTERN = /(?:新建|新增|创建|增加).{0,8}(?:一个|一张|个)?\s*(?:画板|画布|面板)|添加(?:一个|一张|个)\s*(?:画板|画布|面板)|(?:画板|画布|面板).{0,8}(?:新建|新增|创建)/i
const NEW_PAGE_PATTERN = /(?:再|新|另|第二|下一个).{0,10}(?:生成|创建|做|来)?(?:一个|一张|套)?\s*(?:页面|界面|ui|screen|h5|落地页)|(?:生成|创建|做).{0,10}(?:新页面|新界面|第二页|下一个页面|另一个页面|另一个ui)/i

export function resolvePlacementIntent(
  prompt: string,
  controlMode: PlacementMode = 'auto',
): PlacementDecision {
  const value = prompt.trim()
  if (VARIANT_PATTERN.test(value)) return { mode: 'duplicate-variant', source: 'prompt' }
  if (ASSET_PATTERN.test(value)) return { mode: 'asset-board', source: 'prompt' }
  if (NEW_ARTBOARD_PATTERN.test(value)) return { mode: 'new-artboard', source: 'prompt' }
  if (APPEND_PATTERN.test(value)) return { mode: 'append-section', source: 'prompt' }
  if (NEW_PAGE_PATTERN.test(value)) return { mode: 'new-artboard', source: 'prompt' }
  if (controlMode !== 'auto') return { mode: controlMode, source: 'control' }
  return { mode: 'append-section', source: 'default' }
}

export function isExplicitNewArtboardPrompt(prompt: string) {
  return NEW_ARTBOARD_PATTERN.test(prompt.trim())
}

export const PLACEMENT_MODE_OPTIONS: Array<{ value: PlacementMode; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'new-artboard', label: '新页面' },
  { value: 'append-section', label: '当前画板' },
  { value: 'duplicate-variant', label: '新变体' },
  { value: 'asset-board', label: '素材' },
]
