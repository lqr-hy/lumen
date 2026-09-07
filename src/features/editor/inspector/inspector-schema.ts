import type {
  Artboard,
  CornerValues,
  DesignElement,
  EdgeValues,
  ElementLayoutSizing,
  SectionElement,
} from '../types'
import {
  DEFAULT_EDGE_VALUES,
  resolveCornerRadii,
  resolveLayoutSizing,
} from '../utils/design-properties'

export type InspectorFieldValue =
  string | number | boolean | EdgeValues | CornerValues | ElementLayoutSizing | undefined

export interface InspectorOption {
  label: string
  value: string
  disabled?: boolean
}

export interface InspectorImageUpload {
  name: string
  src: string
  mimeType: string
  bytes: number
}

export interface InspectorField {
  id: string
  label: string
  type:
    | 'text'
    | 'textarea'
    | 'number'
    | 'color'
    | 'select'
    | 'segmented'
    | 'toggle'
    | 'readonly'
    | 'image'
    | 'edges'
    | 'corners'
    | 'alignment-grid'
    | 'size-limits'
  value: InspectorFieldValue
  mixed?: boolean
  min?: number
  max?: number
  step?: number
  unit?: 'px' | '%' | 'deg'
  rows?: number
  options?: InspectorOption[]
  readOnly?: boolean
  resettable?: boolean
  defaultValue?: InspectorFieldValue
  transactional?: boolean
  onChange?: (value: InspectorFieldValue) => void
  onImageUpload?: (image: InspectorImageUpload) => void
}

export interface InspectorSectionSchema {
  id: string
  title: string
  fields: InspectorField[]
  columns?: 1 | 2 | 4
  defaultOpen?: boolean
}

interface ElementResolverContext {
  update: (patch: Partial<DesignElement>) => void
  setAutoLayout: (autoLayout: SectionElement['autoLayout']) => void
  replaceImage?: (image: InspectorImageUpload) => void
  parent?: DesignElement
  responsive?: boolean
}

const alignmentOptions: InspectorOption[] = [
  { label: '左', value: 'left' },
  { label: '中', value: 'center' },
  { label: '右', value: 'right' },
]

export function resolveArtboardInspectorSchema(
  artboard: Artboard,
  update: (patch: Partial<Artboard>) => void,
): InspectorSectionSchema[] {
  return [
    {
      id: 'layout',
      title: '布局',
      columns: 2,
      fields: [
        numberField('x', 'X', artboard.x, (x) => update({ x })),
        numberField('y', 'Y', artboard.y, (y) => update({ y })),
        numberField('width', '宽', artboard.width, (width) => update({ width }), { min: 1 }),
        numberField('height', '高', artboard.height, (height) => update({ height }), { min: 1 }),
      ],
    },
    {
      id: 'appearance',
      title: '外观',
      fields: [
        colorField('background', '背景', artboard.background, (background) =>
          update({ background }),
        ),
        numberField(
          'radius',
          '圆角',
          artboard.borderRadius ?? 0,
          (borderRadius) => update({ borderRadius }),
          { min: 0 },
        ),
        {
          id: 'overflow',
          label: '溢出',
          type: 'segmented',
          value: artboard.overflow ?? 'hidden',
          options: [
            { label: '显示', value: 'visible' },
            { label: '裁剪', value: 'hidden' },
          ],
          onChange: (value) => update({ overflow: String(value) as Artboard['overflow'] }),
        },
        {
          id: 'autoHeight',
          label: '自动高度',
          type: 'toggle',
          value: artboard.autoHeight === true,
          onChange: (value) => update({ autoHeight: Boolean(value) }),
        },
      ],
    },
  ]
}

