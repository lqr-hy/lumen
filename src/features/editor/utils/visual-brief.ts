import type { Artboard, DesignDocument, DesignElement } from '../types'

/**
 * 设计语言的材质 Token 组。
 *
 * 只描述视觉词汇（圆角、描边、深度、纹理、母题），不描述业务内容、信息架构
 * 和布局节奏——后者由 Brief 的 pageType/density/layoutRhythm 负责。
 *
 * `shadow: null` 表示该语言不使用投影，归一化会移除投影而不是改写它。
 */
export interface DesignLanguageTokens {
  cornerStyle: string
  cornerRadius: number
  strokeWidth: number
  shadow: { x: number; y: number; blur: number; color: string } | null
  typographyContrast: string
  texture: string
  depthModel: string
  motif: string
  antiPatterns: string[]
}

export interface DesignLanguage {
  id: string
  name: string
  description: string
  tokens: DesignLanguageTokens
}

/**
 * 内置设计语言。差异必须体现在 depthModel/cornerStyle/shadow 上，
 * 只换配色不算不同语言——那是 paletteRoles 的职责。
 */
export const DESIGN_LANGUAGES: DesignLanguage[] = [
  {
    id: 'neo-brutalist',
    name: '新粗野',
    description: '硬边偏移、实心描边、零模糊投影，强调结构本身',
    tokens: {
      cornerStyle: '直角到小圆角，绝不使用大圆角',
      cornerRadius: 8,
      strokeWidth: 3,
      shadow: { x: 8, y: 8, blur: 0, color: 'rgba(15, 23, 42, 0.9)' },
      typographyContrast: '超粗标题与常规正文形成强反差，字号跨度大',
      texture: '纯色平涂，不使用渐变和噪点',
      depthModel: '硬边偏移投影表达层级，不使用模糊',
      motif: '粗描边矩形与实心色块',
      antiPatterns: ['渐变投影', '毛玻璃', '大圆角卡片', '柔和阴影'],
    },
  },
  {
    id: 'soft-depth',
    name: '柔性层叠',
    description: '大圆角、柔和高斯投影、克制描边，强调可触摸的层次',
    tokens: {
      cornerStyle: '统一大圆角，卡片与按钮保持同一半径家族',
      cornerRadius: 16,
      strokeWidth: 1,
      shadow: { x: 0, y: 12, blur: 32, color: 'rgba(15, 23, 42, 0.16)' },
      typographyContrast: '中等字重层级，靠字号与颜色区分，不靠极端字重',
      texture: '细微渐变过渡，允许低强度噪点',
      depthModel: '多层柔和投影表达高度差',
      motif: '圆角矩形与胶囊形',
      antiPatterns: ['硬边偏移投影', '粗描边', '直角卡片'],
    },
  },
  {
    id: 'flat-geometric',
    name: '平面几何',
    description: '纯色块并置，完全无深度，靠色彩与形状分区',
    tokens: {
      cornerStyle: '小圆角或直角，形状本身承担识别',
      cornerRadius: 4,
      strokeWidth: 0,
      shadow: null,
      typographyContrast: '几何无衬线，靠尺度跳变建立层级',
      texture: '完全平涂，无渐变无纹理',
      depthModel: '不使用任何投影，靠色块边界与留白表达层级',
      motif: '圆形、三角与斜切色块',
      antiPatterns: ['任何投影', '渐变', '拟物质感', '描边装饰'],
    },
  },
  {
    id: 'editorial-serif',
    name: '编辑印刷',
    description: '衬线标题、分隔线、大留白，阅读秩序优先',
    tokens: {
      cornerStyle: '近乎直角，边界由分隔线而非圆角定义',
      cornerRadius: 2,
      strokeWidth: 1,
      shadow: null,
      typographyContrast: '衬线大标题与无衬线正文混排，字号阶梯明确',
      texture: '纸白或米色底，无装饰纹理',
      depthModel: '不使用投影，靠细分隔线与留白分层',
      motif: '细横线、栏线与页码式小字',
      antiPatterns: ['投影', '高饱和大色块', '圆角卡片', '装饰性图形'],
    },
  },
  {
    id: 'luminous-dark',
    name: '深色发光',
    description: '深色底、发光边缘与色晕，强调焦点的光学吸引',
    tokens: {
      cornerStyle: '中等圆角，边缘常带发光描边',
      cornerRadius: 12,
      strokeWidth: 1,
      shadow: { x: 0, y: 0, blur: 40, color: 'rgba(120, 180, 255, 0.35)' },
      typographyContrast: '亮色标题在深底上形成高对比，正文降低亮度',
      texture: '深色底加径向色晕，允许细微星芒',
      depthModel: '外发光与内发光表达层级，不使用向下投影',
      motif: '发光边框与径向渐晕',
      antiPatterns: ['浅色背景', '向下硬投影', '高亮度大面积平涂'],
    },
  },
  {
    id: 'tactile-paper',
    name: '纸质拼贴',
    description: '纸张层叠、轻微旋转、手作剪贴感',
    tokens: {
      cornerStyle: '小圆角配不规则边缘，避免机械精确',
      cornerRadius: 6,
      strokeWidth: 2,
      shadow: { x: 2, y: 4, blur: 8, color: 'rgba(80, 60, 40, 0.24)' },
      typographyContrast: '手写感标题配规整正文，允许轻微倾斜',
      texture: '纸纹、撕边与胶带元素',
      depthModel: '纸张层叠与极轻投影表达堆叠',
      motif: '撕边纸片、胶带与手绘箭头',
      antiPatterns: ['纯数字化光泽', '发光效果', '完全对齐的机械网格'],
    },
  },
]

