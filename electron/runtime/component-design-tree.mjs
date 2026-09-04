const NODE_TYPES = new Set([
  'container',
  'surface',
  'text',
  'heading',
  'button',
  'image',
  'icon',
  'input',
  'progress',
  'list',
  'list-item',
  'divider',
  'badge',
])
const MAX_NODES = 96

export function normalizeDesignTree(
  input,
  { componentName, width = 375, height = 600, allowedPropPaths = [] } = {},
) {
  const source =
    input?.designTree && typeof input.designTree === 'object' ? input.designTree : input
  const rawNodes = Array.isArray(source?.nodes) ? source.nodes : []
  const allowed = new Set(allowedPropPaths)
  const treeWidth = clampNumber(source?.width, width, 1, 1500)
  const treeHeight = clampNumber(source?.height, height, 1, 10000)
  const nodes = rawNodes.slice(0, MAX_NODES).map((raw, index) => {
    const bounds = normalizeBounds(raw?.bounds, treeWidth, treeHeight)
    const type = NODE_TYPES.has(raw?.type) ? raw.type : 'surface'
    const explicitPath =
      typeof raw?.propPath === 'string' && allowed.has(raw.propPath) ? raw.propPath : undefined
    const bindingStatus = explicitPath
      ? 'bound'
      : raw?.bindingStatus === 'unresolved'
        ? 'unresolved'
        : 'visual-only'
    return {
      id: normalizeId(raw?.id, `visual-node-${index + 1}`),
      type,
      role: normalizeText(raw?.role, type),
      parentId:
        typeof raw?.parentId === 'string' ? normalizeId(raw.parentId, '') || undefined : undefined,
      bounds,
      content: normalizeText(raw?.content ?? raw?.text, '') || undefined,
      assetSource: typeof raw?.assetSource === 'string' ? raw.assetSource : undefined,
      slotId: typeof raw?.slotId === 'string' ? raw.slotId : undefined,
      repeaterPath: typeof raw?.repeaterPath === 'string' ? raw.repeaterPath : undefined,
      repeatIndex:
        Number.isInteger(raw?.repeatIndex) && raw.repeatIndex >= 0 ? raw.repeatIndex : undefined,
      templateId: typeof raw?.templateId === 'string' ? raw.templateId : undefined,
      propPath: explicitPath,
      bindingStatus,
      source: ['contract', 'thumbnail-vision', 'runtime-inspect', 'merged'].includes(raw?.source)
        ? raw.source
        : 'thumbnail-vision',
      confidence: clampNumber(raw?.confidence, 0.5, 0, 1),
      editable: raw?.editable !== false,
      visible: raw?.visible !== false,
      style: normalizeStyle(raw?.style),
      coordinateSpace:
        raw?.coordinateSpace === 'parent'
          ? 'parent'
          : raw?.coordinateSpace === 'absolute'
            ? 'absolute'
            : undefined,
    }
  })
  const ids = new Set()
  const valid = nodes.filter((node) => {
    if (ids.has(node.id)) return false
    ids.add(node.id)
    if (node.parentId && !nodes.some((candidate) => candidate.id === node.parentId))
      node.parentId = undefined
    return true
  })
  if (!valid.length) return undefined
  const convertedRelativeNodes = normalizeParentRelativeCoordinates(valid, treeWidth, treeHeight)
  return {
    version: 1,
    componentName: componentName || normalizeText(source?.componentName, 'component'),
    width: treeWidth,
    height: treeHeight,
    nodes: valid,
    diagnostics: [
      ...(Array.isArray(source?.diagnostics) ? source.diagnostics.slice(0, 24) : []),
      ...(convertedRelativeNodes.length
        ? [
            {
              code: 'DESIGN_TREE_PARENT_COORDINATES_NORMALIZED',
              message: `已将 ${convertedRelativeNodes.length} 个父级局部坐标转换为画布绝对坐标。`,
              nodeIds: convertedRelativeNodes.slice(0, 24),
            },
          ]
        : []),
    ],
  }
}

