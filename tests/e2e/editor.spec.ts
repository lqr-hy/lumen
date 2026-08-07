import { expect, test } from '@playwright/test'

test('编辑器能够创建标准画板且无控制台错误', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.route('https://copilot.bilibili.co/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"text":"测试回复"}\n\ndata: [DONE]\n\n',
    })
  })
  await page.goto('/editor/e2e-standard-board')
  await expect(page.locator('.editor-page')).toBeVisible()
  await page.locator('.prompt-rich-editor').first().fill('生成一张活动页面设计稿')
  await page.locator('.prompt-send-button').first().click()
  const artboard = page.locator('.artboard').first()
  await expect(artboard).toBeVisible()
  const bounds = await artboard.boundingBox()
  expect(bounds?.width).toBeGreaterThan(100)
  expect(bounds?.height).toBeGreaterThan(200)
  const screenshot = await page.screenshot({ fullPage: true })
  expect(screenshot.byteLength).toBeGreaterThan(20_000)
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
