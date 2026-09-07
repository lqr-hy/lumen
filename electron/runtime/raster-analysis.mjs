import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'

export function analyzeRaster(buffer, mime, target = {}) {
  const dimensions = readRasterDimensions(buffer, mime)
  const targetRatio = positiveRatio(target.width, target.height)
  const actualRatio = positiveRatio(dimensions?.width, dimensions?.height)
  const base = {
    width: dimensions?.width,
    height: dimensions?.height,
    targetWidth: target.width,
    targetHeight: target.height,
    ratioError:
      targetRatio && actualRatio ? Math.abs(actualRatio - targetRatio) / targetRatio : undefined,
  }
  try {
    const raster = decodeRaster(buffer, mime)
    if (!raster) return base
    const pixels = inspectRasterPixels(raster)
    const contentRatio = positiveRatio(pixels.contentBounds?.width, pixels.contentBounds?.height)
    return {
      ...base,
      ...pixels,
      contentRatioError:
        targetRatio && contentRatio
          ? Math.abs(contentRatio - targetRatio) / targetRatio
          : undefined,
    }
  } catch {
    return base
  }
}

/*
 * Raster analysis is intentionally kept generic. Component-specific image
 * button pairing rules do not belong in the AI design editor runtime.
 */
export function reviewImageButtonPair(buttons, options = {}) {
  const targets = (Array.isArray(buttons) ? buttons : []).slice(0, 2).map((button) => {
    const analysis = analyzeRaster(button.buffer, button.mime || 'image/png', button.container)
    const bounds = analysis.contentBounds || {
      x: 0,
      y: 0,
      width: analysis.width || 0,
      height: analysis.height || 0,
    }
    return {
      id: button.id,
      container: button.container,
      analysis,
      visibleWidth: bounds.width,
      visibleHeight: bounds.height,
      visibleArea: bounds.width * bounds.height,
      visibleRatio: positiveRatio(bounds.width, bounds.height),
    }
  })
  const issues = []
  if (targets.length !== 2) {
    issues.push(
      rasterGateIssue('IMAGE_BUTTON_PAIR_INCOMPLETE', 'error', '图片按钮门禁需要两个按钮素材。'),
    )
  }
  for (const target of targets) {
    if ((target.analysis.transparentCoverage ?? 0) > (options.maxTransparentCoverage ?? 0.45)) {
      issues.push(
        rasterGateIssue(
          'IMAGE_BUTTON_ALPHA_PADDING_EXCESSIVE',
          'warning',
          `${target.id} 的透明留白过大。`,
          [target.id],
        ),
      )
    }
  }
  if (targets.length === 2) {
    const [left, right] = targets
    const containerDifference = maxRelativeDifference(
      [left.container?.width, left.container?.height],
      [right.container?.width, right.container?.height],
    )
    const visibleDifference = maxRelativeDifference(
      [left.visibleWidth, left.visibleHeight],
      [right.visibleWidth, right.visibleHeight],
    )
    if (containerDifference > (options.maxContainerDifference ?? 0.1)) {
      issues.push(
        rasterGateIssue(
          'IMAGE_BUTTON_CONTAINER_SIZE_MISMATCH',
          'error',
          '两个图片按钮的容器尺寸差异超过 10%。',
          targets.map((target) => target.id),
        ),
      )
    }
    if (visibleDifference > (options.maxVisibleDifference ?? 0.1)) {
      issues.push(
        rasterGateIssue(
          'IMAGE_BUTTON_VISIBLE_SIZE_MISMATCH',
          'error',
          '两个图片按钮的 Alpha 可见内容尺寸差异超过 10%。',
          targets.map((target) => target.id),
        ),
      )
    }
    const gap =
      Number(right.container?.x) - (Number(left.container?.x) + Number(left.container?.width))
    const expectedGap = options.expectedGap
    if (
      Number.isFinite(expectedGap) &&
      Math.abs(gap - expectedGap) > (options.maxGapDifference ?? 8)
    ) {
      issues.push(
        rasterGateIssue(
          'IMAGE_BUTTON_SPACING_MISMATCH',
          'warning',
          '图片按钮间距与设计值的差异超过 8px。',
          targets.map((target) => target.id),
        ),
      )
    }
    if (
      dominantColorDistance(left.analysis.dominantColors?.[0], right.analysis.dominantColors?.[0]) >
      96
    ) {
      issues.push(
        rasterGateIssue(
          'IMAGE_BUTTON_STYLE_MISMATCH',
          'warning',
          '两个图片按钮的主色与视觉风格偏差较大。',
          targets.map((target) => target.id),
        ),
      )
    }
  }
  const errors = issues.filter((issue) => issue.severity === 'error').length
  return {
    version: 1,
    scope: 'module',
    passed: errors === 0,
    score: Math.max(
      0,
      Math.round((1 - errors * 0.25 - (issues.length - errors) * 0.05) * 100) / 100,
    ),
    targetIds: targets.map((target) => target.id),
    issues,
    repairPlan: issues.map((issue) => ({
      action: issue.code.includes('CONTAINER')
        ? 'normalize-button-size'
        : issue.code.includes('VISIBLE')
          ? 'normalize-object-fit'
          : issue.code.includes('ALPHA')
            ? 'crop-alpha-bounds'
            : 'manual-review',
      targetIds: issue.targetIds,
      // 重新生图只作为人工复核后的最后手段，不能由尺寸差异直接触发。
      allowsAssetRegeneration: false,
    })),
    repairCount: options.repairCount ?? 0,
    metrics: targets,
  }
}

