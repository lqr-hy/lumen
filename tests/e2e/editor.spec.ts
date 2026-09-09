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

test('右侧属性面板仅在选择画板或图层后显示', async ({ page }) => {
  await page.goto('/editor/e2e-inspector-selection')
  await expect(page.locator('.editor-page')).toBeVisible()
  await expect(page.locator('.inspector-panel')).toHaveCount(0)

  await page.getByTitle('新增画板').click()
  await expect(page.locator('.inspector-panel')).toBeVisible()
  await expect(page.locator('.editor-workbench')).toHaveClass(/panels-both/)

  const artboard = page.locator('.artboard').first()
  const artboardBeforePanelToggle = await artboard.boundingBox()
  expect(artboardBeforePanelToggle).not.toBeNull()
  await page.getByTitle('隐藏左侧面板').click()
  await expect(page.locator('.editor-workbench')).toHaveClass(/panels-right/)
  await expect
    .poll(async () => (await artboard.boundingBox())?.x)
    .toBeCloseTo(artboardBeforePanelToggle!.x, 0)
  await page.getByTitle('显示左侧面板').click()
  await expect(page.locator('.editor-workbench')).toHaveClass(/panels-both/)
  await expect
    .poll(async () => (await artboard.boundingBox())?.x)
    .toBeCloseTo(artboardBeforePanelToggle!.x, 0)

  await page.getByTitle('隐藏全部面板').click()
  await expect(page.locator('.editor-workbench')).toHaveClass(/panels-none/)
  await expect
    .poll(async () => (await artboard.boundingBox())?.x)
    .toBeCloseTo(artboardBeforePanelToggle!.x, 0)
  await page.getByTitle('展示全部面板').click()
  await expect(page.locator('.editor-workbench')).toHaveClass(/panels-both/)
  await expect
    .poll(async () => (await artboard.boundingBox())?.x)
    .toBeCloseTo(artboardBeforePanelToggle!.x, 0)

  await page.locator('.editor-viewport').click({ position: { x: 8, y: 8 } })
  await expect(page.locator('.inspector-panel')).toHaveCount(0)
  await expect(page.locator('.editor-workbench')).toHaveClass(/panels-left/)

  await page
    .locator('.artboard')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await expect(page.locator('.inspector-panel')).toBeVisible()
  await expect(page.locator('.editor-workbench')).toHaveClass(/panels-both/)
})

test('多画板项目仅挂载视口附近和活动画板', async ({ page }) => {
  await page.goto(`/editor/e2e-canvas-culling-${Date.now()}`)
  await expect(page.locator('.editor-page')).toBeVisible()

  for (let index = 0; index < 16; index += 1) {
    await page.getByTitle('新增画板').click()
    await page.getByTitle('形状').click()
  }

  const canvasWorld = page.locator('.canvas-world')
  await expect(page.locator('.layer-panel .layer-artboard')).toHaveCount(16)
  await expect
    .poll(async () => Number(await canvasWorld.getAttribute('data-rendered-artboard-count')))
    .toBeLessThan(16)
  await expect
    .poll(async () => Number(await canvasWorld.getAttribute('data-rendered-element-count')))
    .toBeLessThan(16)

  const renderedCount = Number(await canvasWorld.getAttribute('data-rendered-artboard-count'))
  expect(renderedCount).toBeGreaterThanOrEqual(1)
  expect(
    Number(await canvasWorld.getAttribute('data-rendered-element-count')),
  ).toBeGreaterThanOrEqual(1)
  await expect(page.locator('.artboard.active')).toHaveCount(1)
})

test('节点拖拽使用合成层预览并在松手后提交坐标', async ({ page }) => {
  await page.goto(`/editor/e2e-direct-drag-${Date.now()}`)
  await expect(page.locator('.editor-page')).toBeVisible()
  await page.getByTitle('新增画板').click()
  await page.getByTitle('形状').click()

  const element = page.locator('[data-element-id]').first()
  const bounds = await element.boundingBox()
  expect(bounds).not.toBeNull()
  const beforeLeft = await element.evaluate((node) => node.style.left)

  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 90, bounds!.y + bounds!.height / 2 + 45, {
    steps: 8,
  })

  await expect.poll(() => element.getAttribute('data-drag-preview')).toBe('true')
  expect(await element.evaluate((node) => node.style.left)).toBe(beforeLeft)
  expect(await element.evaluate((node) => node.style.transform)).toContain('translate3d')

  await page.mouse.up()
  await expect.poll(() => element.evaluate((node) => node.style.left)).not.toBe(beforeLeft)
  await expect(element).not.toHaveAttribute('data-drag-preview', 'true')
})