function normalizeParentRelativeCoordinates(nodes, width, height) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const resolved = new Set()
  const resolving = new Set()
  const converted = []
  const resolve = (node) => {
    if (resolved.has(node.id)) return
    if (resolving.has(node.id)) {
      node.parentId = undefined
      return
    }
    resolving.add(node.id)
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent) resolve(parent)
    if (parent && shouldTreatAsParentCoordinates(node, parent)) {
      node.bounds = normalizeBounds(
        {
          ...node.bounds,
          x: parent.bounds.x + node.bounds.x,
          y: parent.bounds.y + node.bounds.y,
        },
        width,
        height,
      )
      converted.push(node.id)
    }
    node.coordinateSpace = 'absolute'
    resolving.delete(node.id)
    resolved.add(node.id)
  }
  nodes.forEach(resolve)
  return converted
}

function shouldTreatAsParentCoordinates(node, parent) {
  if (node.coordinateSpace === 'absolute') return false
  if (node.coordinateSpace === 'parent') return true
  if (node.source !== 'thumbnail-vision') return false
  const epsilon = 1
  const child = node.bounds
  const container = parent.bounds
  const fitsParentLocal =
    child.x >= -epsilon &&
    child.y >= -epsilon &&
    child.x + child.width <= container.width + epsilon &&
    child.y + child.height <= container.height + epsilon
  const fitsParentAbsolute =
    child.x >= container.x - epsilon &&
    child.y >= container.y - epsilon &&
    child.x + child.width <= container.x + container.width + epsilon &&
    child.y + child.height <= container.y + container.height + epsilon
  return fitsParentLocal && !fitsParentAbsolute
}

