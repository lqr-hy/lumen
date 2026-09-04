import type { CodeNode } from './types'

/**
 * 为每个节点分配唯一的 CSS class，并写入 `meta.className`。
 *
 * 必须保证唯一：class 一旦碰撞，多个元素会共用同一条 CSS 规则，后者覆盖前者，
 * 表现为元素堆叠或"消失"。仅靠哈希只能降低碰撞概率，这里用注册表消除它。
 *
 * 分配顺序沿 IR 深度优先遍历，因此同一份文档的产物是确定的。
 */
export function assignClassNames(root: CodeNode) {
  const used = new Set<string>()
  visit(root)
  return root

  function visit(node: CodeNode) {
    node.meta.className = allocate(node)
    node.children.forEach(visit)
  }

  function allocate(node: CodeNode) {
    const base = `${slug(node)}${node.role === 'content' ? '-content' : ''}`
    if (!used.has(base)) {
      used.add(base)
      return base
    }
    // 后缀从 2 起递增，保持可读性且与 base 一起构成稳定序列。
    for (let index = 2; ; index += 1) {
      const candidate = `${base}-${index}`
      if (!used.has(candidate)) {
        used.add(candidate)
        return candidate
      }
    }
  }
}

function slug(node: CodeNode) {
  const source = node.meta.name ?? node.meta.runtime?.componentName ?? node.meta.elementType ?? node.role
  const text =
    source
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9一-龥]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'node'
  return text
}