export type DesignLanguageId = 'auto' | (string & {})

export function findDesignLanguage(id: DesignLanguageId): DesignLanguage | undefined {
  return DESIGN_LANGUAGES.find((language) => language.id === id)
}

/** 六条发散轴共用的幅度语义。 */
export type VisualAxisRange = 'subtle' | 'moderate' | 'extreme'

/** 单条发散轴：direction 为 `keep` 表示该属性不变，此时 range 无意义。 */
export interface VisualAxis {
  direction: string
  range: VisualAxisRange
}

export type VisualAxisKey =
  | 'heroComposition'
  | 'typography'
  | 'componentSurfaces'
  | 'decoration'
  | 'spacingRhythm'
  | 'colorRoles'

export const VISUAL_AXIS_DEFINITIONS: Array<{
  key: VisualAxisKey
  label: string
  directions: string[]
}> = [
  {
    key: 'heroComposition',
    label: '首屏构图',
    directions: ['居中对称', '偏心张力', '全幅沉浸', '分割构图'],
  },
  {
    key: 'typography',
    label: '字体层级',
    directions: ['放大标题反差', '收紧为等级序列', '混排衬线无衬线', '超大字重冲击'],
  },
  {
    key: 'componentSurfaces',
    label: '组件表面',
    directions: ['提升卡片实体感', '融入背景', '强化边界描边', '改为分隔线分区'],
  },
  {
    key: 'decoration',
    label: '装饰语言',
    directions: ['减到最少', '母题重复', '只在区块边界', '有机形态'],
  },
  {
    key: 'spacingRhythm',
    label: '间距节奏',
    directions: ['整体放宽', '整体收紧', '疏密交替', '模块化栅格'],
  },
  {
    key: 'colorRoles',
    label: '颜色角色',
    directions: ['加深对比', '收窄色域', '迁移强调色', '反转明暗基调'],
  },
]

export const VISUAL_AXIS_RANGE_LABELS: Record<VisualAxisRange, string> = {
  subtle: '轻微',
  moderate: '适度',
  extreme: '强烈',
}

export interface VisualRedesignBrief {
  concept: string
  targetAudience: string
  primaryGoal: string
  pageType: 'auto' | 'campaign' | 'content' | 'dashboard'
  density: 'airy' | 'balanced' | 'rich'
  /**
   * 全局探索幅度。分轴 `axes` 落地后它只作为未指定轴的兜底和旧模板迁移来源，
   * 不再单独编译进 prompt。
   */
  exploration: 'conservative' | 'balanced' | 'bold'
  /** 设计语言 id，`auto` 表示不注入材质约束，由模型按页面类型判断。 */
  designLanguage: DesignLanguageId
  /** 六条发散轴。缺失时由 `normalizeVisualRedesignBrief` 从 exploration 推导。 */
  axes: Record<VisualAxisKey, VisualAxis>
  imagery: 'auto' | 'none' | 'hero' | 'hero-and-content'
  componentSurface: 'quiet' | 'tonal' | 'contrast'
  layoutRhythm: 'continuous' | 'sectioned' | 'editorial'
  preserve: {
    content: boolean
    informationArchitecture: boolean
    palette: boolean
    brandAssets: boolean
    keyJourney: boolean
  }
  paletteRoles: {
    background: string
    surface: string
    text: string
    mutedText: string
    accent: string
  }
  signaturePlacement: 'auto' | 'hero' | 'header'
  signatureDescription: string
  antiPatterns: string[]
}