export function mergeComponentDesignTree({
  contract,
  profile,
  blueprint,
  visionTree,
  sourceOwnsStructure = false,
}) {
  const allowedPropPaths = [
    ...(contract?.designProperties ?? []),
    ...(contract?.structuralControls ?? []),
  ]
    .filter((property) => propertyInProfile(property, profile?.id))
    .map((property) => property.path)
  const baseTree = normalizeDesignTree(
    {
      componentName: contract?.componentName,
      width: blueprint.width,
      height: blueprint.height,
      nodes: blueprint.regions.map((region) => ({
        id: region.id,
        type:
          region.renderMode === 'text'
            ? 'text'
            : region.renderMode === 'generated-asset'
              ? 'image'
              : region.renderMode === 'runtime'
                ? 'container'
                : 'surface',
        role: region.role,
        bounds: region.bounds,
        content: region.content ?? region.exactText,
        slotId: region.slotId,
        repeaterPath: region.repeaterPath,
        repeatIndex: region.repeatIndex,
        templateId: region.templateId,
        propPath: region.propBindings.find((path) => allowedPropPaths.includes(path)),
        bindingStatus: region.propBindings.some((path) => allowedPropPaths.includes(path))
          ? 'bound'
          : 'visual-only',
        source: 'contract',
        confidence: region.confidence,
        visible: region.visible !== false,
        style: { textAlign: region.textAlign, styleRole: region.styleRole },
      })),
    },
    {
      componentName: contract?.componentName,
      width: blueprint.width,
      height: blueprint.height,
      allowedPropPaths,
    },
  )
  const incoming = normalizeDesignTree(visionTree, {
    componentName: contract?.componentName,
    width: blueprint.width,
    height: blueprint.height,
    allowedPropPaths,
  })
  if (!incoming) return baseTree
  const nodes = sourceOwnsStructure ? [] : [...baseTree.nodes]
  const slotAssignments = sourceOwnsStructure
    ? resolveSlotAssignments(
        baseTree.nodes.filter((node) => node.slotId),
        incoming.nodes,
      )
    : new Map()
  for (const node of incoming.nodes) {
    // Vision 节点之间允许重叠：父容器、列表项、按钮和文字本来就会互相覆盖。
    // 只把 Vision 节点与 Contract 基础区域匹配，避免 42 个视觉节点被逐级压缩。
    const slotContract = slotAssignments.get(node.id)
    const duplicatePool = sourceOwnsStructure
      ? baseTree.nodes.filter((existing) => !existing.slotId)
      : nodes.filter((existing) => existing.source === 'contract')
    const duplicate =
      slotContract ||
      bestMatchingRegion(
        duplicatePool.filter(
          (existing) => !existing.slotId || ['button', 'image'].includes(node.type),
        ),
        node,
      )
    if (duplicate) {
      const merged = {
        ...node,
        id: sourceOwnsStructure ? node.id : duplicate.id,
        source: 'merged',
        slotId: node.slotId || duplicate.slotId,
        propPath: node.propPath || duplicate.propPath,
        bindingStatus: node.propPath || duplicate.propPath ? 'bound' : node.bindingStatus,
      }
      const existingIndex = nodes.findIndex((item) => item.id === merged.id)
      if (existingIndex >= 0) nodes[existingIndex] = merged
      else nodes.push(merged)
    } else {
      nodes.push({ ...node, source: 'merged' })
    }
  }
  if (sourceOwnsStructure) {
    const assignedSlots = new Set(nodes.map((node) => node.slotId).filter(Boolean))
    const usedIds = new Set(nodes.map((node) => node.id))
    const missingSlotCarriers = baseTree.nodes
      .filter((node) => node.slotId && !assignedSlots.has(node.slotId))
      .map((node) => ({
        ...node,
        id: uniqueFallbackSlotId(node.id, usedIds),
        parentId: undefined,
        source: 'merged',
      }))
    // Missing legal image slots are retained as background carriers. Runtime
    // structure stays authoritative for every non-slot node.
    nodes.unshift(...missingSlotCarriers)
  }
  const nodesWithSlotOwnership = applyImageSlotTextOwnership(nodes, baseTree.nodes)
  const annotatedNodes = applyVisualThemeToDesignNodes(
    annotateRepeaterNodes(nodesWithSlotOwnership, contract?.repeaters ?? []),
    blueprint.visualTheme,
  )
  return normalizeDesignTree(
    {
      componentName: contract?.componentName,
      width: blueprint.width,
      height: blueprint.height,
      nodes: annotatedNodes,
      diagnostics: incoming.diagnostics,
    },
    {
      componentName: contract?.componentName,
      width: blueprint.width,
      height: blueprint.height,
      allowedPropPaths,
    },
  )
}

function applyImageSlotTextOwnership(nodes, contractNodes) {
  const suppressedTextIds = new Set()
  for (const contractNode of contractNodes) {
    const content = normalizeText(contractNode.content, '')
    if (!contractNode.slotId || !content || contractNode.visible === false) continue
    const carrier = nodes.find((node) => node.slotId === contractNode.slotId)
    if (!carrier || carrier.visible === false) continue
    for (const node of nodes) {
      if (
        node.id !== carrier.id &&
        ['text', 'heading'].includes(node.type) &&
        node.visible !== false &&
        overlapCoverage(carrier.bounds, node.bounds) >= 0.35
      )
        suppressedTextIds.add(node.id)
    }
  }
  return nodes.filter((node) => !suppressedTextIds.has(node.id))
}

function uniqueFallbackSlotId(baseId, usedIds) {
  let id = `${baseId}-slot-fallback`
  let suffix = 2
  while (usedIds.has(id)) id = `${baseId}-slot-fallback-${suffix++}`
  usedIds.add(id)
  return id
}

