const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function compilePageVisualDirection(input = {}) {
  const goal = cleanText(input.goal, '完整页面设计')
  const theme = input.visualTheme && typeof input.visualTheme === 'object'
    ? input.visualTheme
    : {}
  const colors = uniqueColors([
    ...(Array.isArray(theme.colors) ? theme.colors : []),
    ...(Array.isArray(theme.colorTokens) ? theme.colorTokens.map((token) => token?.value) : []),
  ])
  const background = tokenColor(theme, 'background') ?? colors[0] ?? '#121212'
  const accent = tokenColor(theme, 'accent') ?? colors[1] ?? '#f3c847'
  const requestedText = tokenColor(theme, 'text')
  const text = requestedText && contrastRatio(requestedText, background) >= 4.5
    ? requestedText
    : bestTextColor(background)
  const mutedText = tokenColor(theme, 'muted-text') ?? mixHex(text, background, 0.34)
  const surface = tokenColor(theme, 'surface') ?? mixHex(background, text, 0.1)
  const componentNames = Array.isArray(input.componentNames)
    ? input.componentNames.map((name) => cleanText(name, '')).filter(Boolean)
    : []
  const pageKind = inferPageKind([goal, ...componentNames].join(' '))
  const componentCount = positiveInteger(input.componentCount, 1)
  const density = inferDensity(pageKind, componentCount)
  const signaturePlacement = pageKind === 'dashboard' ? 'header' : 'hero'
  const language = cleanText(theme.visualStyle || theme.style || theme.description, '延续参考主题的色彩、材质和明暗关系')

  return {
    version: 2,
    concept: `${pageKindLabel(pageKind)}；${language}`,
    pageKind,
    palette: { background, surface, text, mutedText, accent },
    signature: {
      owner: 'page-shell',
      placement: signaturePlacement,
      description: pageKind === 'dashboard'
        ? '在全局导航或页头建立唯一品牌识别，不侵入数据模块。'
        : '在首屏建立唯一主视觉焦点，后续章节只延续颜色和材质。',
    },
    density: {
      pageShell: density,
      componentSurface: 'quiet',
    },
    regions: pageKind === 'dashboard'
      ? [
          { range: '0-12%', density: 'medium', role: 'global-header' },
          { range: '12-100%', density: 'low', role: 'content-bed' },
        ]
      : [
          { range: '0-22%', density: 'high', role: 'signature' },
          { range: '22-85%', density: 'low', role: 'content-bed' },
          { range: '85-100%', density: 'medium', role: 'footer-transition' },
        ],
    surfaceTreatment: {
      mode: 'tonal-card',
      opacity: 0.88,
      borderOpacity: 0.26,
      highlightOpacity: 0.12,
    },
    pageShellRules: [
      '拥有整页底色、唯一主视觉焦点、跨模块连接和章节节奏。',
      '主视觉构图只出现一次；后续区域通过留白、色阶和轻量过渡延续。',
      '禁止绘制组件卡片、按钮、列表、精确文字、业务图片和占位 UI。',
    ],
    embeddedComponentRules: [
      '使用高覆盖率、低对比的 Tonal Surface 承载 Runtime 节点，必须与页面背景形成明确边界。',
      '只允许轻微边界、局部色阶和可读性遮罩，不允许页面高密度纹理透入内容区。',
      '不得重复页面主放射、主图形、全幅纹理或高饱和光效。',
      '业务文字、按钮、列表和 Props 图片由可编辑节点负责。',
    ],
    antiPatterns: [
      '页面外壳与组件背景使用同一完整构图',
      '每个组件重复一次 KV 主视觉',
      '所有主题色等权大面积铺满',
      '装饰覆盖文字或降低组件内容对比度',
      '用整张组件截图替代可编辑节点',
    ],
  }
}

function inferPageKind(goal) {
  if (/(?:后台|dashboard|管理系统|工作台|数据台)/iu.test(goal)) return 'dashboard'
  if (/(?:app|应用|移动端)/iu.test(goal)) return 'app'
  if (/(?:活动|抽奖|任务|campaign|promotion|lottery|task(?:list)?|h5|kv)/iu.test(goal)) return 'campaign'
  return 'general'
}

function inferDensity(pageKind, componentCount) {
  if (pageKind === 'dashboard') return componentCount > 5 ? 'high' : 'medium'
  if (componentCount > 4) return 'medium'
  return 'low'
}

function pageKindLabel(pageKind) {
  if (pageKind === 'dashboard') return '结构清晰、信息密度适中的后台产品界面'
  if (pageKind === 'campaign') return '主视觉明确、组件层级克制的活动页面'
  if (pageKind === 'app') return '移动优先、层级清晰的应用页面'
  return '内容优先、层级明确的完整页面'
}

function tokenColor(theme, role) {
  const token = Array.isArray(theme.colorTokens)
    ? theme.colorTokens.find((item) => String(item?.role || '').toLowerCase() === role)
    : undefined
  return normalizeColor(token?.value)
}

function uniqueColors(values) {
  return Array.from(new Set(values.map(normalizeColor).filter(Boolean)))
}

function normalizeColor(value) {
  if (typeof value !== 'string') return undefined
  const color = value.trim()
  return HEX_COLOR.test(color) ? color.toLowerCase() : undefined
}

function bestTextColor(background) {
  const rgb = parseHex(background)
  const luminance = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000
  return luminance > 150 ? '#181818' : '#ffffff'
}

function contrastRatio(left, right) {
  const leftLuminance = relativeLuminance(parseHex(left))
  const rightLuminance = relativeLuminance(parseHex(right))
  const lighter = Math.max(leftLuminance, rightLuminance)
  const darker = Math.min(leftLuminance, rightLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(rgb) {
  const channel = (value) => {
    const normalized = value / 255
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return channel(rgb.r) * 0.2126 + channel(rgb.g) * 0.7152 + channel(rgb.b) * 0.0722
}

function mixHex(left, right, ratio) {
  const a = parseHex(left)
  const b = parseHex(right)
  const mix = (key) => Math.round(a[key] * (1 - ratio) + b[key] * ratio)
  return `#${[mix('r'), mix('g'), mix('b')].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function parseHex(value) {
  const color = normalizeColor(value) ?? '#000000'
  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16),
  }
}

function cleanText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function positiveInteger(value, fallback) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : fallback
}