/**
 * 视觉优化阶段的可执行资产契约。该契约与 Prompt 解耦，供 Runtime/Renderer
 * 共同校验图片数量、角色和目标尺寸，避免把整张长画板误当成 Hero 图片。
 */
export interface VisualAssetPlanItem {
  id: string
  role: 'page-shell' | 'hero' | 'content-image'
  targetSize: { width: number; height: number }
  placement: 'background' | 'inline'
  slotRequired: boolean
  allowText: boolean
  allowButtons: boolean
}

export interface VisualAssetPlan {
  version: 1
  imagery: VisualRedesignBrief['imagery']
  items: VisualAssetPlanItem[]
}

/** 根据视觉 Brief 生成稳定、可验证的素材计划。 */
export function buildVisualAssetPlan(
  brief: VisualRedesignBrief,
  artboard: Pick<Artboard, 'width' | 'height'>,
): VisualAssetPlan {
  const imagery = brief.imagery ?? 'auto'
  if (imagery === 'none') return { version: 1, imagery, items: [] }
  const width = Math.max(1, Math.round(artboard.width))
  // Hero 只占首屏视觉区域，不能默认使用整张长画板高度。
  const heroHeight = Math.min(Math.max(480, Math.round(width * 1.6)), Math.round(artboard.height * 0.32))
  const items: VisualAssetPlanItem[] = [
    {
      id: 'hero',
      role: 'hero',
      targetSize: { width, height: Math.max(320, heroHeight) },
      placement: 'background',
      slotRequired: true,
      allowText: false,
      allowButtons: false,
    },
  ]
  if (imagery === 'hero-and-content') {
    for (let index = 1; index <= 2; index += 1) {
      items.push({
        id: `content-image-${index}`,
        role: 'content-image',
        targetSize: { width: Math.min(320, width - 32), height: 180 },
        placement: 'inline',
        slotRequired: true,
        allowText: false,
        allowButtons: false,
      })
    }
  }
  return { version: 1, imagery, items }
}

/** 默认轴取值：全部适度改动，方向交给模型按页面语义选择。 */
export const DEFAULT_VISUAL_AXES: Record<VisualAxisKey, VisualAxis> = {
  heroComposition: { direction: 'auto', range: 'moderate' },
  typography: { direction: 'auto', range: 'moderate' },
  componentSurfaces: { direction: 'auto', range: 'moderate' },
  decoration: { direction: 'auto', range: 'moderate' },
  spacingRhythm: { direction: 'auto', range: 'moderate' },
  colorRoles: { direction: 'auto', range: 'moderate' },
}

export const DEFAULT_VISUAL_REDESIGN_BRIEF: VisualRedesignBrief = {
  concept: '强化当前主题的视觉冲击力与品牌辨识度',
  targetAudience: '',
  primaryGoal: '',
  pageType: 'auto',
  density: 'balanced',
  exploration: 'balanced',
  designLanguage: 'auto',
  axes: DEFAULT_VISUAL_AXES,
  imagery: 'auto',
  componentSurface: 'quiet',
  layoutRhythm: 'continuous',
  preserve: {
    content: true,
    informationArchitecture: true,
    palette: true,
    brandAssets: true,
    keyJourney: true,
  },
  paletteRoles: {
    background: '',
    surface: '',
    text: '',
    mutedText: '',
    accent: '',
  },
  signaturePlacement: 'auto',
  signatureDescription: '首屏标题与主视觉形成全页唯一视觉焦点',
  // 只保留与设计语言无关的禁止项。材质类禁止项（如"模糊投影"）由设计语言包提供，
  // 写在这里会和柔性层叠、深色发光这类语言直接冲突。
  antiPatterns: ['模板化卡片', '标题孤字换行', '所有区域同等高饱和'],
}