export function designTreeToBlueprintRegions(tree, existingRegions = []) {
  if (!tree?.nodes?.length) return existingRegions
  const existingById = new Map(existingRegions.map((region) => [region.id, region]))
  const existingBySlot = new Map(
    existingRegions.flatMap((region) => (region.slotId ? [[region.slotId, region]] : [])),
  )
  const unboundExistingRegions = existingRegions.filter((region) => !region.slotId)
  return tree.nodes
    .filter((node) => {
      const old =
        (node.slotId && existingBySlot.get(node.slotId)) ||
        existingById.get(node.id) ||
        bestMatchingRegion(unboundExistingRegions, node)
      // role/id 是结构标识，不是用户文案。没有 OCR 内容的文本/Button
      // 不应被编译成可见文字，否则会出现 draw-one-action 之类的伪文案。
      if (
        ['text', 'heading', 'button'].includes(node.type) &&
        !old?.slotId &&
        !hasReliableNodeContent(node)
      )
        return false
      return true
    })
    .map((node) => {
      const old =
        (node.slotId && existingBySlot.get(node.slotId)) ||
        existingById.get(node.id) ||
        bestMatchingRegion(unboundExistingRegions, node)
      const mode =
        node.type === 'image' && node.slotId
          ? 'generated-asset'
          : node.type === 'button' && node.slotId
            ? 'generated-asset'
            : node.type === 'text' || node.type === 'heading'
              ? 'text'
              : node.type === 'button' && old?.slotId
                ? 'generated-asset'
                : node.type === 'button'
                  ? 'button'
                  : node.type === 'image' && old?.slotId
                    ? 'generated-asset'
                    : ['divider', 'badge', 'progress'].includes(node.type) ||
                        (['container', 'surface', 'list', 'list-item'].includes(node.type) &&
                          (node.style?.fill || old?.renderMode === 'color'))
                      ? 'color'
                      : 'runtime'
      return {
        id: node.id,
        role: node.role,
        content: node.content || old?.content || old?.exactText,
        exactText: old?.exactText || node.content,
        parentId: node.parentId,
        assetSource: node.assetSource,
        bounds: node.bounds,
        slotId: node.slotId || old?.slotId,
        repeaterPath: node.repeaterPath,
        repeatIndex: node.repeatIndex,
        templateId: node.templateId,
        propBindings: node.propPath ? [node.propPath] : (old?.propBindings ?? []),
        renderMode: mode,
        confidence: node.confidence,
        visible: old?.visible !== false,
        styleRole:
          node.type === 'heading' ? 'heading' : node.type === 'button' ? 'button' : old?.styleRole,
        textAlign: node.style?.textAlign || old?.textAlign,
        preview: old?.preview,
        designNodeType: node.type,
        designNodeSource: node.source,
        designNodeBindingStatus: node.bindingStatus,
        style: node.style,
      }
    })
}

function resolveSlotAssignments(slotContracts, runtimeNodes) {
  const assignments = new Map()
  const usedRuntimeIds = new Set()
  for (const contract of slotContracts) {
    const anchors = runtimeNodes
      .map((node) => ({
        node,
        score: slotAnchorTextScore(contract, node),
      }))
      .filter((item) => item.score >= 0.55)
      .sort((left, right) => right.score - left.score)
      .map((item) => item.node)
    const candidates = anchors
      .flatMap((anchor) =>
        runtimeNodes.map((candidate) => ({
          candidate,
          score: slotCarrierScore(contract, anchor, candidate),
        })),
      )
      .filter(
        ({ candidate, score }) =>
          !usedRuntimeIds.has(candidate.id) &&
          slotCarrierGeometryMatches(contract, candidate) &&
          score >= 100,
      )
      .sort((left, right) => right.score - left.score)
    const carrier = candidates[0]?.candidate
    if (!carrier) continue
    assignments.set(carrier.id, contract)
    usedRuntimeIds.add(carrier.id)
  }
  return assignments
}

