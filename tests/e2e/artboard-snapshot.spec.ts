import { expect, test } from '@playwright/test'
import { PNG } from 'pngjs'

/**
 * 快照链路门禁：`renderArtboardSnapshot` 的位图必须与 DOM 真源一致。
 *
 * 覆盖两个已修复的真实缺陷：
 * 1. 空白图 —— `createRoot().render()` 异步提交，此前只等一个 requestAnimationFrame
 *    就交给光栅化，经常截到空节点，表现为版本对比两侧只剩画板背景色。
 * 2. 字形被裁 —— html2canvas 自行重算文本基线，不处理墨迹溢出行盒的情况。
 *    设计稿大量使用 `lineHeight < 1`（墨迹伸到行盒上方约 8px），整行会被下移并裁掉，
 *    表现为大字号标题底部削平、英文小写字母的下半截缺失。现改用 foreignObject。
 *
 * 逐像素比对同时覆盖这两类：空白图和错位图都无法通过。
 */
const baseURL = process.env.RESPONSIVE_VISUAL_BASE_URL || 'http://127.0.0.1:4173'

test('画板快照与 DOM 渲染逐像素一致', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', '快照门禁只在固定桌面 Chrome 项目运行。')
  await page.goto(`${baseURL}/__visual__/snapshot`)

  const failure = page.locator('[data-snapshot-error]')
  const ready = page.locator('[data-snapshot-fixture="ready"]')
  await expect(ready.or(failure)).toBeVisible({ timeout: 30_000 })
  if (await failure.count()) throw new Error(`快照生成失败：${await failure.textContent()}`)

  const dom = PNG.sync.read(await page.locator('[data-snapshot-surface="dom"]').screenshot())
  const raster = PNG.sync.read(await page.locator('[data-snapshot-surface="raster"]').screenshot())
  expect(raster.width, '快照宽度').toBe(dom.width)
  expect(raster.height, '快照高度').toBe(dom.height)

  // 快照必须真的有内容：空白图能轻易通过"差异小"的判据，先单独排除。
  const colors = new Set<string>()
  for (let index = 0; index < raster.data.length; index += 4)
    colors.add(`${raster.data[index]},${raster.data[index + 1]},${raster.data[index + 2]}`)
  expect(colors.size, '快照颜色种类数（空白图只有 1 种）').toBeGreaterThan(40)

  let different = 0
  for (let y = 0; y < dom.height; y += 1) {
    for (let x = 0; x < dom.width; x += 1) {
      const index = (dom.width * y + x) << 2
      if (
        Math.abs(dom.data[index] - raster.data[index]) > 30 ||
        Math.abs(dom.data[index + 1] - raster.data[index + 1]) > 30 ||
        Math.abs(dom.data[index + 2] - raster.data[index + 2]) > 30
      )
        different += 1
    }
  }
  // 阈值留给文字抗锯齿；字形被裁会造成远大于此的差异（实测约 2%）。
  const ratio = different / (dom.width * dom.height)
  expect(ratio, `快照与 DOM 差异比例（${different} 像素）`).toBeLessThan(0.006)
})