function rasterGateIssue(code, severity, message, targetIds = []) {
  return { code, severity, message, targetIds }
}

function maxRelativeDifference(left, right) {
  return Math.max(
    ...left.map((value, index) => {
      const a = Number(value) || 0
      const b = Number(right[index]) || 0
      return Math.abs(a - b) / Math.max(1, a, b)
    }),
  )
}

function dominantColorDistance(left, right) {
  const parse = (value) => {
    const match = String(value || '').match(/^#([0-9a-f]{6})$/i)
    return match
      ? [0, 2, 4].map((index) => Number.parseInt(match[1].slice(index, index + 2), 16))
      : undefined
  }
  const a = parse(left)
  const b = parse(right)
  return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : 0
}

function decodeRaster(buffer, mime) {
  if (mime === 'image/png') return PNG.sync.read(buffer)
  if (mime === 'image/jpeg')
    return jpeg.decode(buffer, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: true,
    })
  return undefined
}

export function normalizeRasterForTarget(buffer, mime, target, options = {}) {
  const rawSourceAnalysis = analyzeRaster(buffer, mime, target)
  if (mime !== 'image/png' || !positiveRatio(target?.width, target?.height)) {
    return {
      buffer,
      mime,
      analysis: { ...rawSourceAnalysis, source: rawSourceAnalysis, normalized: rawSourceAnalysis },
    }
  }
  let source
  try {
    source = PNG.sync.read(buffer)
  } catch {
    return {
      buffer,
      mime,
      analysis: { ...rawSourceAnalysis, source: rawSourceAnalysis, normalized: rawSourceAnalysis },
    }
  }
  const chroma = options.chromaKey ? removeChromaKey(source, options.chromaKey) : undefined
  const sourceBuffer = chroma?.applied ? PNG.sync.write(source) : buffer
  const sourceAnalysis = chroma?.applied
    ? analyzeRaster(sourceBuffer, mime, target)
    : rawSourceAnalysis
  const transparent = options.transparent === true
  const bounds = transparent ? findContentBounds(source) : fullBounds(source)
  const fitted = transparent
    ? bounds
    : fitBoundsToRatio(bounds, source.width, source.height, target.width / target.height)
  const fillTransparentContent = transparent && options.fitMode === 'fill-content'
  const output = transparent
    ? fillTransparentContent
      ? resizeBilinear(source, fitted, target.width, target.height)
      : containWithTransparentPadding(source, fitted, target.width, target.height)
    : resizeBilinear(source, fitted, target.width, target.height)
  const normalized = PNG.sync.write(output)
  const normalizedAnalysis = analyzeRaster(normalized, 'image/png', target)
  return {
    buffer: normalized,
    mime: 'image/png',
    analysis: {
      ...normalizedAnalysis,
      source: sourceAnalysis,
      ...(chroma ? { rawSource: rawSourceAnalysis, chromaKey: chroma } : {}),
      normalized: normalizedAnalysis,
      transform: {
        mode: transparent ? (fillTransparentContent ? 'fill-content' : 'contain') : 'cover',
        sourceBounds: fitted,
        sourceSize: { width: source.width, height: source.height },
        targetSize: { width: target.width, height: target.height },
      },
    },
  }
}