function slotCarrierGeometryMatches(contract, candidate) {
  if (!contract?.bounds || !candidate?.bounds) return false
  if (!['image', 'button', 'surface'].includes(candidate.type)) return false
  const contractArea = Math.max(1, contract.bounds.width * contract.bounds.height)
  const candidateArea = Math.max(1, candidate.bounds.width * candidate.bounds.height)
  const areaRatio = Math.max(contractArea, candidateArea) / Math.min(contractArea, candidateArea)
  const overlap = overlapCoverage(contract.bounds, candidate.bounds)
  const distance = centerDistance(contract.bounds, candidate.bounds)
  const contractDiagonal = Math.hypot(contract.bounds.width, contract.bounds.height)
  const spatialMatch = overlap >= 0.35 || distance <= Math.max(12, contractDiagonal * 0.38)
  if (!spatialMatch) return false
  // Surface 是最容易误选的父容器，必须接近 Slot 自身面积；真实 image/button
  // 可容忍少量 Runtime 缩放，但也不能吞掉整块内容区。
  return areaRatio <= (candidate.type === 'surface' ? 2.6 : 4)
}

function slotAnchorTextScore(contract, node) {
  const content = semanticText(node.content)
  if (!content) return 0
  const references = [contract.content, contract.role].map(semanticText).filter(Boolean)
  return Math.max(
    0,
    ...references.map((reference) => {
      if (reference === content) return 1
      if (reference.includes(content) || content.includes(reference)) return 0.82
      return semanticCharacterSimilarity(reference, content)
    }),
  )
}

function semanticCharacterSimilarity(left, right) {
  const leftChars = new Set([...left])
  const rightChars = new Set([...right])
  const overlap = [...leftChars].filter((character) => rightChars.has(character)).length
  return overlap ? (2 * overlap) / (leftChars.size + rightChars.size) : 0
}

function slotCarrierScore(contract, anchor, candidate) {
  if (candidate.visible === false || !['image', 'button', 'surface'].includes(candidate.type)) {
    return Number.NEGATIVE_INFINITY
  }
  const sameNode = candidate.id === anchor.id
  const sameParent = Boolean(candidate.parentId && candidate.parentId === anchor.parentId)
  const containsAnchor = containsWithTolerance(candidate, anchor, 2)
  const anchorContains = containsWithTolerance(anchor, candidate, 2)
  const overlap = overlapCoverage(candidate.bounds, anchor.bounds)
  const distance = centerDistance(candidate.bounds, anchor.bounds)
  const near =
    distance <= Math.max(anchor.bounds.width, anchor.bounds.height, candidate.bounds.height) * 1.6
  const spatiallyRelated = sameNode || containsAnchor || anchorContains || overlap >= 0.35
  if (!spatiallyRelated) {
    return Number.NEGATIVE_INFINITY
  }
  const areaRatio =
    Math.max(
      candidate.bounds.width * candidate.bounds.height,
      anchor.bounds.width * anchor.bounds.height,
    ) /
    Math.max(
      1,
      Math.min(
        candidate.bounds.width * candidate.bounds.height,
        anchor.bounds.width * anchor.bounds.height,
      ),
    )
  const typeScore = candidate.type === 'button' ? 90 : candidate.type === 'image' ? 80 : 20
  return (
    typeScore +
    (sameNode ? 180 : 0) +
    (sameParent ? 40 : 0) +
    (containsAnchor ? 130 : 0) +
    (anchorContains ? 80 : 0) +
    overlap * 100 +
    (near ? 40 : 0) +
    (semanticRegionMatch(contract, candidate) ? 30 : 0) -
    Math.min(90, Math.max(0, areaRatio - 6) * 3) -
    Math.min(50, distance / 4)
  )
}

function overlapCoverage(left, right) {
  const overlapWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  )
  const overlapHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  )
  const smallerArea = Math.min(left.width * left.height, right.width * right.height)
  return smallerArea > 0 ? (overlapWidth * overlapHeight) / smallerArea : 0
}

function containsWithTolerance(parent, child, tolerance = 0) {
  const left = parent.bounds
  const right = child.bounds
  return (
    right.x >= left.x - tolerance &&
    right.y >= left.y - tolerance &&
    right.x + right.width <= left.x + left.width + tolerance &&
    right.y + right.height <= left.y + left.height + tolerance
  )
}

function centerDistance(left, right) {
  const leftX = left.x + left.width / 2
  const leftY = left.y + left.height / 2
  const rightX = right.x + right.width / 2
  const rightY = right.y + right.height / 2
  return Math.hypot(leftX - rightX, leftY - rightY)
}

