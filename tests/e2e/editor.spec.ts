import { expect, test } from '@playwright/test'

test('编辑器能够手动创建标准画板且无控制台错误', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/editor/e2e-standard-board')
  await expect(page.locator('.editor-page')).toBeVisible()
  await page.getByTitle('新增画板').click()
  const artboard = page.locator('.artboard').first()
  await expect(artboard).toBeVisible()
  const logicalSize = await artboard.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return { width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) }
  })
  expect(logicalSize).toEqual({ width: 375, height: 812 })
  const screenshot = await page.screenshot({ fullPage: true })
  expect(screenshot.subarray(1, 4).toString()).toBe('PNG')
  expect(screenshot.byteLength).toBeGreaterThan(5_000)
  expect(errors).toEqual([])
  await testInfo.attach('editor', { body: screenshot, contentType: 'image/png' })
})

test('聊天面板和画布在窄视口下不发生横向溢出', async ({ page }) => {
  await page.goto('/editor/e2e-mobile-layout')
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
  const viewportWidth = page.viewportSize()?.width ?? 0
  expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1)
  await expect(page.locator('.editor-page')).toBeVisible()
})