export function resolveElementInspectorSchema(
  element: DesignElement,
  context: ElementResolverContext,
): InspectorSectionSchema[] {
  const { update } = context
  const sizing = resolveLayoutSizing(element)
  const autoLayoutParent = context.parent?.type === 'section' && Boolean(context.parent.autoLayout)
  const absoluteChild = Boolean(context.parent) && !autoLayoutParent && context.responsive === true
  const supportsHug =
    element.type === 'text' || element.type === 'button' || element.type === 'section'
  const sections: InspectorSectionSchema[] = [
    {
      id: 'layout',
      title: '布局',
      columns: 2,
      fields: [
        ...(!autoLayoutParent
          ? [
              numberField('x', 'X', element.x, (x) => update({ x })),
              numberField('y', 'Y', element.y, (y) => update({ y })),
            ]
          : []),
        {
          ...numberField('width', '宽', element.width, (width) => update({ width }), { min: 1 }),
          readOnly: sizing.widthMode !== 'fixed',
        },
        {
          ...numberField('height', '高', element.height, (height) => update({ height }), {
            min: 1,
          }),
          readOnly: sizing.heightMode !== 'fixed',
        },
        {
          id: 'widthMode',
          label: '宽度模式',
          type: 'segmented',
          value: sizing.widthMode,
          options: sizeModeOptions({ supportsHug, supportsFill: autoLayoutParent }),
          onChange: (widthMode) => {
            const nextMode = String(widthMode) as typeof sizing.widthMode
            update({
              layoutSizing: {
                ...sizing,
                widthMode: nextMode,
                ...(nextMode === 'fixed' ? { minWidth: undefined, maxWidth: undefined } : {}),
              },
            })
          },
        },
        {
          id: 'heightMode',
          label: '高度模式',
          type: 'segmented',
          value: sizing.heightMode,
          options: sizeModeOptions({ supportsHug, supportsFill: autoLayoutParent }),
          onChange: (heightMode) => {
            const nextMode = String(heightMode) as typeof sizing.heightMode
            update({
              layoutSizing: {
                ...sizing,
                heightMode: nextMode,
                ...(nextMode === 'fixed' ? { minHeight: undefined, maxHeight: undefined } : {}),
              },
            })
          },
        },
        numberField('rotation', '旋转', element.rotation ?? 0, (rotation) => update({ rotation }), {
          unit: 'deg',
        }),
        ...(absoluteChild
          ? [
              {
                id: 'constraints',
                label: '水平锚点',
                type: 'segmented' as const,
                value: element.layoutConstraints?.horizontal ?? 'left',
                options: [
                  { label: '左', value: 'left' },
                  { label: '中', value: 'center' },
                  { label: '右', value: 'right' },
                  { label: '左右固定', value: 'stretch' },
                ],
                onChange: (horizontal: InspectorFieldValue) =>
                  update({
                    layoutConstraints: {
                      horizontal: String(horizontal) as NonNullable<
                        DesignElement['layoutConstraints']
                      >['horizontal'],
                      vertical: element.layoutConstraints?.vertical ?? 'top',
                    },
                  }),
              },
              {
                id: 'verticalConstraints',
                label: '垂直锚点',
                type: 'segmented' as const,
                value: element.layoutConstraints?.vertical ?? 'top',
                options: [
                  { label: '上', value: 'top' },
                  { label: '中', value: 'center' },
                  { label: '下', value: 'bottom' },
                  { label: '上下固定', value: 'stretch' },
                ],
                onChange: (vertical: InspectorFieldValue) =>
                  update({
                    layoutConstraints: {
                      horizontal: element.layoutConstraints?.horizontal ?? 'left',
                      vertical: String(vertical) as NonNullable<
                        DesignElement['layoutConstraints']
                      >['vertical'],
                    },
                  }),
              },
            ]
          : []),
      ],
    },
    {
      id: 'appearance',
      title: '外观',
      fields: [
        {
          ...numberField(
            'opacity',
            '透明度',
            Math.round((element.opacity ?? 1) * 100),
            (value) => update({ opacity: value / 100 }),
            {
              min: 0,
              max: 100,
              unit: '%',
            },
          ),
          resettable: true,
          defaultValue: 100,
        },
        {
          id: 'clip',
          label: '裁剪内容',
          type: 'toggle',
          value: element.clipContent === true,
          onChange: (value) => update({ clipContent: Boolean(value) }),
        },
        {
          id: 'shadow',
          label: '阴影',
          type: 'toggle',
          value: Boolean(element.shadow),
          onChange: (value) =>
            update({
              shadow: value ? { x: 0, y: 8, blur: 24, color: 'rgba(0,0,0,0.22)' } : undefined,
            }),
        },
        ...(element.shadow
          ? [
              numberField('shadowX', '阴影 X', element.shadow.x, (x) =>
                update({ shadow: { ...element.shadow!, x } }),
              ),
              numberField('shadowY', '阴影 Y', element.shadow.y, (y) =>
                update({ shadow: { ...element.shadow!, y } }),
              ),
              numberField(
                'shadowBlur',
                '模糊',
                element.shadow.blur,
                (blur) => update({ shadow: { ...element.shadow!, blur } }),
                { min: 0 },
              ),
              colorField('shadowColor', '阴影颜色', element.shadow.color, (color) =>
                update({ shadow: { ...element.shadow!, color } }),
              ),
            ]
          : []),
      ],
    },
  ]

  if (
    context.responsive === true &&
    (sizing.widthMode !== 'fixed' || sizing.heightMode !== 'fixed')
  ) {
    sections.splice(1, 0, {
      id: 'size-constraints',
      title: '高级尺寸',
      defaultOpen:
        sizing.minWidth !== undefined ||
        sizing.maxWidth !== undefined ||
        sizing.minHeight !== undefined ||
        sizing.maxHeight !== undefined,
      fields: [
        {
          id: 'sizeLimits',
          label: '尺寸限制',
          type: 'size-limits',
          value: sizing,
          onChange: (next) => update({ layoutSizing: next as ElementLayoutSizing }),
        },
      ],
    })
  }

  const typeSection = resolveTypeSection(element, context)
  if (typeSection) sections.splice(1, 0, typeSection)
  return sections
}