function applyVisualThemeToDesignNodes(nodes, theme) {
  if (!theme || !['kv', 'visual', 'style-pack'].includes(theme.source)) return nodes
  const primary = themeColor(theme, 'primary', theme.colors?.[0] || '#2563eb')
  const background = themeColor(theme, 'background', theme.colors?.[2] || '#ffffff')
  const surface = themeColor(
    theme,
    'surface',
    theme.surfaces?.find((item) => item?.fill)?.fill || theme.colors?.[1] || background,
  )
  const text = themeColor(theme, 'text', theme.colors?.[3] || '#1f2937')
  const secondary = themeColor(theme, 'secondary', theme.colors?.[1] || primary)
  const surfaceToken = theme.surfaces?.[0]
  const dimensional = Boolean(
    theme.effects?.some((effect) =>
      ['shadow', 'glow', 'gradient', 'texture'].includes(effect?.type),
    ) ||
    /立体|描边|发光|光效|霓虹|质感|shadow|glow|neon|dimensional/i.test(theme.visualStyle || ''),
  )
  return nodes.map((node) => {
    const style = { ...(node.style ?? {}) }
    if (node.type === 'text' || node.type === 'heading' || node.type === 'input') {
      style.color = text
    } else if (node.type === 'button') {
      style.fill = primary
      style.color = readableThemeText(primary, text)
      style.radius = surfaceToken?.radius ?? style.radius
      if (dimensional) style.shadow = themeShadow(primary, 'button')
    } else if (node.type === 'divider') {
      style.fill = secondary
    } else if (node.type === 'badge' || node.type === 'progress') {
      style.fill = primary
      style.color = readableThemeText(primary, text)
    } else if (['container', 'surface', 'list', 'list-item'].includes(node.type) && style.fill) {
      style.fill = node.parentId ? surface : background
      style.radius = surfaceToken?.radius ?? style.radius
      if (node.parentId) {
        style.stroke = surfaceToken?.border || secondary
        style.strokeWidth = 1
        if (dimensional) style.shadow = themeShadow(primary, 'surface')
      }
    }
    return { ...node, style }
  })
}

function themeShadow(color, role) {
  return {
    x: 0,
    y: role === 'button' ? 3 : 4,
    blur: role === 'button' ? 8 : 14,
    spread: 0,
    color: alphaColor(color, role === 'button' ? 0.32 : 0.2),
  }
}

function alphaColor(value, alpha) {
  const rgb = parseRgb(value)
  return rgb
    ? `rgba(${rgb.map((item) => Math.round(item)).join(', ')}, ${alpha})`
    : 'rgba(15, 23, 42, 0.18)'
}

function themeColor(theme, role, fallback) {
  return theme.colorTokens?.find((token) => token?.role === role)?.value || fallback
}

function readableThemeText(background, preferred) {
  const bg = parseRgb(background)
  const text = parseRgb(preferred)
  if (!bg || !text || contrastRatio(bg, text) >= 4.5) return preferred
  return contrastRatio(bg, [255, 255, 255]) >= contrastRatio(bg, [31, 41, 55])
    ? '#ffffff'
    : '#1f2937'
}

function parseRgb(value) {
  const input = String(value || '').trim()
  const hex = input.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1]
  if (hex) {
    const normalized = hex.length === 3 ? [...hex].map((item) => item + item).join('') : hex
    return [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16))
  }
  const rgb = input.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
  return rgb ? rgb.slice(1, 4).map((item) => Math.max(0, Math.min(255, Number(item)))) : undefined
}