/**
 * 内置模板。每个模板必须绑定不同的设计语言并给出分轴方向，
 * 只改枚举值的模板会产出同一套视觉——这正是单调的来源。
 */
export const BUILTIN_VISUAL_BRIEF_TEMPLATES = [
  {
    id: 'builtin-campaign',
    name: '品牌活动 H5',
    patch: {
      pageType: 'campaign',
      concept: '品牌鲜明、首屏聚焦转化的沉浸式活动页面',
      designLanguage: 'neo-brutalist',
      componentSurface: 'tonal',
      layoutRhythm: 'continuous',
      axes: {
        heroComposition: { direction: '全幅沉浸', range: 'extreme' },
        typography: { direction: '超大字重冲击', range: 'extreme' },
        componentSurfaces: { direction: '强化边界描边', range: 'moderate' },
        decoration: { direction: '母题重复', range: 'moderate' },
        spacingRhythm: { direction: '疏密交替', range: 'moderate' },
        colorRoles: { direction: '加深对比', range: 'moderate' },
      },
    },
  },
  {
    id: 'builtin-content',
    name: '内容专题页',
    patch: {
      pageType: 'content',
      concept: '编辑式内容专题，突出阅读秩序和信息层级',
      designLanguage: 'editorial-serif',
      componentSurface: 'quiet',
      layoutRhythm: 'editorial',
      axes: {
        heroComposition: { direction: '分割构图', range: 'moderate' },
        typography: { direction: '混排衬线无衬线', range: 'extreme' },
        componentSurfaces: { direction: '改为分隔线分区', range: 'extreme' },
        decoration: { direction: '减到最少', range: 'extreme' },
        spacingRhythm: { direction: '整体放宽', range: 'moderate' },
        colorRoles: { direction: '收窄色域', range: 'moderate' },
      },
    },
  },
  {
    id: 'builtin-dashboard',
    name: '数据后台',
    patch: {
      pageType: 'dashboard',
      concept: '高效、清晰、易扫描的数据工作台',
      density: 'rich',
      designLanguage: 'flat-geometric',
      componentSurface: 'contrast',
      layoutRhythm: 'sectioned',
      axes: {
        heroComposition: { direction: 'keep', range: 'subtle' },
        typography: { direction: '收紧为等级序列', range: 'moderate' },
        componentSurfaces: { direction: '强化边界描边', range: 'moderate' },
        decoration: { direction: '减到最少', range: 'extreme' },
        spacingRhythm: { direction: '模块化栅格', range: 'extreme' },
        colorRoles: { direction: '加深对比', range: 'subtle' },
      },
    },
  },
  {
    id: 'builtin-dark',
    name: '深色沉浸页面',
    patch: {
      pageType: 'campaign',
      concept: '深色沉浸氛围与单一高识别视觉焦点',
      designLanguage: 'luminous-dark',
      componentSurface: 'tonal',
      layoutRhythm: 'continuous',
      axes: {
        heroComposition: { direction: '偏心张力', range: 'extreme' },
        typography: { direction: '放大标题反差', range: 'moderate' },
        componentSurfaces: { direction: '融入背景', range: 'extreme' },
        decoration: { direction: '有机形态', range: 'moderate' },
        spacingRhythm: { direction: '整体放宽', range: 'moderate' },
        colorRoles: { direction: '反转明暗基调', range: 'extreme' },
      },
    },
  },
  {
    id: 'builtin-soft',
    name: '柔性产品页',
    patch: {
      pageType: 'content',
      concept: '柔和可触摸的层次感，弱化边界强调呼吸',
      designLanguage: 'soft-depth',
      componentSurface: 'quiet',
      layoutRhythm: 'sectioned',
      axes: {
        heroComposition: { direction: '居中对称', range: 'subtle' },
        typography: { direction: '收紧为等级序列', range: 'moderate' },
        componentSurfaces: { direction: '提升卡片实体感', range: 'extreme' },
        decoration: { direction: '只在区块边界', range: 'subtle' },
        spacingRhythm: { direction: '整体放宽', range: 'extreme' },
        colorRoles: { direction: '收窄色域', range: 'moderate' },
      },
    },
  },
  {
    id: 'builtin-paper',
    name: '手作拼贴页',
    patch: {
      pageType: 'campaign',
      concept: '纸质剪贴与手作痕迹，弱化数字精确感',
      designLanguage: 'tactile-paper',
      componentSurface: 'contrast',
      layoutRhythm: 'editorial',
      axes: {
        heroComposition: { direction: '分割构图', range: 'extreme' },
        typography: { direction: '混排衬线无衬线', range: 'moderate' },
        componentSurfaces: { direction: '提升卡片实体感', range: 'moderate' },
        decoration: { direction: '有机形态', range: 'extreme' },
        spacingRhythm: { direction: '疏密交替', range: 'extreme' },
        colorRoles: { direction: '迁移强调色', range: 'moderate' },
      },
    },
  },
] satisfies Array<{ id: string; name: string; patch: Partial<VisualRedesignBrief> }>