function removeChromaKey(png, keyValue) {
  const key = parseHexColor(keyValue)
  if (!key) return { applied: false, key: keyValue, reason: 'invalid-key' }
  const borderMatch = chromaBorderMatch(png, key)
  if (borderMatch < 0.45) {
    return { applied: false, key: keyValue, borderMatch, reason: 'border-key-missing' }
  }
  const transparentThreshold = 18
  const opaqueThreshold = 105
  let removedPixels = 0
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const distance = colorDistance(
      png.data[offset],
      png.data[offset + 1],
      png.data[offset + 2],
      key,
    )
    if (distance >= opaqueThreshold) continue
    const weight =
      distance <= transparentThreshold
        ? 0
        : (distance - transparentThreshold) / (opaqueThreshold - transparentThreshold)
    png.data[offset + 3] = Math.round(png.data[offset + 3] * weight)
    if (png.data[offset + 3] <= 8) removedPixels += 1
    if (key.g > key.r && key.g > key.b && weight < 1) {
      png.data[offset + 1] = Math.min(
        png.data[offset + 1],
        Math.max(png.data[offset], png.data[offset + 2]) + 18,
      )
    }
  }
  return {
    applied: true,
    key: keyValue,
    borderMatch,
    removedCoverage: removedPixels / Math.max(1, png.width * png.height),
    softMatte: true,
    despill: true,
  }
}

function chromaBorderMatch(png, key) {
  let matches = 0
  let samples = 0
  const sample = (x, y) => {
    const offset = (y * png.width + x) * 4
    samples += 1
    if (colorDistance(png.data[offset], png.data[offset + 1], png.data[offset + 2], key) <= 60)
      matches += 1
  }
  for (let x = 0; x < png.width; x += 1) {
    sample(x, 0)
    if (png.height > 1) sample(x, png.height - 1)
  }
  for (let y = 1; y < png.height - 1; y += 1) {
    sample(0, y)
    if (png.width > 1) sample(png.width - 1, y)
  }
  return samples ? matches / samples : 0
}

function colorDistance(r, g, b, key) {
  return Math.hypot(r - key.r, g - key.g, b - key.b)
}

function parseHexColor(value) {
  const match = String(value || '').match(/^#([0-9a-f]{6})$/i)
  if (!match) return undefined
  return {
    r: Number.parseInt(match[1].slice(0, 2), 16),
    g: Number.parseInt(match[1].slice(2, 4), 16),
    b: Number.parseInt(match[1].slice(4, 6), 16),
  }
}

export function compositeRasterWithMask(baseBuffer, baseMime, generatedBuffer, maskBuffer, target) {
  const baseNormalized = normalizeRasterForTarget(baseBuffer, baseMime, target, {
    transparent: false,
  })
  const generatedNormalized = normalizeRasterForTarget(generatedBuffer, 'image/png', target, {
    transparent: false,
  })
  const maskNormalized = normalizeRasterForTarget(maskBuffer, 'image/png', target, {
    transparent: false,
  })
  const base = PNG.sync.read(baseNormalized.buffer)
  const generated = PNG.sync.read(generatedNormalized.buffer)
  const mask = PNG.sync.read(maskNormalized.buffer)
  const output = new PNG({ width: target.width, height: target.height })
  let preservedPixels = 0
  let editedPixels = 0
  for (let offset = 0; offset < output.data.length; offset += 4) {
    const preserveWeight = mask.data[offset + 3] / 255
    if (preserveWeight >= 1) preservedPixels += 1
    else editedPixels += 1
    for (let channel = 0; channel < 4; channel += 1) {
      output.data[offset + channel] = Math.round(
        generated.data[offset + channel] * (1 - preserveWeight) +
          base.data[offset + channel] * preserveWeight,
      )
    }
  }
  if (!editedPixels) throw new Error('图片 Mask 没有可编辑像素。')
  const buffer = PNG.sync.write(output)
  return {
    buffer,
    mime: 'image/png',
    analysis: {
      ...analyzeRaster(buffer, 'image/png', target),
      maskComposite: true,
      preservedPixels,
      editedPixels,
    },
  }
}

export function readRasterDimensions(buffer, mime) {
  if (mime === 'image/png' && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (mime === 'image/jpeg') {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = buffer[offset + 1]
      const length = buffer.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      }
      offset += Math.max(2, length + 2)
    }
  }
  if (mime === 'image/webp' && buffer.length >= 30 && buffer.toString('ascii', 12, 16) === 'VP8X') {
    return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) }
  }
  return undefined
}