function contrastRatio(left, right) {
  const luminance = (rgb) =>
    rgb.reduce((total, channel, index) => {
      const normalized = channel / 255
      const linear =
        normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      return total + linear * [0.2126, 0.7152, 0.0722][index]
    }, 0)
  const a = luminance(left)
  const b = luminance(right)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function annotateRepeaterNodes(nodes, repeaters) {
  if (!Array.isArray(nodes) || !nodes.length || !Array.isArray(repeaters) || !repeaters.length)
    return nodes
  const result = nodes.map((node) => ({ ...node }))
  for (const repeater of repeaters) {
    const path = typeof repeater?.path === 'string' ? repeater.path : ''
    if (!path) continue
    const listNodes = result.filter((node) => node.type === 'list' && !node.repeaterPath)
    const itemNodes = result.filter(
      (node) =>
        ['list-item', 'card'].includes(node.type) ||
        /列表项|任务项|list item|item/i.test(node.role || ''),
    )
    const scopedItems = itemNodes.filter((node) => {
      const parent = node.parentId
        ? result.find((candidate) => candidate.id === node.parentId)
        : undefined
      const list =
        parent?.type === 'list' ? parent : listNodes.find((candidate) => contains(candidate, node))
      return Boolean(list)
    })
    if (scopedItems.length) {
      scopedItems.forEach((node, index) => {
        node.repeaterPath = path
        node.repeatIndex = index
        node.templateId = `${path}[]`
      })
      const list = listNodes.find((candidate) =>
        scopedItems.some((item) => contains(candidate, item)),
      )
      if (list) {
        list.repeaterPath = path
        list.templateId = `${path}[]`
      }
      continue
    }
    const list = listNodes.find(
      (candidate) => candidate.role === repeater.role || /list|列表/i.test(candidate.role || ''),
    )
    if (list) {
      list.repeaterPath = path
      list.templateId = `${path}[]`
    }
  }
  return result
}

function contains(parent, child) {
  const left = parent.bounds
  const right = child.bounds
  return (
    right.x >= left.x &&
    right.y >= left.y &&
    right.x + right.width <= left.x + left.width &&
    right.y + right.height <= left.y + left.height
  )
}

function sameVisualRegion(left, right) {
  const overlapX = Math.max(
    0,
    Math.min(left.bounds.x + left.bounds.width, right.bounds.x + right.bounds.width) -
      Math.max(left.bounds.x, right.bounds.x),
  )
  const overlapY = Math.max(
    0,
    Math.min(left.bounds.y + left.bounds.height, right.bounds.y + right.bounds.height) -
      Math.max(left.bounds.y, right.bounds.y),
  )
  const overlap = overlapX * overlapY
  const smaller = Math.min(
    left.bounds.width * left.bounds.height,
    right.bounds.width * right.bounds.height,
  )
  return (
    left.role === right.role ||
    (smaller > 0 && overlap / smaller > 0.82) ||
    (['button', 'image'].includes(right.type) && semanticRegionMatch(left, right))
  )
}

function bestMatchingRegion(candidates, node) {
  return candidates
    .map((candidate) => ({ candidate, score: visualRegionMatchScore(candidate, node) }))
    .filter((item) => item.score >= 50)
    .sort((left, right) => right.score - left.score)[0]?.candidate
}

function visualRegionMatchScore(left, right) {
  const leftText = semanticText(left.content || left.role)
  const rightText = semanticText(right.content || right.role)
  const exactText = Boolean(leftText && rightText && leftText === rightText)
  if (left.visible === false && right.visible !== false && !exactText)
    return Number.NEGATIVE_INFINITY
  const relatedText = Boolean(
    !exactText &&
    leftText &&
    rightText &&
    (leftText.includes(rightText) || rightText.includes(leftText)),
  )
  const overlapX = Math.max(
    0,
    Math.min(left.bounds.x + left.bounds.width, right.bounds.x + right.bounds.width) -
      Math.max(left.bounds.x, right.bounds.x),
  )
  const overlapY = Math.max(
    0,
    Math.min(left.bounds.y + left.bounds.height, right.bounds.y + right.bounds.height) -
      Math.max(left.bounds.y, right.bounds.y),
  )
  const overlap = overlapX * overlapY
  const union =
    left.bounds.width * left.bounds.height + right.bounds.width * right.bounds.height - overlap
  const iou = union > 0 ? overlap / union : 0
  const typeCompatible =
    left.type === right.type ||
    (['button', 'image'].includes(left.type) && ['button', 'image'].includes(right.type))
  return (
    (exactText ? 120 : relatedText ? 80 : 0) +
    (left.role === right.role ? 80 : 0) +
    (semanticRegionMatch(left, right) ? 36 : 0) +
    (typeCompatible ? 18 : 0) +
    (left.slotId && ['button', 'image'].includes(right.type) ? 24 : 0) +
    iou * 50
  )
}

function semanticRegionMatch(left, right) {
  const leftText = semanticText(left.content || left.role)
  const rightText = semanticText(right.content || right.role)
  if (
    leftText &&
    rightText &&
    (leftText === rightText || leftText.includes(rightText) || rightText.includes(leftText))
  ) {
    return true
  }
  const leftTokens = regionTokens(`${left.id} ${left.role} ${left.slotId || ''}`)
  const rightTokens = regionTokens(`${right.id} ${right.role} ${right.slotId || ''}`)
  return [...rightTokens].some((token) => token.length >= 3 && leftTokens.has(token))
}

function semanticText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/(?:按钮|素材|图片|图标|button|image|icon|asset|pic)/gi, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '')
}