/**
 * 补齐旧 Brief 缺失的字段。
 *
 * 旧模板存在 `exploration` 与布尔 `change`，没有 `axes`/`designLanguage`。
 * 从旧字段推导：`change.x === false` → 该轴 `keep`；exploration 档位 → range。
 * 项目 settings 里保存的用户模板会走这条路径。
 */
export function normalizeVisualRedesignBrief(brief: VisualRedesignBrief): VisualRedesignBrief {
  const legacy = brief as VisualRedesignBrief & {
    change?: Partial<Record<VisualAxisKey, boolean>>
  }
  const range: VisualAxisRange =
    brief.exploration === 'bold'
      ? 'extreme'
      : brief.exploration === 'conservative'
        ? 'subtle'
        : 'moderate'
  const axes = Object.fromEntries(
    VISUAL_AXIS_DEFINITIONS.map(({ key }) => {
      const existing = brief.axes?.[key]
      if (existing?.direction) return [key, existing]
      // 旧 Brief 的 change 开关关闭时语义就是"这条轴不要动"。
      const enabled = legacy.change?.[key]
      return [
        key,
        enabled === false ? { direction: 'keep', range: 'subtle' } : { direction: 'auto', range },
      ]
    }),
  ) as Record<VisualAxisKey, VisualAxis>
  return {
    ...DEFAULT_VISUAL_REDESIGN_BRIEF,
    ...brief,
    designLanguage: brief.designLanguage || 'auto',
    axes,
    paletteRoles: { ...DEFAULT_VISUAL_REDESIGN_BRIEF.paletteRoles, ...brief.paletteRoles },
    preserve: { ...DEFAULT_VISUAL_REDESIGN_BRIEF.preserve, ...brief.preserve },
  }
}

export function summarizeVisualRedesignBrief(brief: VisualRedesignBrief) {
  const axes = normalizeVisualRedesignBrief(brief).axes
  return {
    preserve: [
      brief.preserve.content ? '准确文案与业务内容' : '',
      brief.preserve.informationArchitecture ? '信息架构与模块顺序' : '',
      brief.preserve.palette ? '当前主色关系' : '',
      brief.preserve.brandAssets ? 'Logo、IP 与真实图片' : '',
      brief.preserve.keyJourney ? '主 CTA 与转化路径' : '',
    ].filter(Boolean),
    change: VISUAL_AXIS_DEFINITIONS.filter(({ key }) => axes[key].direction !== 'keep').map(
      ({ key, label }) => {
        const axis = axes[key]
        const rangeLabel = VISUAL_AXIS_RANGE_LABELS[axis.range]
        return axis.direction === 'auto'
          ? `${label}（${rangeLabel}，方向自动）`
          : `${label}（${rangeLabel}，${axis.direction}）`
      },
    ),
  }
}