function inspectRasterPixels(png) {
  let visible = 0
  let opaque = 0
  let transparent = 0
  let translucent = 0
  let whiteOpaque = 0
  let edgeVisible = 0
  const colorBuckets = new Map()
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4
      const r = png.data[offset]
      const g = png.data[offset + 1]
      const b = png.data[offset + 2]
      const a = png.data[offset + 3]
      if (a <= 8) {
        transparent += 1
        continue
      }
      visible += 1
      if (a >= 247) opaque += 1
      else translucent += 1
      if (a >= 247 && r >= 245 && g >= 245 && b >= 245) whiteOpaque += 1
      if (x === 0 || y === 0 || x === png.width - 1 || y === png.height - 1) edgeVisible += 1
      const key = `${r >> 4},${g >> 4},${b >> 4}`
      colorBuckets.set(key, (colorBuckets.get(key) ?? 0) + 1)
    }
  }
  const total = png.width * png.height
  const checkerboard = inspectOpaqueCheckerboard(png)
  return {
    alphaCoverage: total ? visible / total : 0,
    opaqueCoverage: total ? opaque / total : 0,
    transparentCoverage: total ? transparent / total : 0,
    translucentCoverage: total ? translucent / total : 0,
    whiteBackgroundCoverage: total ? whiteOpaque / total : 0,
    edgeTouchRate: png.width + png.height ? edgeVisible / (png.width * 2 + png.height * 2) : 0,
    colorComplexity: colorBuckets.size,
    dominantColors: Array.from(colorBuckets.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([key]) => bucketToHex(key)),
    contentBounds: findContentBounds(png),
    checkerboardCoverage: checkerboard.coverage,
    checkerboardScale: checkerboard.scale,
  }
}

function inspectOpaqueCheckerboard(png) {
  const scales = [4, 6, 8, 12, 16, 24, 32].filter(
    (scale) => png.width >= scale * 5 && png.height >= scale * 5,
  )
  let best = { coverage: 0, scale: undefined }
  for (const scale of scales) {
    const horizontal = checkerDirectionScore(png, scale, scale, 0)
    const vertical = checkerDirectionScore(png, scale, 0, scale)
    const coverage = Math.min(horizontal, vertical)
    if (coverage > best.coverage) best = { coverage, scale }
  }
  return best
}

function checkerDirectionScore(png, scale, deltaX, deltaY) {
  const step = Math.max(1, Math.floor(Math.min(png.width, png.height) / 256))
  const limitX = png.width - deltaX * 2
  const limitY = png.height - deltaY * 2
  let matches = 0
  let samples = 0
  for (let y = 0; y < limitY; y += step) {
    for (let x = 0; x < limitX; x += step) {
      samples += 1
      const first = neutralOpaqueIntensity(png, x, y)
      const adjacent = neutralOpaqueIntensity(png, x + deltaX, y + deltaY)
      const repeated = neutralOpaqueIntensity(png, x + deltaX * 2, y + deltaY * 2)
      if (first === undefined || adjacent === undefined || repeated === undefined) continue
      if (Math.abs(first - adjacent) >= 10 && Math.abs(first - repeated) <= 7) matches += 1
    }
  }
  return samples ? matches / samples : 0
}

