// 视觉方向发散测试：断言设计语言包驱动材质 Token、分轴 Direction/Range 可独立表达，
// 以及旧 Brief 迁移后仍可编译。通过 esbuild 就地编译 TS，避免维护第二份实现。
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const outDir = await mkdtemp(path.join(tmpdir(), 'visual-brief-'))
const outfile = path.join(outDir, 'visual-brief.mjs')
await build({
  entryPoints: ['src/features/editor/utils/visual-brief.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile,
  logLevel: 'silent',
})
const mod = await import(outfile)
const {
  BUILTIN_VISUAL_BRIEF_TEMPLATES,
  DEFAULT_VISUAL_REDESIGN_BRIEF,
  DESIGN_LANGUAGES,
  VISUAL_AXIS_DEFINITIONS,
  buildVisualNormalizationPatches,
  buildVisualAssetPlan,
  compileVisualDirectionPrompt,
  compileVisualRedesignPrompt,
  findDesignLanguage,
  normalizeVisualRedesignBrief,
  summarizeVisualRedesignBrief,
} = mod

const artboard = { id: 'board', name: '活动页', x: 0, y: 0, width: 375, height: 812 }
function brief(overrides = {}) {
  return { ...structuredClone(DEFAULT_VISUAL_REDESIGN_BRIEF), ...overrides }
}

// 9. 图片策略必须编译为可执行资产计划，Hero 不得占满长画板。
{
  const none = buildVisualAssetPlan(brief({ imagery: 'none' }), artboard)
  assert.equal(none.items.length, 0)
  const hero = buildVisualAssetPlan(brief({ imagery: 'hero' }), artboard)
  assert.equal(hero.items.length, 1)
  assert.equal(hero.items[0].role, 'hero')
  assert.ok(hero.items[0].targetSize.height < artboard.height * 0.8)
  const content = buildVisualAssetPlan(brief({ imagery: 'hero-and-content' }), artboard)
  assert.deepEqual(content.items.map((item) => item.id), ['hero', 'content-image-1', 'content-image-2'])
}

// 1. 设计语言必须真正互不相同。只换配色不算不同语言。
{
  assert.ok(DESIGN_LANGUAGES.length >= 6, '至少提供 6 种设计语言')
  const ids = new Set(DESIGN_LANGUAGES.map((language) => language.id))
  assert.equal(ids.size, DESIGN_LANGUAGES.length, '设计语言 id 不能重复')
  const depthModels = new Set(DESIGN_LANGUAGES.map((language) => language.tokens.depthModel))
  assert.equal(depthModels.size, DESIGN_LANGUAGES.length, '每种语言的深度模型必须不同')
  // 必须同时存在"用投影"和"不用投影"的语言，否则仍然是单一审美。
  assert.ok(
    DESIGN_LANGUAGES.some((language) => language.tokens.shadow === null),
    '必须存在不使用投影的设计语言',
  )
  assert.ok(
    DESIGN_LANGUAGES.some((language) => language.tokens.shadow !== null),
    '必须存在使用投影的设计语言',
  )
}

// 2. 从零生成的 prompt 必须随设计语言变化。
// 回归：此前 compileVisualDirectionPrompt 无条件注入"硬阴影 8/8/0、圆角不超过 8px"，
// 所有模板产出同一套视觉，这是"视觉优化很单调"的直接原因。
{
  const brutal = compileVisualDirectionPrompt(brief({ designLanguage: 'neo-brutalist' }))
  const soft = compileVisualDirectionPrompt(brief({ designLanguage: 'soft-depth' }))
  const flat = compileVisualDirectionPrompt(brief({ designLanguage: 'flat-geometric' }))
  assert.notEqual(brutal, soft, '不同设计语言必须编译出不同 prompt')
  assert.notEqual(soft, flat, '不同设计语言必须编译出不同 prompt')

  assert.match(brutal, /圆角不超过 8px/)
  assert.match(brutal, /blur=0/)
  assert.match(soft, /圆角不超过 16px/)
  assert.match(soft, /blur=32/)
  assert.match(flat, /完全不使用投影/)
  assert.match(flat, /不使用描边/)

  // 硬编码那句必须彻底消失，否则柔性层叠会同时收到两套冲突约束。
  for (const prompt of [soft, flat]) {
    assert.doesNotMatch(prompt, /使用硬阴影（x=8、y=8、blur=0）/, '不得残留全局硬编码 Token')
  }

  // auto 表示不施加材质约束。
  const auto = compileVisualDirectionPrompt(brief({ designLanguage: 'auto' }))
  assert.doesNotMatch(auto, /设计语言：/, 'auto 不注入设计语言契约')
}

// 3. 分轴 Direction + Range 必须能独立表达"构图大胆、配色克制"。
{
  const prompt = compileVisualRedesignPrompt(
    brief({
      axes: {
        ...DEFAULT_VISUAL_REDESIGN_BRIEF.axes,
        heroComposition: { direction: '全幅沉浸', range: 'extreme' },
        colorRoles: { direction: 'keep', range: 'subtle' },
      },
    }),
    artboard,
  )
  assert.match(prompt, /首屏构图：方向为「全幅沉浸」，幅度强烈/)
  assert.match(prompt, /颜色角色：保持不变/)

  // 同一 Brief 换任意一条轴，prompt 必须随之变化——否则分轴形同虚设。
  const other = compileVisualRedesignPrompt(
    brief({
      axes: {
        ...DEFAULT_VISUAL_REDESIGN_BRIEF.axes,
        heroComposition: { direction: '居中对称', range: 'subtle' },
        colorRoles: { direction: 'keep', range: 'subtle' },
      },
    }),
    artboard,
  )
  assert.notEqual(prompt, other, '改动单条轴必须改变编译结果')
}

// 4. 六条轴全部 keep 时不产出任何变化指令。文案修复路径依赖这个性质。
{
  const axes = Object.fromEntries(
    VISUAL_AXIS_DEFINITIONS.map(({ key }) => [key, { direction: 'keep', range: 'subtle' }]),
  )
  const summary = summarizeVisualRedesignBrief(brief({ axes }))
  assert.deepEqual(summary.change, [], '全部 keep 时不应有重设计项')
}

// 5. 旧 Brief 迁移：只有 exploration + 布尔 change，没有 axes/designLanguage。
{
  const legacy = {
    ...structuredClone(DEFAULT_VISUAL_REDESIGN_BRIEF),
    exploration: 'bold',
    change: {
      heroComposition: true,
      typography: false,
      componentSurfaces: true,
      decoration: false,
      spacingRhythm: true,
      colorRoles: true,
    },
  }
  delete legacy.axes
  delete legacy.designLanguage

  const migrated = normalizeVisualRedesignBrief(legacy)
  assert.equal(migrated.designLanguage, 'auto', '旧 Brief 迁移为 auto，不强加审美')
  // change 关闭的轴语义就是"不要动"。
  assert.equal(migrated.axes.typography.direction, 'keep')
  assert.equal(migrated.axes.decoration.direction, 'keep')
  // 开启的轴继承 exploration 幅度。
  assert.equal(migrated.axes.heroComposition.direction, 'auto')
  assert.equal(migrated.axes.heroComposition.range, 'extreme')

  const conservative = normalizeVisualRedesignBrief({
    ...legacy,
    exploration: 'conservative',
    axes: undefined,
  })
  assert.equal(conservative.axes.heroComposition.range, 'subtle')

  // 迁移后必须可以直接编译，不抛错。
  assert.ok(compileVisualRedesignPrompt(migrated, artboard).length > 0)
}

// 6. 内置模板必须绑定不同设计语言，否则模板之间仍然产出同一套视觉。
{
  const languages = BUILTIN_VISUAL_BRIEF_TEMPLATES.map((template) => template.patch.designLanguage)
  assert.equal(new Set(languages).size, languages.length, '每个内置模板必须绑定不同设计语言')
  for (const template of BUILTIN_VISUAL_BRIEF_TEMPLATES) {
    assert.ok(
      findDesignLanguage(template.patch.designLanguage),
      `${template.id} 绑定了未知设计语言`,
    )
    assert.ok(template.patch.axes, `${template.id} 必须给出分轴方向`)
  }
  // 两个模板编译出的 prompt 必须实质不同。
  const compiled = BUILTIN_VISUAL_BRIEF_TEMPLATES.map((template) =>
    compileVisualDirectionPrompt(brief(template.patch)),
  )
  assert.equal(new Set(compiled).size, compiled.length, '内置模板必须编译出彼此不同的 prompt')
}

// 7. 归一化按设计语言取基准，并让 Style Pack 覆盖优先。
{
  const document = {
    elements: [
      {
        id: 'card',
        artboardId: 'board',
        type: 'shape',
        name: '卡片',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        zIndex: 1,
        borderRadius: 24,
        strokeWidth: 6,
        shadow: { x: 0, y: 20, blur: 40, color: 'rgba(0,0,0,0.5)' },
      },
    ],
  }

  // 新粗野：压到 8/3 并改写为硬阴影。
  const brutal = buildVisualNormalizationPatches(document, 'board', 'neo-brutalist')
  assert.equal(brutal[0].patch.borderRadius, 8)
  assert.equal(brutal[0].patch.strokeWidth, 3)
  assert.equal(brutal[0].patch.shadow.blur, 0)

  // 柔性层叠：允许 16 圆角，投影改为柔性而非硬边。
  const soft = buildVisualNormalizationPatches(document, 'board', 'soft-depth')
  assert.equal(soft[0].patch.borderRadius, 16)
  assert.equal(soft[0].patch.shadow.blur, 32)

  // 平面几何不使用投影：必须移除而不是改写成一个它本不该有的投影。
  const flat = buildVisualNormalizationPatches(document, 'board', 'flat-geometric')
  assert.equal(flat[0].patch.shadow, undefined, '无投影语言应移除投影')
  assert.equal(flat[0].patch.strokeWidth, 0)

  // 回归：Style Pack 声明 radius=12 时，此前被常量 8 压掉。
  const overridden = buildVisualNormalizationPatches(document, 'board', 'neo-brutalist', {
    cornerRadius: 12,
  })
  assert.equal(overridden[0].patch.borderRadius, 12, 'Style Pack 的 radius 必须优先于设计语言')

  // 边界不变：锁定、组件绑定和 page-shell 节点不参与归一化。
  const guarded = {
    elements: [
      { ...document.elements[0], id: 'locked', locked: true },
      { ...document.elements[0], id: 'bound', componentBinding: { instanceId: 'i' } },
      { ...document.elements[0], id: 'shell', designRole: 'page-shell' },
    ],
  }
  assert.deepEqual(buildVisualNormalizationPatches(guarded, 'board', 'soft-depth'), [])
}

// 8. 默认 antiPatterns 不得包含材质类禁止项，否则与部分设计语言冲突。
{
  assert.ok(
    !DEFAULT_VISUAL_REDESIGN_BRIEF.antiPatterns.includes('模糊投影'),
    '材质类禁止项应由设计语言包提供，不能写在全局默认里',
  )
  const softLanguage = findDesignLanguage('soft-depth')
  const prompt = compileVisualDirectionPrompt(brief({ designLanguage: 'soft-depth' }))
  // 柔性层叠依赖模糊投影，全局禁止项若残留会自相矛盾。
  assert.ok(softLanguage.tokens.shadow.blur > 0)
  assert.doesNotMatch(prompt, /禁止出现：[^\n]*模糊投影/)
}

await rm(outDir, { recursive: true, force: true })
console.log('visual brief tests passed')
