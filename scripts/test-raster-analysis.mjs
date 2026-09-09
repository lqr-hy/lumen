import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import {
  analyzeRaster,
  compositeRasterWithMask,
  normalizeRasterForTarget,
} from '../electron/runtime/raster-analysis.mjs'
import { normalizeRasterForTargetAsync } from '../electron/runtime/raster-worker-client.mjs'

const source = new PNG({ width: 100, height: 100 })
for (let y = 25; y < 75; y += 1) {
  for (let x = 10; x < 90; x += 1) {
    const offset = (y * 100 + x) * 4
    source.data[offset] = 248
    source.data[offset + 1] = 184
    source.data[offset + 2] = 24
    source.data[offset + 3] = 255
  }
}
const buffer = PNG.sync.write(source)
const before = analyzeRaster(buffer, 'image/png', { width: 180, height: 64 })
assert(before.alphaCoverage > 0.35 && before.alphaCoverage < 0.45)
assert(before.transparentCoverage > 0.55 && before.transparentCoverage < 0.65)
assert.equal(before.translucentCoverage, 0)
assert(before.dominantColors.some((color) => /^#f8b8/.test(color)))

const jpegPixels = Buffer.alloc(24 * 24 * 4)
for (let index = 0; index < 24 * 24; index += 1) {
  const offset = index * 4
  jpegPixels[offset] = 238
  jpegPixels[offset + 1] = 35
  jpegPixels[offset + 2] = 96
  jpegPixels[offset + 3] = 255
}
const jpegBuffer = jpeg.encode({ width: 24, height: 24, data: jpegPixels }, 90).data
const jpegAnalysis = analyzeRaster(jpegBuffer, 'image/jpeg')
assert.equal(jpegAnalysis.width, 24)
assert.equal(jpegAnalysis.height, 24)
assert(jpegAnalysis.dominantColors.some((color) => /^#e8285/.test(color)))
const normalized = normalizeRasterForTarget(
  buffer,
  'image/png',
  { width: 180, height: 64 },
  { transparent: true },
)
assert.equal(normalized.analysis.width, 180)
assert.equal(normalized.analysis.height, 64)
assert(normalized.analysis.ratioError < 0.001)
assert(normalized.analysis.source.ratioError > 0.6)
assert.equal(normalized.analysis.transform.mode, 'contain')
const sourceContentRatio =
  normalized.analysis.source.contentBounds.width / normalized.analysis.source.contentBounds.height
const normalizedContentRatio =
  normalized.analysis.contentBounds.width / normalized.analysis.contentBounds.height
assert(Math.abs(normalizedContentRatio - sourceContentRatio) < 0.05)
assert((normalized.analysis.source.checkerboardCoverage ?? 0) < 0.025)
const filledOverlay = normalizeRasterForTarget(
  buffer,
  'image/png',
  { width: 180, height: 64 },
  { transparent: true, fitMode: 'fill-content' },
)
assert.equal(filledOverlay.analysis.transform.mode, 'fill-content')
assert.equal(filledOverlay.analysis.contentBounds.width, 180)
assert.equal(filledOverlay.analysis.contentBounds.height, 64)

// 非透明 cover 路径必须真正居中裁剪。放大再 clamp 会被图片边界挡回原尺寸，
// 让 resize 变成非等比拉伸：正圆会被压成椭圆，而归一化后的 ratioError 恒为 0，
// 门禁完全看不见。这里用正圆直接验证几何不失真。
const circleSource = new PNG({ width: 1024, height: 1536 })
for (let y = 0; y < circleSource.height; y += 1) {
  for (let x = 0; x < circleSource.width; x += 1) {
    const offset = (y * circleSource.width + x) * 4
    const inside = Math.hypot(x - 512, y - 768) < 140
    circleSource.data.set(inside ? [255, 255, 255, 255] : [20, 20, 20, 255], offset)
  }
}
const circleBuffer = PNG.sync.write(circleSource)
for (const target of [
  { width: 375, height: 812 },
  { width: 375, height: 1600 },
]) {
  const covered = normalizeRasterForTarget(circleBuffer, 'image/png', target, {
    transparent: false,
  })
  assert.equal(covered.analysis.transform.mode, 'cover')
  const targetRatio = target.width / target.height
  const bounds = covered.analysis.transform.sourceBounds
  // 裁剪后的取样框比例必须等于目标比例，否则 resize 就是非等比拉伸。
  assert(
    Math.abs(bounds.width / bounds.height - targetRatio) / targetRatio < 0.01,
    `裁剪框必须匹配目标比例：${JSON.stringify(bounds)}`,
  )
  assert(bounds.width <= circleSource.width && bounds.height <= circleSource.height)
  const output = PNG.sync.read(covered.buffer)
  let minX = Infinity
  let maxX = -1
  let minY = Infinity
  let maxY = -1
  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      if (output.data[(y * output.width + x) * 4] > 200) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const circleAspect = (maxX - minX + 1) / (maxY - minY + 1)
  assert(
    Math.abs(circleAspect - 1) < 0.06,
    `正圆不得被拉伸成椭圆，实测 aspect=${circleAspect.toFixed(3)}`,
  )
  assert(covered.analysis.transform.cropLoss > 0 && covered.analysis.transform.cropLoss < 1)
}
// 比例一致时不应产生任何裁切损失。
const exactRatio = normalizeRasterForTarget(
  circleBuffer,
  'image/png',
  { width: 512, height: 768 },
  { transparent: false },
)
assert.equal(exactRatio.analysis.transform.cropLoss, 0)

const fakeTransparent = new PNG({ width: 96, height: 96 })
for (let y = 0; y < fakeTransparent.height; y += 1) {
  for (let x = 0; x < fakeTransparent.width; x += 1) {
    const offset = (y * fakeTransparent.width + x) * 4
    const value = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 248 : 216
    fakeTransparent.data[offset] = value
    fakeTransparent.data[offset + 1] = value
    fakeTransparent.data[offset + 2] = value
    fakeTransparent.data[offset + 3] = 255
  }
}
const fakeAnalysis = analyzeRaster(PNG.sync.write(fakeTransparent), 'image/png', {
  width: 96,
  height: 96,
})
assert(fakeAnalysis.checkerboardCoverage > 0.5)
assert.equal(fakeAnalysis.checkerboardScale, 8)
assert.equal(fakeAnalysis.transparentCoverage, 0)
const workerNormalized = await normalizeRasterForTargetAsync(
  buffer,
  'image/png',
  { width: 180, height: 64 },
  { transparent: true },
)
assert.equal(workerNormalized.buffer.equals(normalized.buffer), true)
assert.deepEqual(workerNormalized.analysis, normalized.analysis)

const chromaSource = solidPng(80, 40, [0, 255, 0, 255])
for (let y = 8; y < 32; y += 1) {
  for (let x = 12; x < 68; x += 1) {
    chromaSource.data.set([40, 96, 224, 255], (y * 80 + x) * 4)
  }
}
const chromaNormalized = normalizeRasterForTarget(
  PNG.sync.write(chromaSource),
  'image/png',
  { width: 160, height: 48 },
  { transparent: true, chromaKey: '#00ff00' },
)
assert.equal(chromaNormalized.analysis.chromaKey.applied, true)
assert(chromaNormalized.analysis.source.transparentCoverage > 0.5)
assert(chromaNormalized.analysis.normalized.transparentCoverage > 0.2)

const controller = new AbortController()
controller.abort()
await assert.rejects(
  normalizeRasterForTargetAsync(
    buffer,
    'image/png',
    { width: 180, height: 64 },
    { signal: controller.signal },
  ),
  (error) => error?.name === 'AbortError',
)

const base = solidPng(4, 4, [255, 0, 0, 255])
const generatedEdit = solidPng(4, 4, [0, 0, 255, 255])
const mask = solidPng(4, 4, [0, 0, 0, 255])
for (let y = 1; y < 3; y += 1) {
  for (let x = 1; x < 3; x += 1) mask.data[(y * 4 + x) * 4 + 3] = 0
}
const composited = compositeRasterWithMask(
  PNG.sync.write(base),
  'image/png',
  PNG.sync.write(generatedEdit),
  PNG.sync.write(mask),
  { width: 4, height: 4 },
)
const compositedPng = PNG.sync.read(composited.buffer)
assert.deepEqual([...compositedPng.data.slice(0, 4)], [255, 0, 0, 255])
assert.deepEqual(
  [...compositedPng.data.slice((1 * 4 + 1) * 4, (1 * 4 + 1) * 4 + 4)],
  [0, 0, 255, 255],
)
assert.equal(composited.analysis.preservedPixels, 12)
assert.equal(composited.analysis.editedPixels, 4)
await assert.rejects(
  normalizeRasterForTargetAsync(buffer, 'image/png', { width: 180, height: 64 }, { timeoutMs: 1 }),
  (error) => error?.name === 'RasterWorkerTimeoutError',
)

console.log(
  JSON.stringify(
    {
      pixelAnalysis: true,
      targetNormalization: true,
      editableOverlayFill: true,
      dominantColors: true,
      jpegDominantColors: true,
      workerNormalization: true,
      workerCancellation: true,
      workerTimeout: true,
      fakeTransparencyDetection: true,
      chromaKeyTransparency: true,
      maskOutsidePixelsPreserved: true,
      coverCropsWithoutDistortion: true,
      cropLossReported: true,
    },
    null,
    2,
  ),
)

function solidPng(width, height, color) {
  const png = new PNG({ width, height })
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data.set(color, offset)
  }
  return png
}
