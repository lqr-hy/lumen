import { expect, test } from '@playwright/test'

/**
 * 一致性门禁：画布渲染与导出代码渲染必须逐像素接近。
 *
 * 没有这道门禁，即便当前统一了 Render IR，后续改动仍会让两条链路重新分叉 ——
 * 这正是本次重构要解决的原始问题。
 */
const baseURL = process.env.RESPONSIVE_VISUAL_BASE_URL || 'http://127.0.0.1:4173'

test('画布与导出代码像素一致', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', '像素门禁只在固定桌面 Chrome 项目运行。')
  await page.goto(`${baseURL}/__visual__/codegen-parity`)
  await expect(page.locator('[data-parity-fixture]')).toBeVisible()
  const canvas = page.locator('[data-parity-surface="canvas"]')
  const codegen = page.locator('[data-parity-surface="codegen"]')
  await expect(canvas).toBeVisible()
  await expect(codegen).toBeVisible()
  await page.waitForLoadState('networkidle')

  // 两侧截图与同一份基线比对：任一侧漂移都会失败。
  // 字体抗锯齿有固有噪声，阈值不设为 0；但必须收紧到能捕获单个元素级别的
  // 形变（例如圆角从 50% 退化为 0），否则门禁形同虚设。
  const options = {
    animations: 'disabled' as const,
    caret: 'hide' as const,
    maxDiffPixelRatio: 0.004,
    threshold: 0.1,
  }
  await expect(canvas).toHaveScreenshot('parity-surface.png', options)
  await expect(codegen).toHaveScreenshot('parity-surface.png', options)
})