function neutralOpaqueIntensity(png, x, y) {
  const offset = (y * png.width + x) * 4
  const r = png.data[offset]
  const g = png.data[offset + 1]
  const b = png.data[offset + 2]
  const a = png.data[offset + 3]
  if (a < 247 || Math.max(r, g, b) - Math.min(r, g, b) > 8) return undefined
  const intensity = (r + g + b) / 3
  return intensity >= 145 ? intensity : undefined
}

function bucketToHex(key) {
  return `#${key
    .split(',')
    .map((value) => ((Number(value) << 4) + 8).toString(16).padStart(2, '0'))
    .join('')}`
}

function findContentBounds(png) {
  let minX = png.width
  let minY = png.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (png.data[(y * png.width + x) * 4 + 3] <= 8) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX < minX
    ? fullBounds(png)
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function fullBounds(png) {
  return { x: 0, y: 0, width: png.width, height: png.height }
}

function fitBoundsToRatio(bounds, imageWidth, imageHeight, targetRatio) {
  let { x, y, width, height } = bounds
  const ratio = width / height
  if (ratio < targetRatio) {
    const nextWidth = Math.min(imageWidth, Math.ceil(height * targetRatio))
    x = clamp(Math.round(x - (nextWidth - width) / 2), 0, imageWidth - nextWidth)
    width = nextWidth
  } else if (ratio > targetRatio) {
    const nextHeight = Math.min(imageHeight, Math.ceil(width / targetRatio))
    y = clamp(Math.round(y - (nextHeight - height) / 2), 0, imageHeight - nextHeight)
    height = nextHeight
  }
  return { x, y, width, height }
}

function resizeBilinear(source, bounds, width, height) {
  const output = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    const sourceY = bounds.y + ((y + 0.5) * bounds.height) / height - 0.5
    const y0 = clamp(Math.floor(sourceY), bounds.y, bounds.y + bounds.height - 1)
    const y1 = Math.min(bounds.y + bounds.height - 1, y0 + 1)
    const yWeight = clamp(sourceY - y0, 0, 1)
    for (let x = 0; x < width; x += 1) {
      const sourceX = bounds.x + ((x + 0.5) * bounds.width) / width - 0.5
      const x0 = clamp(Math.floor(sourceX), bounds.x, bounds.x + bounds.width - 1)
      const x1 = Math.min(bounds.x + bounds.width - 1, x0 + 1)
      const xWeight = clamp(sourceX - x0, 0, 1)
      const targetOffset = (y * width + x) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        const top = mix(pixel(source, x0, y0, channel), pixel(source, x1, y0, channel), xWeight)
        const bottom = mix(pixel(source, x0, y1, channel), pixel(source, x1, y1, channel), xWeight)
        output.data[targetOffset + channel] = Math.round(mix(top, bottom, yWeight))
      }
    }
  }
  return output
}

function containWithTransparentPadding(source, bounds, width, height) {
  const scale = Math.min(width / bounds.width, height / bounds.height)
  const contentWidth = Math.max(1, Math.round(bounds.width * scale))
  const contentHeight = Math.max(1, Math.round(bounds.height * scale))
  const resized = resizeBilinear(source, bounds, contentWidth, contentHeight)
  const output = new PNG({ width, height, fill: false })
  const offsetX = Math.floor((width - contentWidth) / 2)
  const offsetY = Math.floor((height - contentHeight) / 2)
  for (let y = 0; y < contentHeight; y += 1) {
    const sourceStart = y * contentWidth * 4
    const targetStart = ((offsetY + y) * width + offsetX) * 4
    resized.data.copy(output.data, targetStart, sourceStart, sourceStart + contentWidth * 4)
  }
  return output
}

function pixel(png, x, y, channel) {
  return png.data[(y * png.width + x) * 4 + channel]
}
function mix(left, right, weight) {
  return left + (right - left) * weight
}

function positiveRatio(width, height) {
  return Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : undefined
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}