function regionTokens(value) {
  return new Set(
    String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/i)
      .map((token) => token.trim())
      .filter(Boolean),
  )
}

function hasReliableNodeContent(node) {
  const content = String(node.content || '')
    .trim()
    .toLowerCase()
  if (!content) return false
  const structuralNames = new Set(
    [
      String(node.id || '')
        .trim()
        .toLowerCase(),
      'text',
      'button',
      'heading',
      'list-item',
      'action',
    ].filter(Boolean),
  )
  return !structuralNames.has(content)
}

function propertyInProfile(property, profileId) {
  if (!property || !profileId) return false
  return profileId === 'default' ? !property.profile : property.profile === profileId
}

function normalizeBounds(value, width, height) {
  const x = clampNumber(value?.x, 0, 0, width)
  const y = clampNumber(value?.y, 0, 0, height)
  return {
    x,
    y,
    width: clampNumber(value?.width, Math.max(1, width - x), 1, width - x),
    height: clampNumber(value?.height, Math.max(1, height - y), 1, height - y),
  }
}

function normalizeStyle(value) {
  if (!value || typeof value !== 'object') return {}
  return {
    ...(typeof value.fill === 'string' ? { fill: value.fill } : {}),
    ...(typeof value.color === 'string' ? { color: value.color } : {}),
    ...(typeof value.stroke === 'string' ? { stroke: value.stroke } : {}),
    ...(typeof value.textAlign === 'string' ? { textAlign: value.textAlign } : {}),
    ...(Number.isFinite(value.radius) ? { radius: Math.max(0, value.radius) } : {}),
    ...(Number.isFinite(value.fontSize) ? { fontSize: Math.max(8, value.fontSize) } : {}),
    ...(Number.isFinite(value.fontWeight) ? { fontWeight: Math.max(1, value.fontWeight) } : {}),
    ...(Number.isFinite(value.lineHeight) ? { lineHeight: Math.max(0.1, value.lineHeight) } : {}),
    ...(Number.isFinite(value.strokeWidth) ? { strokeWidth: Math.max(0, value.strokeWidth) } : {}),
    ...(Number.isFinite(value.opacity) ? { opacity: Math.max(0, Math.min(1, value.opacity)) } : {}),
    ...(validShadow(value.shadow) ? { shadow: { ...value.shadow } } : {}),
  }
}

function validShadow(value) {
  return (
    value &&
    typeof value === 'object' &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.blur) &&
    typeof value.color === 'string'
  )
}

function normalizeText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 180) : fallback
}

function normalizeId(value, fallback) {
  return (
    normalizeText(value, fallback)
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .slice(0, 80) || fallback
  )
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}