/** 编译设计语言的材质契约。`auto` 返回空串，让模型自行判断。 */
function compileDesignLanguageContract(brief: VisualRedesignBrief): string {
  const language = findDesignLanguage(brief.designLanguage)
  if (!language) return ''
  const { tokens } = language
  return [
    `设计语言：${language.name}——${language.description}。`,
    `圆角语言：${tokens.cornerStyle}，圆角不超过 ${tokens.cornerRadius}px。`,
    tokens.strokeWidth > 0
      ? `描边不超过 ${tokens.strokeWidth}px。`
      : '不使用描边，边界由色块与留白定义。',
    tokens.shadow
      ? `投影统一为 x=${tokens.shadow.x}、y=${tokens.shadow.y}、blur=${tokens.shadow.blur}，颜色 ${tokens.shadow.color}。`
      : '完全不使用投影。',
    `深度表达：${tokens.depthModel}。`,
    `字体对比：${tokens.typographyContrast}。`,
    `材质纹理：${tokens.texture}。`,
    `图形母题：${tokens.motif}。`,
    `本设计语言禁止：${tokens.antiPatterns.join('、')}。`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** 编译六条发散轴。keep 轴显式声明为不变，避免模型顺手改掉。 */
function compileVisualAxes(brief: VisualRedesignBrief): string {
  const axes = normalizeVisualRedesignBrief(brief).axes
  const rangeInstruction: Record<VisualAxisRange, string> = {
    subtle: '轻微调整，保持与原稿明显同源',
    moderate: '明显不同但仍可识别为同一主题',
    extreme: '允许结论性改变，只受保留项约束',
  }
  const lines = VISUAL_AXIS_DEFINITIONS.map(({ key, label }) => {
    const axis = axes[key]
    if (axis.direction === 'keep') return `- ${label}：保持不变，不要改动。`
    const direction =
      axis.direction === 'auto' ? '方向由页面语义自行判断' : `方向为「${axis.direction}」`
    return `- ${label}：${direction}，幅度${VISUAL_AXIS_RANGE_LABELS[axis.range]}——${rangeInstruction[axis.range]}。`
  })
  return ['逐项视觉变化指令（每条独立生效，不要用同一幅度套用全部）：', ...lines].join('\n')
}

export function compileVisualRedesignPrompt(brief: VisualRedesignBrief, artboard: Artboard) {
  const summary = summarizeVisualRedesignBrief(brief)
  const preserve = summary.preserve
  const change = summary.change
  const pageType = {
    auto: '自动判断；根据现有画板的内容、尺寸和业务语义选择页面类型',
    campaign: '活动/H5 页面；首屏突出主题与转化，后续组件区保持克制',
    content: '内容/产品页面；优先阅读顺序、信息层级与稳定导航',
    dashboard: '后台/数据页面；优先操作效率、扫描性和高密度可读性',
  }[brief.pageType]
  const density = {
    airy: '疏朗，增加留白并减少同时出现的信息',
    balanced: '均衡，保持清晰层级与适中的信息密度',
    rich: '丰富，允许更紧凑的信息组织但不得牺牲可读性',
  }[brief.density]
  const imagery = {
    auto: '根据页面类型自动判断图片需求；品牌活动页优先提供一张 Hero 主视觉',
    none: '不主动生成图片，仅使用已有素材和可编辑结构',
    hero: '至少生成一张 Hero/KV 主视觉，并在页面中保留可编辑图片 Slot',
    'hero-and-content': '生成 Hero/KV 主视觉，并为内容区生成 2～3 张统一风格配图',
  }[brief.imagery ?? 'auto']
  const componentSurface = {
    quiet: '安静表面：低装饰、低对比，以承载业务内容为主',
    tonal: '同色系表面：使用主色的明暗层级区分模块',
    contrast: '对比表面：允许更明确的色块分区，但不得争夺首屏焦点',
  }[brief.componentSurface]
  const layoutRhythm = {
    continuous: '连续叙事：使用背景色阶、留白和轻量过渡串联章节',
    sectioned: '模块分区：使用清晰但统一的区块边界组织内容',
    editorial: '编辑式节奏：通过错落尺度、强弱对比和留白建立阅读韵律',
  }[brief.layoutRhythm]
  const signaturePlacement = {
    auto: '根据页面类型自动选择；活动页默认 Hero，后台默认全局页头',
    hero: 'Hero/首屏区域，后续区域不得重复完整主构图',
    header: '全局页头区域，不侵入内容与数据模块',
  }[brief.signaturePlacement]
  const paletteRoleLabels: Record<keyof VisualRedesignBrief['paletteRoles'], string> = {
    background: '页面背景',
    surface: '组件表面',
    text: '主文字',
    mutedText: '次文字',
    accent: '强调色',
  }
  const explicitPaletteRoles = Object.entries(brief.paletteRoles)
    .map(([role, value]) => {
      const normalized = value.trim()
      return normalized
        ? `${paletteRoleLabels[role as keyof VisualRedesignBrief['paletteRoles']]}=${normalized}`
        : ''
    })
    .filter(Boolean)

  return [
    `参考当前画板“${artboard.name}”，整体重新设计整个页面并生成独立新版，保留原画板。`,
    `视觉概念：${brief.concept.trim() || DEFAULT_VISUAL_REDESIGN_BRIEF.concept}。`,
    brief.targetAudience.trim() ? `目标受众：${brief.targetAudience.trim()}。` : '',
    brief.primaryGoal.trim() ? `页面核心目标：${brief.primaryGoal.trim()}。` : '',
    `页面类型：${pageType}。`,
    `信息密度：${density}。`,
    `图片策略：${imagery}。`,
    compileDesignLanguageContract(brief),
    preserve.length ? `必须保留：${preserve.join('、')}，不得擅自增加虚构业务内容。` : '',
    change.length ? compileVisualAxes(brief) : '',
    `页面视觉焦点：${brief.signatureDescription.trim() || DEFAULT_VISUAL_REDESIGN_BRIEF.signatureDescription}。位置策略：${signaturePlacement}。同一页面只允许一个主视觉焦点，并归属于页面外壳。`,
    `页面段落节奏：${layoutRhythm}。`,
    explicitPaletteRoles.length
      ? `色彩角色：${explicitPaletteRoles.join('、')}。未填写角色从当前画板推导，并校验文字对比度。`
      : '色彩角色：从当前画板提取并明确页面背景、组件表面、主文字、次文字和强调色，禁止主题色等权铺满。',
    '页面外壳负责主构图、跨模块节奏和章节连接；内容区保持克制，业务文字、按钮和卡片必须为可编辑原生节点。',
    `组件表面策略：${componentSurface}。使用统一 Token，不要在每个模块重复首屏构图和高密度装饰。`,
    brief.antiPatterns.length ? `禁止出现：${brief.antiPatterns.join('、')}。` : '',
    `输出尺寸沿用当前画板 ${Math.round(artboard.width)}×${Math.round(artboard.height)}，内容高度可以自然延展。`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** 将无原稿时的 Brief 编译为新建设计稿的生成约束。 */
export function compileVisualDirectionPrompt(brief: VisualRedesignBrief) {
  const pageType = {
    auto: '根据需求自动判断页面类型',
    campaign: '活动/H5 页面，首屏突出主题与转化，后续区域保持克制',
    content: '内容/产品页面，优先阅读顺序、信息层级与稳定导航',
    dashboard: '后台/数据页面，优先操作效率、扫描性和高密度可读性',
  }[brief.pageType]
  const density = {
    airy: '疏朗，增加留白并减少同时出现的信息',
    balanced: '均衡，保持清晰层级与适中的信息密度',
    rich: '丰富，允许更紧凑的信息组织但不得牺牲可读性',
  }[brief.density]
  const imagery = {
    auto: '根据页面类型自动判断；活动/H5 和品牌页默认至少生成一张 Hero 主视觉',
    none: '不主动生成图片，仅使用已有素材和可编辑结构',
    hero: '至少生成一张 Hero/KV 主视觉，并创建对应的可编辑图片 Slot',
    'hero-and-content': '生成 Hero/KV 主视觉，并为内容区生成 2～3 张统一风格配图',
  }[brief.imagery ?? 'auto']
  const surface = {
    quiet: '安静表面，低装饰、低对比，以承载内容为主',
    tonal: '同色系表面，用主色的明暗层级区分模块',
    contrast: '对比表面，允许明确色块分区但不得争夺首屏焦点',
  }[brief.componentSurface]
  const rhythm = {
    continuous: '连续叙事，用背景色阶、留白和轻量过渡串联章节',
    sectioned: '模块分区，用清晰但统一的区块边界组织内容',
    editorial: '编辑式节奏，通过错落尺度、强弱对比和留白建立韵律',
  }[brief.layoutRhythm]
  const palette = Object.entries(brief.paletteRoles)
    .filter(([, value]) => value.trim())
    .map(([role, value]) => `${role}=${value.trim()}`)
  return [
    `从零生成一套页面设计。视觉概念：${brief.concept.trim() || DEFAULT_VISUAL_REDESIGN_BRIEF.concept}。`,
    brief.targetAudience.trim() ? `目标受众：${brief.targetAudience.trim()}。` : '',
    brief.primaryGoal.trim() ? `页面核心目标：${brief.primaryGoal.trim()}。` : '',
    `页面类型：${pageType}。信息密度：${density}。`,
    `图片策略：${imagery}。`,
    `组件表面：${surface}。页面段落节奏：${rhythm}。`,
    palette.length
      ? `色彩角色（仅使用这些角色）：${palette.join('、')}。`
      : '从需求推导并明确背景、表面、主文字、次文字和强调色五种色彩角色。',
    `主视觉焦点：${brief.signatureDescription.trim() || DEFAULT_VISUAL_REDESIGN_BRIEF.signatureDescription}。全页只允许一个主视觉焦点。`,
    // 材质 Token 来自选中的设计语言。此处不再写死单一审美——写死会让所有
    // 模板产出同一套视觉，这正是"视觉优化很单调"的根因。
    compileDesignLanguageContract(brief),
    compileVisualAxes(brief),
    '视觉 Token 必须在全页内部保持统一，同类元素使用同一组圆角、描边和深度参数。',
    '所有标题、正文、按钮和卡片必须是可编辑原生节点；不要套用通用营销页模板，不要让每个模块重复首屏主构图。',
    brief.antiPatterns.length ? `禁止出现：${brief.antiPatterns.join('、')}。` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Style Pack 声明的表面覆盖。Style Pack 是品牌事实，优先于设计语言的审美选择。 */
export interface NormalizationOverrides {
  cornerRadius?: number
  strokeWidth?: number
}

/**
 * 统一画板内部的材质 Token。
 *
 * 职责是"保证同一设计语言内部一致"，不是"规定用哪种语言"。所以基准来自传入的
 * 设计语言；不传时回落到新粗野，保持旧行为。Style Pack 的 `surfaces.radius`
 * 通过 overrides 传入并优先——此前这里的常量 8 会把 Style Pack 声明的 12 压掉。
 */
export function buildVisualNormalizationPatches(
  document: DesignDocument,
  artboardId: string,
  languageId: DesignLanguageId = 'neo-brutalist',
  overrides: NormalizationOverrides = {},
) {
  const language = findDesignLanguage(languageId) ?? findDesignLanguage('neo-brutalist')
  if (!language) return []
  const tokens = language.tokens
  const cornerRadius = overrides.cornerRadius ?? tokens.cornerRadius
  const strokeWidth = overrides.strokeWidth ?? tokens.strokeWidth
  const patches: Array<{ id: string; patch: Partial<DesignElement> }> = []
  for (const element of document.elements) {
    if (
      element.artboardId !== artboardId ||
      element.locked ||
      element.componentBinding ||
      element.designRole === 'page-shell'
    )
      continue

    const patch: Record<string, unknown> = {}
    if (element.shadow) {
      if (!tokens.shadow) {
        // 该设计语言不使用投影：移除而不是改写，否则平面几何与编辑印刷
        // 会被塞进一个它们本不该有的投影。
        patch.shadow = undefined
      } else if (
        element.shadow.x !== tokens.shadow.x ||
        element.shadow.y !== tokens.shadow.y ||
        element.shadow.blur !== tokens.shadow.blur
      ) {
        patch.shadow = {
          x: tokens.shadow.x,
          y: tokens.shadow.y,
          blur: tokens.shadow.blur,
          color: resolveShadowColor(element.shadow.color, tokens.shadow.color),
        }
      }
    }
    if (element.type === 'shape') {
      if ((element.strokeWidth ?? 0) > strokeWidth) patch.strokeWidth = strokeWidth
      if ((element.borderRadius ?? 0) > cornerRadius) patch.borderRadius = cornerRadius
    }
    if (element.type === 'image' && (element.borderRadius ?? 0) > cornerRadius) {
      patch.borderRadius = cornerRadius
    }
    if (element.type === 'button' && (element.style.borderRadius ?? 0) > cornerRadius) {
      patch.style = { ...element.style, borderRadius: cornerRadius }
    }
    if (Object.keys(patch).length) {
      patches.push({ id: element.id, patch: patch as Partial<DesignElement> })
    }
  }
  return patches
}

/** 保留元素自带的有意义颜色，只在它是默认纯黑时换成语言基准色。 */
function resolveShadowColor(color: string, fallback: string) {
  if (!color || /rgba?\(\s*0\s*,\s*0\s*,\s*0/i.test(color)) return fallback
  return color
}
