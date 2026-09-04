import { _electron as electron, expect, test } from '@playwright/test'

const breakpoints = ['mobile', 'tablet', 'desktop'] as const
const baseURL = process.env.RESPONSIVE_VISUAL_BASE_URL || 'http://127.0.0.1:4173'
const screenshotOptions = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  maxDiffPixelRatio: 0.005,
  threshold: 0.2,
}

test('Chrome 响应式 DesignSpec 像素基线', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', '像素基线只在固定桌面 Chrome 项目运行。')
  await page.goto(`${baseURL}/__visual__/responsive`)
  await expect(page.locator('[data-visual-fixture]')).toBeVisible()
  for (const breakpoint of breakpoints) {
    await expect(page.locator(`[data-breakpoint="${breakpoint}"]`)).toHaveScreenshot(
      `responsive-${breakpoint}-chrome.png`,
      screenshotOptions,
    )
  }
})

test('Electron 响应式 DesignSpec 像素基线', async ({ browserName }, testInfo) => {
  void browserName
  test.skip(testInfo.project.name !== 'desktop-chrome', '像素基线只在固定桌面 Chrome 项目运行。')
  const electronApp = await electron.launch({
    args: ['electron/main.mjs'],
    env: { ...process.env, VITE_DEV_SERVER_URL: baseURL },
  })
  try {
    const window = await electronApp.firstWindow()
    await window.goto(`${baseURL}/#/__visual__/responsive`)
    await expect(window.locator('[data-visual-fixture]')).toBeVisible()
    for (const breakpoint of breakpoints) {
      await expect(window.locator(`[data-breakpoint="${breakpoint}"]`)).toHaveScreenshot(
        `responsive-${breakpoint}-electron.png`,
        screenshotOptions,
      )
    }
  } finally {
    await electronApp.close()
  }
})