export function resolveMultiSelectionSchema(
  elements: DesignElement[],
  update: (patch: Partial<DesignElement>) => void,
): InspectorSectionSchema[] {
  const value = <K extends keyof DesignElement>(key: K) => {
    const first = elements[0]?.[key]
    return {
      value: first as InspectorFieldValue,
      mixed: elements.some((element) => element[key] !== first),
    }
  }
  const x = value('x')
  const y = value('y')
  const width = value('width')
  const height = value('height')
  const opacity = elements.map((element) => element.opacity ?? 1)
  const visible = elements.map((element) => element.visible !== false)
  const locked = elements.map((element) => element.locked === true)

  return [
    {
      id: 'layout',
      title: '布局',
      columns: 2,
      fields: [
        {
          ...numberField('x', 'X', Number(x.value), (next) => update({ x: next })),
          mixed: x.mixed,
        },
        {
          ...numberField('y', 'Y', Number(y.value), (next) => update({ y: next })),
          mixed: y.mixed,
        },
        {
          ...numberField('width', '宽', Number(width.value), (next) => update({ width: next }), {
            min: 1,
          }),
          mixed: width.mixed,
        },
        {
          ...numberField('height', '高', Number(height.value), (next) => update({ height: next }), {
            min: 1,
          }),
          mixed: height.mixed,
        },
      ],
    },
    {
      id: 'appearance',
      title: '批量属性',
      fields: [
        {
          ...numberField(
            'opacity',
            '透明度',
            Math.round(opacity[0] * 100),
            (next) => update({ opacity: next / 100 }),
            { min: 0, max: 100, unit: '%' },
          ),
          mixed: opacity.some((item) => item !== opacity[0]),
        },
        {
          id: 'visible',
          label: '显示',
          type: 'toggle',
          value: visible[0],
          mixed: visible.some((item) => item !== visible[0]),
          onChange: (next) => update({ visible: Boolean(next) }),
        },
        {
          id: 'locked',
          label: '锁定',
          type: 'toggle',
          value: locked[0],
          mixed: locked.some((item) => item !== locked[0]),
          onChange: (next) => update({ locked: Boolean(next) }),
        },
      ],
    },
  ]
}

