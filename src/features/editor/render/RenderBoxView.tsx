import { createElement } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { toReactStyle, type RenderBox } from './render-box'
import { cn } from '../../../lib/cn'

export interface RenderBoxOverride {
  className?: string
  style?: CSSProperties
  /** 替换该 box 的子内容，用于文本编辑态。 */
  children?: ReactNode
  props?: Record<string, unknown>
}

export interface RenderBoxViewProps {
  box: RenderBox
  /** 按 box.key 提供交互态覆盖；缺省即纯静态渲染。 */
  override?: (box: RenderBox) => RenderBoxOverride | undefined
}

/** 把 Render IR 打印为 React 元素树。视觉完全来自 IR，不额外引入样式。 */
export function RenderBoxView({ box, override }: RenderBoxViewProps) {
  const extra = override?.(box)
  const selfClosing = box.tag === 'img' || box.tag === 'input'
  const children: ReactNode = extra?.children
    ? extra.children
    : selfClosing
      ? undefined
      : box.children.length
        ? box.children.map((child) => (
            <RenderBoxView key={child.key} box={child} override={override} />
          ))
        : box.text

  return createElement(
    box.tag,
    {
      ...box.attrs,
      ...extra?.props,
      className: cn(...box.classNames, extra?.className),
      style: extra?.style
        ? { ...toReactStyle(box.css), ...extra.style }
        : toReactStyle(box.css),
      // html2canvas 需要跨域图片显式声明 CORS 才能进入画布。
      ...(box.tag === 'img'
        ? {
            draggable: false,
            crossOrigin: /^https?:\/\//i.test(box.attrs?.src ?? '')
              ? ('anonymous' as const)
              : undefined,
          }
        : undefined),
      // IR 的 input 是受控快照，编辑由画布负责。
      ...(box.tag === 'input' ? { readOnly: true } : undefined),
    },
    children,
  )
}
