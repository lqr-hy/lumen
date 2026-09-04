import { expect, test } from '@playwright/test'

test.describe('视觉优化主流程', () => {
  test('可从原稿打开 Brief，并在生成前确认摘要中修改要求', async ({ page }) => {
    await page.goto('/editor/e2e-visual-optimization')

    // 空项目没有画板，先创建一个标准 375×812 画板作为原稿。
    await expect(page.locator('.editor-page')).toBeVisible()
    await page.getByTitle('新增画板').click()
    await expect(page.locator('.artboard').first()).toBeVisible()

    await page.getByRole('button', { name: '视觉优化' }).click()
    const dialog = page.getByRole('dialog', { name: '视觉优化' })
    await expect(dialog).toBeVisible()

    const concept = dialog.locator('input').first()
    await concept.fill('霓虹夜航 · 夏日音乐节')
    await dialog.getByRole('button', { name: '生成视觉新版' }).click()

    // 生成动作会关闭 Brief 弹窗并打开对话面板，摘要是后续 Agent 执行的确认边界。
    await expect(dialog).toBeHidden()
    await expect(page.getByText('生成前确认', { exact: true })).toBeVisible()
    await expect(page.getByText('必须保留', { exact: true })).toBeVisible()
    await expect(page.getByText('重点重设计', { exact: true })).toBeVisible()
    await expect(page.getByText('原画板不会被覆盖', { exact: true })).toBeVisible()

    // 取消本次 Brief 只清除待发送摘要，不应关闭或破坏编辑器。
    await page.getByRole('button', { name: '取消本次视觉优化' }).click()
    await expect(page.getByText('生成前确认', { exact: true })).toHaveCount(0)
    await expect(page.locator('.editor-page')).toBeVisible()
  })

  test('Brief 弹窗打开时会锁定页面滚动，关闭后恢复', async ({ page }) => {
    await page.goto('/editor/e2e-visual-optimization-scroll')
    await page.getByTitle('新增画板').click()
    await page.getByRole('button', { name: '视觉优化' }).click()

    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.overflow))
      .toBe('hidden')
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')

    await page.getByRole('button', { name: '关闭' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe('')
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('')
  })

  test('带 Variant 的项目可打开版本对比并执行删除二次确认', async ({ page }) => {
    // 通过 preload 同名接口注入一个仅供测试使用的已生成项目，避免依赖真实模型。
    await page.addInitScript(() => {
      const now = new Date().toISOString()
      const original = {
        id: 'original',
        name: '活动原稿',
        x: 0,
        y: 0,
        width: 375,
        height: 812,
        background: '#ffffff',
      }
      const variant = {
        id: 'variant-1',
        name: '活动原稿 · 视觉新版',
        x: 420,
        y: 0,
        width: 375,
        height: 812,
        background: '#16131f',
        variantParentArtboardId: 'original',
        variantStatus: 'candidate',
        visualOptimizationBrief: {
          concept: '霓虹夜航',
          targetAudience: '',
          primaryGoal: '',
          pageType: 'campaign',
          density: 'balanced',
          exploration: 'balanced',
          componentSurface: 'tonal',
          layoutRhythm: 'sectioned',
          signatureDescription: '',
          signaturePlacement: 'hero',
          preserve: {
            content: true,
            informationArchitecture: true,
            palette: false,
            brandAssets: true,
            keyJourney: true,
          },
          change: {
            heroComposition: true,
            typography: true,
            componentSurfaces: true,
            decoration: true,
            spacingRhythm: true,
            colorRoles: true,
          },
          paletteRoles: { background: '', surface: '', text: '', mutedText: '', accent: '' },
          antiPatterns: [],
        },
      }
      Object.defineProperty(window, 'aiCampaignProjects', {
        configurable: true,
        value: {
          load: async () => ({
            schemaVersion: 2,
            projectId: 'e2e-variant',
            document: {
              id: 'e2e-variant',
              title: 'Variant 测试项目',
              version: 1,
              viewport: { x: 0, y: 0, zoom: 1 },
              settings: { canvasMode: 'light', gridVisible: true },
              artboards: [original, variant],
              elements: [],
              assets: [],
              createdAt: now,
              updatedAt: now,
            },
            chatThreads: [],
            activeChatThreadId: 'panel-thread-default',
            mutationLedger: [],
            createdAt: now,
            updatedAt: now,
          }),
          save: async () => undefined,
        },
      })
    })
    await page.goto('/editor/e2e-variant')
    await expect(page.locator('.artboard')).toHaveCount(2)
    await page.getByRole('button', { name: '版本对比' }).click()

    const dialog = page.getByRole('dialog', { name: '原稿与视觉新版对比' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('原稿', { exact: true })).toBeVisible()
    await expect(dialog.getByText('视觉新版', { exact: true })).toBeVisible()
    await expect(dialog.getByText('检查通过', { exact: true })).toBeVisible()

    await dialog.getByRole('button', { name: '删除新版' }).click()
    await expect(dialog.getByText('删除新版后仍可通过撤销恢复。')).toBeVisible()
    await expect(dialog.getByRole('button', { name: '确认删除新版' })).toBeVisible()
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog.getByRole('button', { name: '删除新版' })).toBeVisible()

    // 可从新版继续开启 Brief，形成下一代 Variant 的入口。
    await dialog.getByRole('button', { name: '基于新版继续优化' }).click()
    await expect(page.getByRole('dialog', { name: '视觉优化' })).toBeVisible()
    await page.getByRole('button', { name: '关闭' }).click()

    // 再次进入对比并采用当前候选版本。
    await page.getByRole('button', { name: '版本对比' }).click()
    const comparison = page.getByRole('dialog', { name: '原稿与视觉新版对比' })
    await comparison.getByRole('button', { name: '采用新版' }).click()
    await expect(comparison).toBeHidden()
    await page.getByRole('button', { name: '版本对比' }).click()
    await expect(
      page
        .getByRole('dialog', { name: '原稿与视觉新版对比' })
        .getByRole('button', { name: '已采用此版本' }),
    ).toBeVisible()

    const acceptedDialog = page.getByRole('dialog', { name: '原稿与视觉新版对比' })
    await acceptedDialog.getByRole('button', { name: '删除新版' }).click()
    await acceptedDialog.getByRole('button', { name: '确认删除新版' }).click()
    await expect(acceptedDialog).toBeHidden()
    await expect(page.getByRole('button', { name: '版本对比' })).toHaveCount(0)
    await expect(page.locator('.artboard')).toHaveCount(1)
  })

  test('准确文案缺失时会触发质量门禁并阻止采用新版', async ({ page }) => {
    await page.addInitScript(() => {
      const now = new Date().toISOString()
      const brief = {
        concept: '编辑式春日活动',
        targetAudience: '',
        primaryGoal: '',
        pageType: 'campaign',
        density: 'balanced',
        exploration: 'balanced',
        componentSurface: 'quiet',
        layoutRhythm: 'sectioned',
        signatureDescription: '',
        signaturePlacement: 'hero',
        preserve: {
          content: true,
          informationArchitecture: true,
          palette: false,
          brandAssets: true,
          keyJourney: true,
        },
        change: {
          heroComposition: true,
          typography: true,
          componentSurfaces: true,
          decoration: true,
          spacingRhythm: true,
          colorRoles: true,
        },
        paletteRoles: { background: '', surface: '', text: '', mutedText: '', accent: '' },
        antiPatterns: [],
      }
      const base = { x: 0, y: 0, width: 375, height: 812, background: '#fff' }
      const original = { ...base, id: 'copy-source', name: '含文案原稿' }
      const variant = {
        ...base,
        id: 'copy-variant',
        name: '缺失文案新版',
        background: '#111',
        variantParentArtboardId: original.id,
        variantStatus: 'candidate',
        visualOptimizationBrief: brief,
      }
      const text = {
        id: 'required-copy',
        artboardId: original.id,
        type: 'text',
        name: '主标题',
        x: 20,
        y: 20,
        width: 300,
        height: 40,
        zIndex: 1,
        content: '春日音乐节，等你来现场',
        style: { fontSize: 24, color: '#111' },
      }
      Object.defineProperty(window, 'aiCampaignProjects', {
        configurable: true,
        value: {
          load: async () => ({
            schemaVersion: 2,
            projectId: 'e2e-copy-gate',
            document: {
              id: 'e2e-copy-gate',
              title: '文案门禁测试',
              version: 1,
              viewport: { x: 0, y: 0, zoom: 1 },
              settings: { canvasMode: 'light', gridVisible: true },
              artboards: [original, variant],
              elements: [text],
              assets: [],
              createdAt: now,
              updatedAt: now,
            },
            chatThreads: [],
            activeChatThreadId: 'panel-thread-default',
            mutationLedger: [],
            createdAt: now,
            updatedAt: now,
          }),
          save: async () => undefined,
        },
      })
    })
    await page.goto('/editor/e2e-copy-gate')
    await page.getByRole('button', { name: '版本对比' }).click()
    const dialog = page.getByRole('dialog', { name: '原稿与视觉新版对比' })
    await expect(dialog.getByText('需修复', { exact: true })).toBeVisible()
    await expect(dialog.getByText('准确文案未完整保留，修复后才能采用。')).toBeVisible()
    await expect(dialog.getByRole('button', { name: '生成文案修正版' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '采用新版' })).toBeDisabled()
  })
})