function resolveTypeSection(
  element: DesignElement,
  context: ElementResolverContext,
): InspectorSectionSchema | undefined {
  const { update, setAutoLayout } = context
  if (element.type === 'text') {
    return {
      id: 'typography',
      title: '文本',
      fields: [
        {
          id: 'content',
          label: '内容',
          type: 'textarea',
          value: element.content,
          rows: 4,
          onChange: (content) => update({ content: String(content) } as Partial<DesignElement>),
        },
        numberField(
          'fontSize',
          '字号',
          element.style.fontSize,
          (fontSize) => update({ style: { ...element.style, fontSize } } as Partial<DesignElement>),
          { min: 1 },
        ),
        numberField(
          'lineHeight',
          '行高',
          element.style.lineHeight ?? Math.round(element.style.fontSize * 1.4),
          (lineHeight) =>
            update({ style: { ...element.style, lineHeight } } as Partial<DesignElement>),
          { min: 1 },
        ),
        colorField('textColor', '颜色', element.style.color, (color) =>
          update({ style: { ...element.style, color } } as Partial<DesignElement>),
        ),
        {
          id: 'align',
          label: '对齐',
          type: 'segmented',
          value: element.style.textAlign ?? 'left',
          options: alignmentOptions,
          onChange: (textAlign) =>
            update({
              style: {
                ...element.style,
                textAlign: String(textAlign) as 'left' | 'center' | 'right',
              },
            } as Partial<DesignElement>),
        },
        {
          id: 'overflow',
          label: '溢出',
          type: 'select',
          value: element.style.overflow ?? 'hidden',
          options: [
            { label: '显示', value: 'visible' },
            { label: '隐藏', value: 'hidden' },
            { label: '省略号', value: 'ellipsis' },
          ],
          onChange: (overflow) =>
            update({
              style: {
                ...element.style,
                overflow: String(overflow) as 'visible' | 'hidden' | 'ellipsis',
              },
            } as Partial<DesignElement>),
        },
      ],
    }
  }
  if (element.type === 'button') {
    return {
      id: 'button',
      title: '按钮',
      fields: [
        {
          id: 'content',
          label: '文案',
          type: 'text',
          value: element.content,
          onChange: (content) => update({ content: String(content) } as Partial<DesignElement>),
        },
        colorField('background', '背景', element.style.background, (background) =>
          update({ style: { ...element.style, background } } as Partial<DesignElement>),
        ),
        colorField('color', '文字', element.style.color, (color) =>
          update({ style: { ...element.style, color } } as Partial<DesignElement>),
        ),
        numberField(
          'fontSize',
          '字号',
          element.style.fontSize,
          (fontSize) => update({ style: { ...element.style, fontSize } } as Partial<DesignElement>),
          { min: 1 },
        ),
        cornerField(element, update),
      ],
    }
  }
  if (element.type === 'input') {
    return {
      id: 'input',
      title: '输入框',
      fields: [
        {
          id: 'content',
          label: '占位文案',
          type: 'text',
          value: element.content,
          onChange: (content) => update({ content: String(content) } as Partial<DesignElement>),
        },
        colorField('background', '背景', element.style.background, (background) =>
          update({ style: { ...element.style, background } } as Partial<DesignElement>),
        ),
        colorField('color', '文字', element.style.color, (color) =>
          update({ style: { ...element.style, color } } as Partial<DesignElement>),
        ),
        colorField('borderColor', '描边', element.style.borderColor ?? '#d1d5db', (borderColor) =>
          update({ style: { ...element.style, borderColor } } as Partial<DesignElement>),
        ),
        numberField(
          'borderWidth',
          '描边宽度',
          element.style.borderWidth ?? 1,
          (borderWidth) =>
            update({ style: { ...element.style, borderWidth } } as Partial<DesignElement>),
          { min: 0 },
        ),
        numberField(
          'fontSize',
          '字号',
          element.style.fontSize,
          (fontSize) => update({ style: { ...element.style, fontSize } } as Partial<DesignElement>),
          { min: 1 },
        ),
        cornerField(element, update),
      ],
    }
  }
  if (element.type === 'shape') {
    return {
      id: 'shape',
      title: '图形',
      fields: [
        colorField('fill', '填充', element.fill, (fill) =>
          update({ fill } as Partial<DesignElement>),
        ),
        colorField('stroke', '描边', element.stroke ?? '#000000', (stroke) =>
          update({ stroke } as Partial<DesignElement>),
        ),
        numberField(
          'strokeWidth',
          '描边宽度',
          element.strokeWidth ?? 0,
          (strokeWidth) => update({ strokeWidth } as Partial<DesignElement>),
          { min: 0 },
        ),
        cornerField(element, update),
      ],
    }
  }
  if (element.type === 'image') {
    return {
      id: 'image',
      title: '图片',
      fields: [
        {
          id: 'preview',
          label: '图像',
          type: 'image',
          value: element.src,
          onChange: (src) => update({ src: String(src) } as Partial<DesignElement>),
          onImageUpload: context.replaceImage,
        },
        {
          id: 'src',
          label: '图片地址',
          type: 'text',
          value: element.src,
          onChange: (src) => update({ src: String(src) } as Partial<DesignElement>),
        },
        {
          id: 'fit',
          label: '裁剪模式',
          type: 'segmented',
          value: element.objectFit ?? 'cover',
          options: [
            { label: '填满', value: 'cover' },
            { label: '完整', value: 'contain' },
            { label: '拉伸', value: 'fill' },
          ],
          onChange: (objectFit) =>
            update({
              objectFit: String(objectFit) as 'cover' | 'contain' | 'fill',
            } as Partial<DesignElement>),
        },
        {
          id: 'position',
          label: '焦点',
          type: 'select',
          value: element.objectPosition ?? '50% 50%',
          options: [
            { label: '居中', value: '50% 50%' },
            { label: '顶部', value: '50% 0%' },
            { label: '底部', value: '50% 100%' },
            { label: '左侧', value: '0% 50%' },
            { label: '右侧', value: '100% 50%' },
          ],
          onChange: (objectPosition) =>
            update({ objectPosition: String(objectPosition) } as Partial<DesignElement>),
        },
        cornerField(element, update),
      ],
    }
  }
  if (element.type === 'section') {
    const autoLayout = element.autoLayout
    return {
      id: 'auto-layout',
      title: '自动布局',
      fields: [
        { id: 'label', label: '分组', type: 'readonly', value: element.label },
        {
          id: 'enabled',
          label: '启用',
          type: 'toggle',
          value: Boolean(autoLayout),
          onChange: (enabled) =>
            setAutoLayout(
              enabled
                ? {
                    direction: 'vertical',
                    gap: 12,
                    padding: { ...DEFAULT_EDGE_VALUES },
                    align: 'center',
                    justify: 'start',
                  }
                : undefined,
            ),
        },
        ...(autoLayout
          ? [
              {
                id: 'direction',
                label: '方向',
                type: 'segmented' as const,
                value: autoLayout.direction,
                options: [
                  { label: '垂直', value: 'vertical' },
                  { label: '水平', value: 'horizontal' },
                ],
                onChange: (direction: InspectorFieldValue) =>
                  setAutoLayout({
                    ...autoLayout,
                    direction: String(direction) as 'vertical' | 'horizontal',
                  }),
              },
              numberField(
                'gap',
                '间距',
                autoLayout.gap,
                (gap) => setAutoLayout({ ...autoLayout, gap }),
                { min: 0 },
              ),
              {
                id: 'padding',
                label: '内边距',
                type: 'edges' as const,
                value: autoLayout.padding,
                resettable: true,
                defaultValue: { ...DEFAULT_EDGE_VALUES },
                onChange: (padding: InspectorFieldValue) =>
                  setAutoLayout({ ...autoLayout, padding: padding as EdgeValues }),
              },
              {
                id: 'alignment',
                label: '对齐',
                type: 'alignment-grid' as const,
                value: `${autoLayout.justify}:${autoLayout.align}`,
                onChange: (value: InspectorFieldValue) => {
                  const [justify, align] = String(value).split(':') as [
                    'start' | 'center' | 'end',
                    'start' | 'center' | 'end',
                  ]
                  setAutoLayout({ ...autoLayout, justify, align })
                },
              },
            ]
          : []),
      ],
    }
  }
  if (element.type === 'runtime-placeholder') {
    return {
      id: 'runtime',
      title: '运行时区域',
      fields: [
        { id: 'label', label: '名称', type: 'readonly', value: element.label },
        colorField('textColor', '文字颜色', element.textColor ?? '#111827', (textColor) =>
          update({ textColor } as Partial<DesignElement>),
        ),
      ],
    }
  }
}