test('图片属性面板支持上传本地图片并撤销替换', async ({ page }) => {
  const firstPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3MxZ5wAAAABJRU5ErkJggg==',
    'base64',
  )
  const secondPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lRmpWQAAAABJRU5ErkJggg==',
    'base64',
  )

  await page.goto(`/editor/e2e-image-upload-${Date.now()}`)
  await page.getByTitle('新增画板').click()
  await page.locator('.editor-toolbar input[type="file"]').setInputFiles({
    name: 'first.png',
    mimeType: 'image/png',
    buffer: firstPng,
  })

  const preview = page.locator('.inspector-image-preview img')
  const imageInput = page.locator('.inspector-image-file-input')
  await expect(page.getByRole('button', { name: '替换图片' })).toBeVisible()
  await expect(preview).toHaveAttribute('src', /^data:image\/png;base64,/)
  const firstSrc = await preview.getAttribute('src')

  await imageInput.setInputFiles({
    name: 'second.png',
    mimeType: 'image/png',
    buffer: secondPng,
  })
  await expect.poll(() => preview.getAttribute('src')).not.toBe(firstSrc)

  await page.keyboard.press('Control+z')
  await page.locator('.layer-item').filter({ hasText: 'first.png' }).click()
  await expect(preview).toHaveAttribute('src', firstSrc!)
})

test('左右面板支持拖拽、键盘调整和双击复位宽度', async ({ page }) => {
  await page.goto(`/editor/e2e-panel-resize-${Date.now()}`)
  await page.getByTitle('新增画板').click()

  const workbench = page.locator('.editor-workbench')
  const leftHandle = page.getByRole('separator', { name: '调整左侧图层面板宽度' })
  const rightHandle = page.getByRole('separator', { name: '调整右侧属性面板宽度' })
  await expect(leftHandle).toHaveAttribute('aria-valuenow', '246')
  await expect(rightHandle).toHaveAttribute('aria-valuenow', '316')
  const artboardBeforeResize = await page.locator('.artboard').first().boundingBox()
  expect(artboardBeforeResize).not.toBeNull()

  const leftBounds = await leftHandle.boundingBox()
  expect(leftBounds).not.toBeNull()
  await page.mouse.move(leftBounds!.x + 4, leftBounds!.y + 80)
  await page.mouse.down()
  await page.mouse.move(leftBounds!.x + 64, leftBounds!.y + 80, { steps: 4 })
  await page.mouse.up()
  await expect(leftHandle).toHaveAttribute('aria-valuenow', '306')
  await expect(page.locator('.editor-toolbar')).toHaveCSS('left', '312px')
  const artboardAfterResize = await page.locator('.artboard').first().boundingBox()
  expect(artboardAfterResize).not.toBeNull()
  expect(Math.abs(artboardAfterResize!.x - artboardBeforeResize!.x)).toBeLessThanOrEqual(1)
  await expect
    .poll(() =>
      workbench.evaluate((node) =>
        getComputedStyle(node).getPropertyValue('--left-panel-width').trim(),
      ),
    )
    .toBe('306px')

  await rightHandle.focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(rightHandle).toHaveAttribute('aria-valuenow', '348')

  await leftHandle.dblclick({ position: { x: 4, y: 80 } })
  await expect(leftHandle).toHaveAttribute('aria-valuenow', '246')
  await expect(page.locator('.editor-toolbar')).toHaveCSS('left', '252px')
  await expect(page.getByTitle('撤销')).toHaveCount(0)
  await expect(page.getByTitle('重做')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem('lumen:panel-widths:v1') ?? '{}'),
      ),
    )
    .toEqual({ left: 246, right: 348 })

  await page.reload()
  await expect
    .poll(() =>
      workbench.evaluate((node) =>
        getComputedStyle(node).getPropertyValue('--right-panel-width').trim(),
      ),
    )
    .toBe('348px')
})