function numberField(
  id: string,
  label: string,
  value: number,
  onChange: (value: number) => void,
  options: Pick<InspectorField, 'min' | 'max' | 'step' | 'unit'> = {},
): InspectorField {
  return {
    id,
    label,
    type: 'number',
    value: Number.isFinite(value) ? value : 0,
    unit: 'px',
    ...options,
    onChange: (next) => onChange(Number(next)),
  }
}

function colorField(
  id: string,
  label: string,
  value: string,
  onChange: (value: string) => void,
): InspectorField {
  return { id, label, type: 'color', value, onChange: (next) => onChange(String(next)) }
}

function cornerField(
  element: DesignElement,
  update: (patch: Partial<DesignElement>) => void,
): InspectorField {
  return {
    id: 'corners',
    label: '圆角',
    type: 'corners',
    value: resolveCornerRadii(element),
    resettable: true,
    defaultValue: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    onChange: (cornerRadii) => update({ cornerRadii: cornerRadii as CornerValues }),
  }
}

function sizeModeOptions({
  supportsHug,
  supportsFill,
}: {
  supportsHug: boolean
  supportsFill: boolean
}): InspectorOption[] {
  return [
    { label: '固定', value: 'fixed' },
    { label: '适应', value: 'hug', disabled: !supportsHug },
    { label: '填充', value: 'fill', disabled: !supportsFill },
  ]
}
