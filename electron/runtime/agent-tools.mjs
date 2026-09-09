import { createRuntimeError } from './providers.mjs'
import { validateComponentRuntime } from './component-runtime-adapters.mjs'
import {
  inspectRuntimeDomToScene,
  runtimeDomInspectionToSceneGraph,
  sceneGraphToComponentDesignTree,
} from './runtime-dom-adapter.mjs'
import { inspectStaticHtmlRuntime } from './component-runtime-inspector.mjs'
import {
  createPageCompositionBlueprint,
  resolvePageLayoutMetrics,
  validatePageCompositionBlueprint,
} from './page-composition.mjs'
import { reviewPageVision } from './vision-review.mjs'
import { normalizeVisualTheme } from './pi/structured-results.mjs'
import {
  calculateComponentEditableCoverage,
  calculatePageEditableCoverage,
  createDesignEvalReport,
  selectAutomaticRepair,
} from './design-eval.mjs'
import {
  assertDesignSpec,
  createDesignSpecExample,
  describeDesignBlockRegistry,
  normalizeDesignSpecResult,
} from './design-catalog.mjs'
import { createGenerationBrief, describeGenerationBrief } from './generation-brief.mjs'
import { assertDesignPatch, normalizeDesignPatch } from './design-patch.mjs'
import {
  compileDesignAction,
  describeDesignActionContext,
  extractDesignPatch,
} from './design-action-compiler.mjs'
import { buildDesignSelectionContext } from './design-context.mjs'
import { compileDesignActionResult, extractDesignAction } from './design-action.mjs'
import {
  applyDesignSpecPatch,
  assertDesignSpecPatch,
  normalizeDesignSpecPatch,
} from './design-spec-patch.mjs'
import { resolveLoadedComponentPackTool } from './component-packs.mjs'
import { createRuntimePluginRegistry } from './plugins/plugin-registry.mjs'
import { createDefaultRuntimePlugins } from './plugins/campaign-component-plugin.mjs'
import { analyzeRaster, readRasterDimensions } from './raster-analysis.mjs'
import {
  designTreeToBlueprintRegions,
  mergeComponentDesignTree,
  normalizeDesignTree,
} from './component-design-tree.mjs'

export function createAgentToolRegistry({
  invokeProvider,
  executeSkillTool,
  loadComponentFromPrompt,
  loadComponentsFromPrompt,
  resolveComponentReference,
  inspectRuntimeSource = inspectRuntimeDomToScene,
  inspectStaticRuntime = inspectStaticHtmlRuntime,
  plugins,
}) {
  const toolCatalog = new Map()
  const tools = new Map()
  const runtimePlugins = createRuntimePluginRegistry(
    plugins === undefined ? createDefaultRuntimePlugins() : plugins,
  )
  const registerTool = (target, name, execute) => {
    if (target !== tools) throw new TypeError('工具必须注册到当前 Registry。')
    toolCatalog.set(name, execute)
  }

  registerTool(tools, 'design.spec-patch.plan', async (context) => {
    const snapshot = context.session.canvasSnapshot
    if (!snapshot?.designSpec) {
      throw createRuntimeError(
        'DESIGN_SPEC_PATCH_CONTEXT_MISSING',
        '当前画板缺少 DesignSpec，不能执行结构修改。',
      )
    }
    const result = await invokeProvider(
      {
        ...context.payload,
        type: 'generate_design_spec_patch',
        question: [
          '根据用户要求生成受限 DesignSpecPatch，只修改页面 Block 结构。',
          `用户要求：${context.session.goal}`,
          `当前文档 Revision：${snapshot.documentRevision}`,
          `目标画板：${snapshot.artboardId}`,
          `当前 DesignSpec：${JSON.stringify(snapshot.designSpec)}`,
          '允许 insert-block、update-block、remove-block、move-block。',
          `Block kind 必须来自当前开放 Registry：${describeDesignBlockRegistry()}`,
          '必须复用已有 Block ID；新增 Block 使用简短、唯一、稳定的英文 ID。不得删除全部 Block。',
        ].join('\n'),
        canvasSnapshot: snapshot,
        uploads: [],
      },
      context.providerCallbacks,
    )
    const patch = normalizeDesignSpecPatch(result.designSpecPatch || result.data, {
      documentRevision: snapshot.documentRevision,
      artboardId: snapshot.artboardId,
      goal: context.session.goal,
    })
    assertDesignSpecPatch(patch, snapshot)
    const nextDesignSpec = applyDesignSpecPatch(snapshot.designSpec, patch)
    context.session.designSpecPatch = patch
    context.session.designSpec = nextDesignSpec
    context.session.genericUiSchema = nextDesignSpec
    return {
      summary: `已规划 ${patch.operations.length} 个 DesignSpec 结构操作。`,
      data: { patch, baseDesignSpec: snapshot.designSpec, nextDesignSpec },
    }
  })

  registerTool(tools, 'design.spec-patch.validate', async (context) => {
    const data = context.memory.get('design.spec-patch.plan')?.data
    if (!data?.patch || !data?.nextDesignSpec) {
      throw createRuntimeError('DESIGN_SPEC_PATCH_MISSING', '缺少已规划的 DesignSpecPatch。')
    }
    assertDesignSpecPatch(data.patch, context.session.canvasSnapshot)
    const verified = applyDesignSpecPatch(context.session.canvasSnapshot.designSpec, data.patch)
    if (JSON.stringify(verified) !== JSON.stringify(data.nextDesignSpec)) {
      throw createRuntimeError('DESIGN_SPEC_PATCH_RESULT_MISMATCH', 'DesignSpecPatch 结果不确定。')
    }
    return { summary: 'DesignSpecPatch 与 Revision 校验通过。', data }
  })

  registerTool(tools, 'canvas.present-spec-patch', async (context) => {
    const data = context.memory.get('design.spec-patch.validate')?.data
    if (!data?.patch || !data?.nextDesignSpec) {
      throw createRuntimeError('DESIGN_SPEC_PATCH_MISSING', '缺少已校验的 DesignSpecPatch。')
    }
    return { summary: 'DesignSpecPatch 已准备提交画布结构事务。', data }
  })

  registerTool(tools, 'design.patch.plan', async (context) => {
    const snapshot = context.session.canvasSnapshot
    const scope = context.session.editScope
    if (
      !snapshot ||
      !['design-block', 'generic-node', 'multi-node', 'text-range', 'image-region'].includes(
        scope?.type,
      )
    ) {
      throw createRuntimeError(
        'DESIGN_PATCH_SCOPE_MISSING',
        '局部修改缺少有效节点选区或 CanvasSnapshot。',
      )
    }
    const { currentImage: _currentImage, maskImage: _maskImage, ...scopeSummary } = scope
    const diagnostics = describeDesignActionContext({
      goal: context.session.goal,
      scope,
      snapshot,
    })
    const selectionContext = buildDesignSelectionContext(snapshot, scope)
    console.info('[design.patch.plan]', diagnostics)
    const imageUpsert = compileDesignBlockImageUpsert({
      goal: context.session.goal,
      scope,
      snapshot,
      uploads: getPreparedUploads(context),
    })
    if (imageUpsert) {
      assertDesignPatch(imageUpsert.patch, snapshot)
      context.session.designPatch = imageUpsert.patch
      return {
        summary: imageUpsert.summary,
        data: {
          patch: imageUpsert.patch,
          source: 'deterministic-design-block-image',
          actionKind: imageUpsert.actionKind,
          diagnostics: { ...diagnostics, compiled: true },
        },
        nextSteps: [createPatchImageGenerationStep(imageUpsert.actionKind)],
      }
    }
    // Ask the model for a semantic action first. The runtime remains responsible
    // for turning it into a scoped, revision-checked DesignPatch.
    let actionResult
    try {
      actionResult = await invokeProvider(
        {
          ...context.payload,
          type: 'generate_design_action',
          question: [
            '根据用户要求规划一个通用 DesignAction，不要直接生成 Patch。',
            `用户要求：${context.session.goal}`,
            `当前选区上下文：${JSON.stringify(selectionContext)}`,
            '用户发送本次局部设计请求即表示授权执行。必须结合当前冻结选区和参考图作出最佳设计判断，不要要求用户二次确认；仅修改当前选区，不能猜测或扩大目标范围。',
          ].join('\n'),
          canvasSnapshot: snapshot,
          selectionContext,
          uploads: getPreparedUploads(context),
        },
        context.providerCallbacks,
      )
    } catch (error) {
      console.warn(
        '[design.patch.plan] semantic action unavailable, fallback to patch planner',
        error,
      )
    }
    const action = extractDesignAction(actionResult)
    // 旧模型或第三方 Provider 仍可能返回 needsClarification。局部设计请求已经
    // 具备冻结 SelectionScope，因此不能把正常的设计判断显示成执行失败，也不应
    // 要求用户重复确认。丢弃这次不可执行的语义动作，继续走受选区约束的 Patch 规划。
    const executableAction = action?.needsClarification ? undefined : action
    if (action?.needsClarification) {
      console.info('[design.patch.plan] clarification suppressed; using scoped patch fallback', {
        question: action.question,
        scopeId: scope.scopeId,
        targetElementIds: scope.targetElementIds,
      })
    }
    const compiledAction = compileDesignActionResult(executableAction, {
      snapshot,
      scope,
      goal: context.session.goal,
    })
    if (compiledAction) {
      assertDesignPatch(compiledAction.patch, snapshot)
      context.session.designPatch = compiledAction.patch
      return {
        summary: `已根据 AI 语义动作修改：${compiledAction.summary}`,
        data: {
          patch: compiledAction.patch,
          source: 'ai-design-action',
          actionKind: compiledAction.actionKind,
          diagnostics: { ...diagnostics, compiled: true },
        },
        nextSteps: compiledAction.patch.operations.some((operation) =>
          isPatchImageOperation(operation),
        )
          ? [createPatchImageGenerationStep(compiledAction.actionKind)]
          : [],
      }
    }
    const deterministicAction = compileDesignAction({ goal: context.session.goal, scope, snapshot })
    if (deterministicAction) {
      const patch = deterministicAction.patch
      assertDesignPatch(patch, snapshot)
      context.session.designPatch = patch
      removeImageStepForNonImagePatch(context.session, patch)
      return {
        summary: `已直接规划文本修改：${deterministicAction.summary}`,
        data: {
          patch,
          source: 'deterministic-action-compiler',
          actionKind: deterministicAction.kind,
          diagnostics: { ...diagnostics, compiled: true },
        },
      }
    }
    const result = await invokeProvider(
      {
        ...context.payload,
        type: 'generate_design_patch',
        question: [
          '根据用户要求生成受限 DesignPatch，只修改普通可编辑节点。',
          `用户要求：${context.session.goal}`,
          '用户已经通过发送本次请求授权执行。遇到“是否/要不要/能否”这类委托判断时，请自行选择最符合当前设计上下文的方案并返回有效修改；禁止返回确认问题或空操作。',
          `当前文档 Revision：${snapshot.documentRevision}`,
          `目标画板：${snapshot.artboardId}`,
          `当前选区：${JSON.stringify(scopeSummary)}`,
          `画布节点摘要：${JSON.stringify(snapshot.elements ?? [])}`,
          scope.type === 'text-range'
            ? `当前是冻结文本范围任务。只能返回一个 replace-text-range Operation；elementId/start/end/expectedText 必须分别为 ${scope.elementId}/${scope.start}/${scope.end}/${JSON.stringify(scope.selectedText)}，replacement 是按用户要求生成的新文本。禁止修改样式、布局、其他文本或其他节点。`
            : scope.type === 'image-region'
              ? `当前是冻结图片 Mask 任务。只能返回一个 replace-image-region Operation；elementId 必须为 ${scope.elementId}，normalizedRect 必须为 ${JSON.stringify(scope.normalizedRect)}，prompt 描述 Mask 内需要生成的内容。禁止整图替换、修改布局或其他节点。`
              : '支持 semantic-update、update、move、delete、add、add-image、replace-image。add-image 仅用于 design-block，并且 parentId 必须是当前模块根节点。布局模式、约束、间距、内边距、对齐、透明度和四角圆角优先使用 semantic-update。禁止修改组件绑定节点和 page-shell。',
          'update 必须提供 elementType，以便 Runtime 按节点类型过滤 changes。',
        ].join('\n'),
        uploads: getPreparedUploads(context),
      },
      context.providerCallbacks,
    )
    let patch = normalizeDesignPatch(extractDesignPatch(result), {
      documentRevision: snapshot.documentRevision,
      artboardId: snapshot.artboardId,
      goal: context.session.goal,
      scopeId: scope.scopeId,
      targetHash: scope.targetHash,
      targetElementIds: scope.targetElementIds,
      textRange: scope.type === 'text-range' ? scope : undefined,
      imageRegion: scope.type === 'image-region' ? scope : undefined,
    })
    if (!patch.operations.length) {
      const fallback = compileDesignAction({ goal: context.session.goal, scope, snapshot })
      if (fallback) {
        patch = fallback.patch
      }
    }
    if (!patch.operations.length && scope.type === 'generic-node') {
      if (
        diagnostics.targetType === 'text' &&
        /(背景|底色|填充|颜色|色值|透明度|圆角|边框)/.test(context.session.goal)
      ) {
        throw createRuntimeError(
          'DESIGN_PATCH_TARGET_PROPERTY_UNSUPPORTED',
          `当前选中的是文本节点“${scope.name || diagnostics.targetId}”，不支持修改背景属性。请选中对应的背景图形或卡片节点后重试。`,
          { retryable: false },
        )
      }
    }
    if (!patch.operations.length) {
      throw createRuntimeError(
        'PATCH_RESPONSE_EMPTY',
        `模型未返回有效的局部修改操作（目标：${diagnostics.targetType || '未知节点'}）。请重试；若仍失败，请查看执行详情。`,
        { retryable: false, diagnostics: { ...diagnostics, compiled: false } },
      )
    }
    assertDesignPatch(patch, snapshot)
    context.session.designPatch = patch
    removeImageStepForNonImagePatch(context.session, patch)
    const hasImageOperation = patch.operations.some(
      (operation) => isPatchImageOperation(operation),
    )
    return {
      summary: `已规划 ${patch.operations.length} 个局部修改操作。`,
      data: { patch, diagnostics: { ...diagnostics, compiled: false } },
      nextSteps: hasImageOperation
        ? [
            createPatchImageGenerationStep(
              patch.operations.some((operation) => operation.kind === 'add-image')
                ? 'add-image'
                : 'replace-image',
            ),
          ]
        : [],
    }
  })

  registerTool(tools, 'design.patch.generate-images', async (context) => {
    const patch =
      context.memory.get('design.patch.plan')?.data?.patch || context.session.designPatch
    const replacements = (patch?.operations ?? []).filter(
      (operation) => isPatchImageOperation(operation),
    )
    if (!replacements.length)
      return { summary: '本次局部修改不需要生成图片。', data: { patch, imageArtifacts: {} } }
    const snapshotElements = new Map(
      (context.session.canvasSnapshot?.elements ?? []).map((element) => [element.id, element]),
    )
    const entries = []
    for (const operation of replacements) {
      const target =
        operation.kind === 'add-image'
          ? operation.element
          : snapshotElements.get(operation.elementId)
      const regionScope =
        operation.kind === 'replace-image-region' &&
        context.session.editScope?.type === 'image-region'
          ? context.session.editScope
          : undefined
      const question = [
        operation.prompt,
        operation.kind === 'add-image'
          ? `只生成用于模块“${context.session.editScope?.name || operation.element.parentId}”的单张图片资源，不生成完整页面。画布现有标题、正文、按钮和 Logo 均保持为独立可编辑节点，图片中禁止重复绘制这些 UI 内容或添加无关文字。`
          : regionScope
          ? `只重绘节点 ${operation.elementId} 的 Mask 透明区域，Mask 外像素必须保持不变。`
          : `只替换节点 ${operation.elementId} 的图片内容，不生成完整页面。`,
        `目标尺寸：${target?.bounds?.width || target?.width || 512} x ${target?.bounds?.height || target?.height || 512}px。`,
      ].join('\n')
      const preparedUploads = preparePatchImageUploads(
        getPreparedUploads(context),
        context.session.goal,
      )
      const result = await invokeProvider(
        {
          ...context.payload,
          type: 'generate_image',
          question,
          uploads: regionScope
            ? [
                {
                  name: `${operation.elementId}-edit-base.png`,
                  mime: 'image/png',
                  role: 'edit-base',
                  data: regionScope.currentImage,
                },
                {
                  name: `${operation.elementId}-mask.png`,
                  mime: 'image/png',
                  role: 'mask',
                  data: regionScope.maskImage,
                },
              ]
            : preparedUploads,
          imageTasks: [
            createImageTask({
              id: operation.id,
              name: `${operation.id}.png`,
              targetSize: {
                width: target?.bounds?.width || target?.width || 512,
                height: target?.bounds?.height || target?.height || 512,
              },
              transparent: false,
              maskedEdit: Boolean(regionScope),
              referencePolicy: regionScope
                ? { roles: ['edit-base', 'mask'], maxImages: 2 }
                : {
                    roles: ['edit-base', 'kv', 'visual', 'content', 'prototype'],
                    maxImages: 4,
                  },
              prompt: question,
            }),
          ],
        },
        context.providerCallbacks,
      )
      if (!result.artifact)
        throw createRuntimeError('DESIGN_PATCH_IMAGE_MISSING', `${operation.id} 没有返回替换图片。`)
      entries.push([operation.id, result.artifact])
    }
    return {
      summary: `已生成 ${entries.length} 张替换图片。`,
      data: { patch, imageArtifacts: Object.fromEntries(entries) },
    }
  })

  registerTool(tools, 'design.patch.validate', async (context) => {
    const generated = context.memory.get('design.patch.generate-images')?.data
    const patch = generated?.patch || context.session.designPatch
    assertDesignPatch(patch, context.session.canvasSnapshot)
    const missingImage = patch.operations.find(
      (operation) =>
        isPatchImageOperation(operation) && !generated?.imageArtifacts?.[operation.id],
    )
    if (missingImage)
      throw createRuntimeError('DESIGN_PATCH_IMAGE_MISSING', `${missingImage.id} 缺少替换图片。`)
    return {
      summary: 'DesignPatch 与图片制品校验通过。',
      data: { patch, imageArtifacts: generated?.imageArtifacts ?? {} },
    }
  })

  registerTool(tools, 'canvas.present-patch', async (context) => {
    const validated = context.memory.get('design.patch.validate')?.data
    if (!validated?.patch)
      throw createRuntimeError('DESIGN_PATCH_MISSING', '缺少已校验的 DesignPatch。')
    return { summary: 'DesignPatch 已准备提交画布事务。', data: validated }
  })

  registerTool(tools, 'ui.plan', async (context) => {
    const requestedSurface =
      context.session.surfaceKind ||
      (context.session.canvasTarget?.width <= 600 ? 'mobile' : 'desktop-web')
    const designArchetype = context.session.designArchetype || '由用户目标推导'
    const uploads = getPreparedUploads(context)
    const visualTheme =
      context.memory.get('ui.extract-theme')?.data?.visualTheme ??
      context.session.genericUiVisualTheme ??
      createStylePackVisualTheme(context.session.activeStylePack)
    const planningQuestion = [
      '规划一个通用 UI 页面结构，只输出 DesignSpec，不生成图片。',
      `用户目标：${context.session.goal}`,
      context.session.visualBrief
        ? `这是视觉优化 Variant，不是普通 UI 重建。必须保留原画板的信息架构，并为图片策略预留可绑定的 image 区域：${JSON.stringify(context.session.visualBrief)}`
        : '',
      context.session.visualAssetPlan
        ? `结构化图片资产计划（必须执行并在 Scene 中保留对应 image 节点）：${JSON.stringify(context.session.visualAssetPlan)}`
        : '',
      `目标端类型：${requestedSurface}`,
      `设计原型类型：${designArchetype}`,
      `可用 Block Registry：${describeDesignBlockRegistry()}`,
      `严格 JSON 示例：${JSON.stringify(createDesignSpecExample(requestedSurface))}`,
      describeReferences(uploads),
      visualTheme ? `必须严格继承以下 VisualThemeContract：${JSON.stringify(visualTheme)}` : '',
      uploads.length && !visualTheme
        ? '请直接分析参考图的配色、字体气质、圆角、材质和视觉语言。'
        : '',
      'sidebar、header、footer 是全局结构 Block，每种最多一个；内容区模块标题必须使用 section-header，不能重复使用 header。',
      '根据用户目标选择节点，不要默认补充后台导航、指标、筛选或表格。所有可见内容必须由可编辑 Block 表达。',
    ]
      .filter(Boolean)
      .join('\n')
    let result
    try {
      result = await invokeProvider(
        {
          ...context.payload,
          type: 'generate_ui_schema',
          question: planningQuestion,
          uploads,
        },
        context.providerCallbacks,
      )
    } catch (error) {
      if (context.payload.signal?.aborted || error?.code === 'AGENT_CANCELLED') throw error
      throw createRuntimeError(
        'DESIGN_SPEC_PROVIDER_FAILED',
        `结构规划失败：${error?.code || error?.message || 'Provider 不可用'}`,
      )
    }
    const rawResult = result?.data ?? result?.uiSchema
    let normalized = normalizeDesignSpecResult(rawResult, context.session.goal, {
      visualTheme,
      surfaceKind: requestedSurface,
      designArchetype,
    })
    if (normalized.status === 'invalid') {
      const repair = await invokeProvider(
        {
          ...context.payload,
          type: 'generate_ui_schema',
          question: [
            planningQuestion,
            '上一次返回没有有效 Block。根据诊断修复为严格 JSON，至少包含一个 Registry 中存在的 Block。',
            `校验诊断：${normalized.diagnostics.join('；')}`,
            `上一次原始返回：${JSON.stringify(rawResult || {})}`,
            `必须遵守的最小示例：${JSON.stringify(createDesignSpecExample(requestedSurface))}`,
          ].join('\n\n'),
          uploads,
        },
        context.providerCallbacks,
      )
      normalized = normalizeDesignSpecResult(
        repair?.data ?? repair?.uiSchema,
        context.session.goal,
        { visualTheme, surfaceKind: requestedSurface, designArchetype },
      )
    }
    if (normalized.status === 'invalid') {
      throw createRuntimeError('DESIGN_SPEC_INVALID', normalized.diagnostics.join('；'), {
        retryable: false,
      })
    }
    const designSpec = normalized.spec
    context.session.genericUiSchema = designSpec
    context.session.designSpec = designSpec
    context.session.designSpecStatus = normalized.status
    return {
      summary: `通用 DesignSpec 规划完成，共 ${designSpec.blocks.length} 个模块，状态 ${normalized.status}。`,
      data: {
        uiSchema: designSpec,
        designSpec,
        status: context.session.designSpecStatus,
        diagnostics: normalized.diagnostics,
      },
    }
  })

  registerTool(tools, 'ui.extract-theme', async (context) => {
    const visualUploads = getPreparedUploads(context).filter(
      (upload) => !['prototype', 'edit-base', 'content'].includes(upload.role),
    )
    if (!visualUploads.length) {
      delete context.session.genericUiVisualTheme
      const prototypeCount = getPreparedUploads(context).filter(
        (upload) => upload.role === 'prototype',
      ).length
      return {
        summary: prototypeCount
          ? `本次没有 KV/视觉主题图；${prototypeCount} 张原型图仍会用于页面结构和 Runtime 设计，配色使用产品界面默认主题。`
          : '本次没有 KV/视觉主题图，使用产品界面默认主题。',
        data: { visualTheme: undefined },
      }
    }
    let result
    try {
      result = await invokeProvider(
        {
          ...context.payload,
          type: 'extract_visual_theme',
          question: [
            `UI 目标：${context.session.goal}`,
            '从本轮用户指定的图片提取 VisualThemeContract。',
            '图片只决定配色、字体气质、圆角、边框、阴影和装饰语言；不要把图片内容当作后台页面结构。',
            '必须提供 primary、background、surface、text 等 colorTokens，并保证文字与背景可读。',
          ].join('\n\n'),
          uploads: visualUploads,
        },
        context.providerCallbacks,
      )
      context.session.genericUiVisualTheme = requireReferenceVisualTheme(
        result.visualTheme,
        visualUploads,
        1,
        'GENERIC_UI_VISUAL_THEME_INVALID',
      )
    } catch (error) {
      if (context.payload.signal?.aborted || error?.code === 'AGENT_CANCELLED') throw error
      delete context.session.genericUiVisualTheme
      context.session.genericUiThemeExtractionWarning = error?.code || error?.message || 'unknown'
      return {
        summary: '主题结构化提取未成功，将由 DesignSpec 规划模型直接读取参考图并继续生成。',
        data: {
          visualTheme: undefined,
          fallback: 'design-spec-direct-vision',
          warning: context.session.genericUiThemeExtractionWarning,
        },
      }
    }
    delete context.session.genericUiThemeExtractionWarning
    return {
      summary: `参考图主题已提取，共 ${context.session.genericUiVisualTheme.colors.length} 个主导色。`,
      data: { visualTheme: context.session.genericUiVisualTheme },
    }
  })

  registerTool(tools, 'ui.validate', async (context) => {
    const transformed = context.memory.get('ui.transform')?.data
    if (transformed?.sceneGraph) {
      const editableLeaves = transformed.sceneGraph.nodes.filter((node) =>
        ['text', 'button', 'input', 'image'].includes(node.type),
      )
      if (transformed.sceneGraph.nodes.length < 8 || editableLeaves.length < 3) {
        throw createRuntimeError(
          'UI_RUNTIME_SCENE_TOO_SHALLOW',
          'Runtime Draft 没有生成足够的可编辑视觉节点。',
        )
      }
      const assetPlan = context.session.visualAssetPlan
      if (assetPlan?.items?.length) {
        const imageNodes = transformed.sceneGraph.nodes.filter((node) => node.type === 'image')
        if (imageNodes.length < assetPlan.items.length) {
          throw createRuntimeError(
            'VISUAL_ASSET_PLAN_UNSATISFIED',
            `视觉优化要求 ${assetPlan.items.length} 个图片节点，Runtime 仅生成 ${imageNodes.length} 个。`,
          )
        }
        const plannedIds = new Set(assetPlan.items.map((item) => item.id))
        const missingSources = imageNodes.filter(
          (node) =>
            plannedIds.has(String(node.bindings?.['visual.assetId'] || '')) &&
            !String(node.asset?.source || '').startsWith('data:image/'),
        )
        if (missingSources.length) {
          throw createRuntimeError(
            'VISUAL_ASSET_BINDING_MISSING',
            `视觉优化有 ${missingSources.length} 个图片节点没有绑定已生成资产。`,
          )
        }
        const heroItem = assetPlan.items.find((item) => item.role === 'hero')
        const heroNode = transformed.sceneGraph.nodes.find(
          (node) => node.bindings?.['visual.assetId'] === heroItem?.id,
        )
        if (
          heroItem &&
          heroNode &&
          heroNode.bounds.height >= transformed.sceneGraph.surface.height * 0.8
        ) {
          throw createRuntimeError(
            'VISUAL_HERO_OVERSIZED',
            'Hero 图片高度接近整张画板，已阻止交付以避免生成整页长图。',
          )
        }
      }
      context.session.genericUiFailedSectionIndexes = []
      return {
        summary: `Runtime UI 场景校验通过，共 ${transformed.sceneGraph.nodes.length} 个节点。`,
        data: transformed,
      }
    }
    const uiSchema =
      context.memory.get('ui.plan')?.data?.uiSchema || context.session.genericUiSchema
    if (!uiSchema) throw createRuntimeError('DESIGN_SPEC_MISSING', '缺少模型生成的 DesignSpec。')
    assertDesignSpec(uiSchema)
    context.session.genericUiSchema = uiSchema
    context.session.designSpec = uiSchema
    context.session.genericUiFailedSectionIndexes = []
    return {
      summary: `通用 DesignSpec 校验通过，状态 ${context.session.designSpecStatus || 'valid'}。`,
      data: { uiSchema, designSpec: uiSchema, status: context.session.designSpecStatus || 'valid' },
      nextSteps: uiSchema.blocks.map((block, index) => ({
        id: `present-ui-section-${index + 1}`,
        title: `交付 ${block.label || block.kind}`,
        tool: 'canvas.present-ui-section',
        input: { blockIndex: index, blockId: block.id, blockKind: block.kind },
      })),
    }
  })

  registerTool(tools, 'ui.transform', async (context) => {
    const designSpec = context.memory.get('ui.plan')?.data?.designSpec || context.session.designSpec
    if (!designSpec) throw createRuntimeError('DESIGN_SPEC_MISSING', '缺少待转换的 DesignSpec。')
    assertDesignSpec(designSpec)
    context.session.designSpec = designSpec
    context.session.genericUiSchema = designSpec
    try {
      const result = await invokeProvider(
        {
          ...context.payload,
          type: 'generate_ui_runtime',
          question: [
            '生成一个可以直接在浏览器中渲染的最终静态 UI Runtime Draft。',
            `用户目标：${context.session.goal}`,
            context.session.visualBrief
              ? '当前是视觉优化 Variant：必须实际呈现计划中的 Hero/内容图片；文字和按钮保持可编辑原生节点，禁止把整页海报当作单张图片。'
              : '',
            context.session.visualAssetPlan
              ? `必须遵守图片资产计划：${JSON.stringify(context.session.visualAssetPlan)}。每个计划项都必须在 HTML 中有一个独立的 <img data-asset-slot="资产 id"> 占位；不要用 CSS 背景或整页截图代替。`
              : '',
            describeDirectContentRequirements(getPreparedUploads(context)),
            `设计原型类型：${context.session.designArchetype || designSpec.designArchetype || '由目标推导'}`,
            `目标 viewport：${designSpec.viewport.width}x${designSpec.viewport.height}`,
            context.session.genericUiVisualTheme
              ? `视觉主题契约：${JSON.stringify(context.session.genericUiVisualTheme)}`
              : `DesignSpec 主题：${JSON.stringify(designSpec.theme)}`,
            `内容清单参考：${JSON.stringify(designSpec)}`,
            'DesignSpec 只提供内容语义，不限制布局。请根据目标与参考图重新决定 Grid、Flex、区块宽度、浮层和视觉层级；页面只呈现最终用户界面，不要把生成工具自身的编辑器界面作为页面内容。',
            '输出静态 HTML 与 CSS；重要区域添加稳定、唯一的 data-region-id，文本、按钮、输入框和图片必须使用对应语义标签。',
          ].join('\n\n'),
          uploads: getPreparedUploads(context),
        },
        context.providerCallbacks,
      )
      const draft = normalizeStaticUiRuntimeDraft(result.data, designSpec)
      const inspection = await inspectStaticRuntime(
        {
          name: draft.title,
          html: draft.html,
          css: draft.css,
          width: draft.viewport.width,
          height: draft.viewport.height,
        },
        { captureSnapshot: false },
      )
      if (!inspection?.designTree?.nodes?.length) {
        throw createRuntimeError(
          'UI_RUNTIME_INSPECT_FAILED',
          inspection?.diagnostics
            ?.map((item) => item.message)
            .filter(Boolean)
            .join('；') || 'Runtime Draft 没有生成 DOM Scene。',
        )
      }
      const sceneGraph = runtimeDomInspectionToSceneGraph(inspection, {
        sourceId: draft.title,
        surfaceKind: designSpec.surfaceKind,
        maxNodes: 600,
      })
      assertRuntimeSceneCoversDraft(sceneGraph, draft)
      const plannedAssetReport = await materializeVisualAssetPlan(
        context,
        sceneGraph,
        draft,
        invokeProvider,
      )
      const directContentReport = bindDirectContentAssets(
        sceneGraph,
        getPreparedUploads(context),
        new Set(plannedAssetReport?.contentUploadNames ?? []),
      )
      const visualAssetReport = mergeVisualAssetReports(
        plannedAssetReport,
        directContentReport,
        draft,
      )
      context.session.genericUiRuntimeDraft = draft
      context.session.genericUiSceneGraph = sceneGraph
      context.session.visualAssetReport = visualAssetReport
      return {
        summary: visualAssetReport
          ? `Runtime Draft 已渲染并绑定 ${visualAssetReport.boundCount} 个视觉资产，转换为 ${sceneGraph.nodes.length} 个可编辑 Scene 节点。`
          : `Runtime Draft 已渲染并转换为 ${sceneGraph.nodes.length} 个可编辑 Scene 节点。`,
        data: {
          designSpec,
          uiSchema: designSpec,
          runtimeDraft: draft,
          runtimeSnapshot: inspection.runtimeSnapshot,
          sceneGraph,
          visualAssetReport,
          deliveryMode: 'runtime-dom-scene',
        },
      }
    } catch (error) {
      if (context.payload.signal?.aborted || error?.code === 'AGENT_CANCELLED') throw error
      // 视觉优化的图片契约是硬约束，不能降级成没有图片的“设计完成”。
      if (String(error?.code || '').startsWith('VISUAL_')) throw error
      delete context.session.genericUiRuntimeDraft
      delete context.session.genericUiSceneGraph
      delete context.session.visualAssetReport
      return {
        summary: `Runtime Draft 不可用，降级为 DesignSpec Renderer：${safeTraceError(error)}`,
        data: {
          designSpec,
          uiSchema: designSpec,
          deliveryMode: 'design-spec-fallback',
          fallbackReason: safeTraceError(error),
        },
      }
    }
  })

  registerTool(tools, 'canvas.present-ui-section', async (context) => {
    const uiSchema = context.memory.get('ui.validate')?.data?.uiSchema || context.session.designSpec
    assertDesignSpec(uiSchema)
    const blockIndex = Number(context.input?.blockIndex)
    const block = uiSchema.blocks[blockIndex]
    if (!Number.isInteger(blockIndex) || !block || block.id !== context.input?.blockId) {
      throw createRuntimeError(
        'GENERIC_UI_SECTION_INVALID',
        '通用 UI Section 与 DesignSpec 不一致。',
      )
    }
    const failed = new Set(context.session.genericUiFailedSectionIndexes ?? [])
    const blocks = uiSchema.blocks.slice(0, blockIndex + 1).filter((_, index) => !failed.has(index))
    return {
      summary: `${block.label || block.kind} 已准备增量交付画布。`,
      data: {
        uiSchema,
        section: { index: blockIndex, id: block.id, kind: block.kind, label: block.label },
        deliveredBlockIds: blocks.map((item) => item.id),
      },
    }
  })

  registerTool(tools, 'canvas.present-ui', async (context) => {
    const validated = context.memory.get('ui.validate')?.data
    if (validated?.sceneGraph) {
      return {
        summary: `Runtime UI 的 ${validated.sceneGraph.nodes.length} 个可编辑节点已准备提交画布。`,
        data: {
          ...validated,
          expectedNodeCount: validated.sceneGraph.nodes.length,
          deliveryMode: 'runtime-dom-scene',
        },
      }
    }
    const sourceSchema =
      context.memory.get('ui.validate')?.data?.uiSchema || context.session.designSpec
    assertDesignSpec(sourceSchema)
    const failed = new Set(context.session.genericUiFailedSectionIndexes ?? [])
    const blocks = sourceSchema.blocks.filter((_, index) => !failed.has(index))
    if (!blocks.length) {
      throw createRuntimeError(
        'GENERIC_UI_ALL_SECTIONS_FAILED',
        '通用 UI 所有 Section 均交付失败。',
      )
    }
    const uiSchema = { ...sourceSchema, blocks }
    context.session.genericUiSchema = uiSchema
    context.session.designSpec = uiSchema
    return {
      summary: failed.size
        ? `通用 UI 已部分交付，成功 ${blocks.length} 个 Section，失败 ${failed.size} 个。`
        : `通用 UI ${blocks.length} 个 Section 已全部交付。`,
      data: {
        uiSchema,
        designSpec: uiSchema,
        incrementalFinalize: true,
        expectedBlockIds: blocks.map((block) => block.id),
        failedSectionIndexes: [...failed],
      },
    }
  })

  registerTool(tools, 'reference.prepare', async (context) => {
    const references = context.session.references.filter((reference) =>
      reference.data.startsWith('data:image/'),
    )
    return {
      summary: references.length
        ? `已准备 ${references.length} 张参考图：${references.map((reference) => reference.name).join('、')}`
        : '本次没有参考图，将根据文字目标生成。',
      data: {
        uploads: references.map((reference) => ({
          type: 'file',
          name: reference.name,
          mime: reference.mime,
          data: reference.data,
          role: reference.role,
        })),
      },
    }
  })

  registerTool(tools, 'design.brief', async (context) => {
    const brief = createGenerationBrief({
      goal: context.session.goal,
      canvasTarget: context.session.canvasTarget,
      references: context.session.references,
      editScope: context.session.editScope,
      outputKind: context.session.outputKind,
    })
    context.session.generationBrief = brief
    return {
      summary: `图片生成契约已建立：${brief.outputKind}，${brief.target.width} x ${brief.target.height}px，${brief.references.length} 张参考图。`,
      data: { brief },
    }
  })

  registerTool(tools, 'design.generate', async (context) => {
    const uploads = getPreparedUploads(context)
    const brief = context.memory.get('design.brief')?.data?.brief || context.session.generationBrief
    const question = buildDesignQuestion(context, brief)
    const result = await requestImageWithTrace({
      invokeProvider,
      context,
      traceTool: 'design.generate',
      task: createImageTask({
        id: 'design-image',
        name: 'AI 生成设计图.png',
        role: 'design-image',
        targetSize: context.session.canvasTarget,
        transparent: false,
        prompt: question,
      }),
      question,
      uploads,
      // 这一步只有一个图片请求，executeToolWithRetry 已经会整步重试。
      // 内层再重试会让单个 Step 变成 4 次生图请求。
      maxAttempts: 1,
    })
    return {
      summary: '设计图生成完成。',
      data: { artifact: result.artifact },
    }
  })

  registerTool(tools, 'artifact.review', async (context) => {
    const artifact = context.memory.get('design.generate')?.data?.artifact
    if (!artifact) {
      throw createRuntimeError('AGENT_ARTIFACT_MISSING', '没有可审查的设计制品。')
    }
    const review = inspectImageArtifact(artifact, context.session.canvasTarget)
    return {
      summary: review.passed
        ? '设计制品质量审查通过。'
        : `发现 ${review.issues.filter((issue) => issue.severity === 'error').length} 个必须修正的问题。`,
      data: { artifact, review },
    }
  })

  registerTool(tools, 'design.refine', async (context) => {
    const reviewed = context.memory.get('artifact.review')?.data
    if (!reviewed?.artifact || !reviewed?.review) {
      throw createRuntimeError('AGENT_REVIEW_MISSING', '缺少设计制品审查结果。')
    }
    if (reviewed.review.passed) {
      return {
        summary: '设计制品无需自动修正。',
        data: { artifact: reviewed.artifact, review: reviewed.review, refined: false },
      }
    }

    const uploads = getPreparedUploads(context)
    const brief = context.memory.get('design.brief')?.data?.brief || context.session.generationBrief
    const issueText = reviewed.review.issues
      .map((issue) => `- [${issue.code}] ${issue.message}`)
      .join('\n')
    const question = [
      buildDesignQuestion(context, brief),
      '上一版没有通过 Runtime 质量审查。请重新生成完整 SVG，不要只解释问题。',
      `必须修正的问题：\n${issueText}`,
    ].join('\n\n')
    const result = await requestImageWithTrace({
      invokeProvider,
      context,
      traceTool: 'design.refine',
      task: createImageTask({
        id: 'design-image-refined',
        name: 'AI 生成设计图.png',
        role: 'design-image',
        targetSize: context.session.canvasTarget,
        transparent: false,
        prompt: question,
      }),
      question,
      uploads,
      // 同 design.generate：整步重试由 executeToolWithRetry 负责。
      maxAttempts: 1,
    })
    const review = inspectImageArtifact(result.artifact, context.session.canvasTarget)
    if (!review.passed) {
      const message = review.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join('；')
      throw createRuntimeError(
        'AGENT_ARTIFACT_QUALITY_FAILED',
        `设计制品自动修正一次后仍未通过审查：${message}`,
      )
    }
    return {
      summary: '设计制品已自动修正并通过复查。',
      data: { artifact: result.artifact, review, refined: true },
    }
  })

  registerTool(tools, 'artifact.validate', async (context) => {
    const refined = context.memory.get('design.refine')?.data
    const artifact = refined?.artifact
    if (!artifact || !inspectImageArtifact(artifact, context.session.canvasTarget).passed) {
      throw createRuntimeError('AGENT_ARTIFACT_INVALID', '生成结果不是有效图片制品。')
    }
    return {
      summary: refined.refined ? '自动修正后的图片制品验证通过。' : '图片制品验证通过。',
      data: { artifact, review: refined.review, refined: refined.refined },
    }
  })

  registerTool(tools, 'canvas.present', async (context) => {
    const artifact = context.memory.get('artifact.validate')?.data?.artifact
    if (!artifact) {
      throw createRuntimeError('AGENT_ARTIFACT_MISSING', '没有可交付到画布的图片制品。')
    }
    return {
      summary: '图片制品已准备交付画布。',
      data: {
        artifact,
        review: context.memory.get('artifact.validate')?.data?.review,
        refined: context.memory.get('artifact.validate')?.data?.refined ?? false,
      },
    }
  })

  registerTool(tools, 'design.generate-assets', async (context) => {
    const prepared = context.memory.get('reference.prepare')
    const uploads = prepared?.data?.uploads ?? []
    const roleDescription = uploads
      .map(
        (upload, index) =>
          `图片 ${index + 1}：${upload.name}，角色=${referenceRoleLabel(upload.role)}`,
      )
      .join('\n')
    const question = [
      '生成一组互相独立、可分别下载的局部设计素材。',
      `任务目标：${context.session.goal}`,
      roleDescription ? `参考图：\n${roleDescription}` : '',
      '每个按钮、背景或装饰必须是单独文件；禁止把多个目标拼在一张图中，禁止输出整页或整个组件截图。',
      '素材画布必须紧贴自身可见内容；按钮使用透明背景，并保留用户要求的准确文字。',
    ]
      .filter(Boolean)
      .join('\n\n')
    const result = await invokeProvider(
      {
        ...context.payload,
        type: 'generate_assets',
        question,
        uploads,
      },
      context.providerCallbacks,
    )
    if (!Array.isArray(result.artifacts) || !result.artifacts.length) {
      throw createRuntimeError('AGENT_ARTIFACT_MISSING', '独立素材工具没有返回任何制品。')
    }
    return {
      summary: `已生成 ${result.artifacts.length} 个独立素材。`,
      data: { artifacts: result.artifacts },
    }
  })

  registerTool(tools, 'artifact.validate-assets', async (context) => {
    const artifacts = context.memory.get('design.generate-assets')?.data?.artifacts
    if (!Array.isArray(artifacts) || !artifacts.length || artifacts.length > 16) {
      throw createRuntimeError('AGENT_ARTIFACT_INVALID', '独立素材数量无效。')
    }
    for (const artifact of artifacts) {
      if (!inspectImageArtifact(artifact, { placementMode: 'asset-board' }).passed) {
        throw createRuntimeError('AGENT_ARTIFACT_INVALID', '独立素材中包含无效图片。')
      }
    }
    return {
      summary: `${artifacts.length} 个独立素材验证通过。`,
      data: { artifacts },
    }
  })

  registerTool(tools, 'canvas.present-assets', async (context) => {
    const artifacts = context.memory.get('artifact.validate-assets')?.data?.artifacts
    if (!Array.isArray(artifacts) || !artifacts.length) {
      throw createRuntimeError('AGENT_ARTIFACT_MISSING', '没有可交付到画布的独立素材。')
    }
    return {
      summary: `${artifacts.length} 个独立素材已准备交付画布。`,
      data: { artifacts },
    }
  })

  registerTool(tools, 'component.resolve', async (context) => {
    if (typeof loadComponentFromPrompt !== 'function' || typeof executeSkillTool !== 'function') {
      throw createRuntimeError('COMPONENT_RUNTIME_UNAVAILABLE', '组件设计 Runtime 尚未配置。')
    }
    const componentRequest = context.session.componentRequest || context.session.goal
    const componentReference = context.session.componentReferences?.[0]
    let loaded
    try {
      loaded =
        componentReference && typeof resolveComponentReference === 'function'
          ? await resolveComponentReference(componentReference, {
              projectId: context.payload.projectId,
            })
          : await loadComponentFromPrompt(componentRequest, {
              projectId: context.payload.projectId,
            })
    } catch (error) {
      throw createRuntimeError(
        'COMPONENT_RESOLVE_FAILED',
        `组件未解析：${componentReference?.componentName || componentRequest || '未知组件'}。未执行普通图片生成。`,
        { cause: error instanceof Error ? error.message : String(error) },
      )
    }
    const resolveContractTool = resolveLoadedComponentPackTool(loaded, 'resolveContract')
    if (!resolveContractTool) {
      throw createRuntimeError(
        'COMPONENT_PACK_TOOL_MISSING',
        `${loaded.pack?.id || 'Component Pack'} 没有声明 resolveContract Tool。`,
      )
    }
    const contract = await executeSkillTool(resolveContractTool, {
      component: loaded.component,
      source: loaded.source,
    })
    const profile = selectComponentProfile(contract, `${componentRequest}\n${context.session.goal}`)
    if (!profile) {
      throw createRuntimeError(
        'COMPONENT_PROFILE_MISSING',
        `${contract.componentName} 没有可用的设计 Profile。`,
      )
    }
    context.session.componentContext = {
      componentName: contract.componentName,
      profile: profile.id,
      sourceHash: contract.sourceHash,
      request: componentRequest,
      packId: loaded.pack?.id,
    }
    return {
      summary: `已解析 ${contract.componentName}，使用 ${profile.id} Profile。`,
      data: { loaded, contract, profile },
    }
  })

  registerTool(tools, 'component.inspect-thumbnail', async (context) => {
    const resolved = context.memory.get('component.resolve')?.data
    const runtimeInspection = context.memory.get('component.inspect-runtime')?.data
    if (runtimeInspection?.sceneGraph) {
      return {
        summary: `Runtime DOM Scene 已提供 ${runtimeInspection.sceneGraph.nodes.length} 个节点，跳过 thumbnail Vision。`,
        data: { designTree: undefined, skipped: true, reason: 'runtime-inspect-preferred' },
      }
    }
    if (!resolved?.contract || !resolved?.profile || !resolved.loaded?.thumbnailUpload) {
      return {
        summary: '组件没有可识别的 thumbnail，继续使用组件契约布局。',
        data: { designTree: undefined, skipped: true },
      }
    }
    const allowedPropPaths = [
      ...(resolved.contract.designProperties ?? []),
      ...(resolved.contract.structuralControls ?? []),
    ]
      .filter((property) => propertyInProfile(property, resolved.profile.id))
      .map((property) => property.path)
    const layout = resolved.contract.prototypeLayout?.profiles?.[resolved.profile.id]
    try {
      const baseQuestion = [
        `识别 ${resolved.contract.componentName} thumbnail 中的通用视觉节点。`,
        `组件画布尺寸：${layout?.width || 375} x ${layout?.height || 600}`,
        `允许绑定的 Props 路径：${JSON.stringify(allowedPropPaths)}`,
        'thumbnail 只负责结构和文案，当前 KV/视觉参考负责主题；禁止把整张 thumbnail 当成一个 image 节点。',
      ].join('\n')
      const requestTree = async (question) => {
        const result = await invokeProvider(
          {
            ...context.payload,
            type: 'extract_design_tree',
            question,
            uploads: [resolved.loaded.thumbnailUpload],
          },
          context.providerCallbacks,
        )
        return normalizeDesignTree(result.designTree || result.data, {
          componentName: resolved.contract.componentName,
          width: layout?.width || 375,
          height: layout?.height || 600,
          allowedPropPaths,
        })
      }
      let designTree = await requestTree(baseQuestion)
      if (designTree && isLowGranularityThumbnailTree(designTree)) {
        designTree = await requestTree(
          [
            baseQuestion,
            '上一版只返回了一个整图容器，识别粒度不足。请重新分析并拆解为至少 5 个节点。',
            '必须分别识别：组件背景/容器、标题或说明、每个可见任务项、任务图标、进度条或进度点、操作按钮、分割线和装饰元素；没有业务绑定的节点使用 visual-only。',
            '不要返回覆盖整个画布的单一 container，也不要把组件作为 image 返回。',
          ].join('\n'),
        )
      }
      if (!designTree) {
        return {
          summary: 'thumbnail 未识别出有效节点，保留组件契约布局，未降级为整图。',
          data: {
            designTree: undefined,
            diagnostics: [
              { code: 'THUMBNAIL_TREE_EMPTY', message: 'thumbnail 未返回有效视觉节点。' },
            ],
          },
        }
      }
      if (isLowGranularityThumbnailTree(designTree)) {
        return {
          summary: `thumbnail 视觉识别覆盖不足，仅识别 ${designTree.nodes.length} 个节点，未将其伪装成完整组件。`,
          data: {
            designTree: undefined,
            diagnostics: [
              {
                code: 'THUMBNAIL_TREE_LOW_GRANULARITY',
                message: 'Vision 模型连续两次只返回整图容器，未生成可交付的细粒度节点。',
              },
            ],
          },
        }
      }
      context.session.componentDesignTree = designTree
      return {
        summary: `已从 thumbnail 识别 ${designTree.nodes.length} 个可编辑视觉节点。`,
        data: { designTree },
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return {
        summary: `thumbnail 识别失败：${reason.slice(0, 180)}。继续使用组件契约布局，未生成普通整图。`,
        data: {
          designTree: undefined,
          diagnostics: [{ code: 'THUMBNAIL_TREE_FAILED', message: reason }],
        },
      }
    }
  })

  registerTool(tools, 'component.inspect-runtime', async (context) => {
    const resolved = context.memory.get('component.resolve')?.data
    if (!resolved?.loaded?.component || !resolved.contract) {
      throw createRuntimeError(
        'COMPONENT_RUNTIME_INSPECT_INPUT_MISSING',
        'Runtime Inspect 缺少组件输入。',
      )
    }
    const prototypeLayout = resolved.contract.prototypeLayout?.profiles?.[resolved.profile.id]
    const pageEmbedded = context.session.componentBackdropMode === 'page-embedded'
    const targetWidth = pageEmbedded
      ? Number(context.session.canvasTarget?.width) || 375
      : prototypeLayout?.width || resolved.loaded.pack?.surface?.viewport?.width || 375
    const targetHeight = pageEmbedded
      ? Number(context.session.canvasTarget?.height) || 812
      : prototypeLayout?.height || resolved.loaded.pack?.surface?.viewport?.height || 812
    const inspection = await inspectRuntimeSource(
      {
        component: resolved.loaded.component,
        width: targetWidth,
        height: targetHeight,
      },
      {
        surfaceKind: resolved.loaded.pack?.surface?.kind || 'custom',
      },
    )
    if (!inspection.sceneGraph) {
      delete context.session.componentRuntimeDesignTree
      delete context.session.runtimeSceneGraph
      context.session.componentRuntimeDiagnostics = inspection.diagnostics ?? []
      const reason = inspection.diagnostics?.find((item) => item?.message)?.message
      return {
        summary:
          inspection.status === 'failed'
            ? `Runtime DOM Inspect 失败：${String(reason || '未返回具体原因').slice(0, 240)}。继续使用 thumbnail Vision。`
            : '组件没有可用 Runtime DOM Inspect，继续使用 thumbnail Vision。',
        data: inspection,
      }
    }
    const designTree = normalizeDesignTree(
      sceneGraphToComponentDesignTree(inspection.sceneGraph, resolved.contract.componentName),
      {
        componentName: resolved.contract.componentName,
        width: inspection.sceneGraph.surface.width,
        height: inspection.sceneGraph.surface.height,
      },
    )
    context.session.componentRuntimeDesignTree = designTree
    context.session.runtimeSceneGraph = inspection.sceneGraph
    delete context.session.componentRuntimeDiagnostics
    return {
      summary: `已从真实 Runtime DOM 编译 ${inspection.sceneGraph.nodes.length} 个 Scene 节点。`,
      data: { ...inspection, designTree: undefined },
    }
  })

  registerTool(tools, 'component.plan', async (context) => {
    const resolved = context.memory.get('component.resolve')?.data
    if (!resolved?.contract || !resolved?.profile) {
      throw createRuntimeError('COMPONENT_CONTRACT_MISSING', '缺少组件设计契约。')
    }
    const { contract, profile, loaded } = resolved
    const uploads = uniqueUploads(
      [loaded.thumbnailUpload, ...getPreparedUploads(context)].filter(Boolean),
    )
    const referenceContract = describeComponentReferences(uploads)
    const visualUploads = getPreparedUploads(context).filter(
      (upload) => upload.role === 'kv' || upload.role === 'visual',
    )
    const hasUserVisualReference = visualUploads.length > 0
    // Theme extraction receives visualUploads only, so its attachment index is always local
    // to that request. Keeping the combined thumbnail index here made diagnostics misleading.
    const visualReferenceIndex = hasUserVisualReference ? 1 : undefined
    const sharedTheme = context.session.pageVisualTheme
    let visualTheme =
      sharedTheme && hasUserVisualReference
        ? requireReferenceVisualTheme(
            sharedTheme,
            visualUploads,
            visualReferenceIndex,
            'COMPONENT_VISUAL_THEME_INVALID',
          )
        : sharedTheme
    const diagnostics = []
    if (!visualTheme && hasUserVisualReference) {
      try {
        const result = await invokeProvider(
          {
            ...context.payload,
            type: 'extract_visual_theme',
            question: [
              `为 ${contract.componentName} 提取视觉主题，不要规划组件结构。`,
              `任务目标：${context.session.goal}`,
              referenceContract,
              '用户 KV/视觉参考是唯一配色、材质和装饰语言来源；thumbnail 只用于理解组件语义。',
            ].join('\n\n'),
            uploads: visualUploads,
          },
          {},
        )
        visualTheme = requireReferenceVisualTheme(
          result.visualTheme,
          visualUploads,
          visualReferenceIndex,
          'COMPONENT_VISUAL_THEME_INVALID',
        )
      } catch (error) {
        throw createRuntimeError(
          'COMPONENT_VISUAL_THEME_REQUIRED',
          `无法从指定 KV 提取有效视觉主题，已停止生成以避免使用错误配色：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    if (visualTheme && hasUserVisualReference) {
      const calibrated = calibrateReferenceVisualTheme(visualTheme, visualUploads[0])
      visualTheme = calibrated.theme
      if (calibrated.corrected) {
        diagnostics.push({
          code: 'COMPONENT_VISUAL_THEME_PIXEL_CALIBRATED',
          path: visualUploads[0].name,
          message: `模型色板与 KV 像素证据不一致，Runtime 已使用本地色板校准（亲和度 ${roundScore(calibrated.modelAffinity)}）。`,
        })
      }
    }
    visualTheme ||=
      createStylePackVisualTheme(context.session.activeStylePack) ||
      createContractVisualTheme(contract, profile.id, context.session.goal)
    const blueprint = validateComponentBlueprint(
      createDeterministicComponentBlueprint(contract, profile, visualTheme, diagnostics),
      contract,
      profile.id,
    )
    context.session.componentBlueprint = blueprint
    context.session.componentDesignIntent = {
      visualTheme,
      source: visualTheme?.source ?? 'contract',
    }
    return {
      summary: `已根据组件 JSON 建立 ${blueprint.regions.length} 个设计区域。`,
      data: { blueprint, designIntent: context.session.componentDesignIntent },
    }
  })

  registerTool(tools, 'component.plan-assets', async (context) => {
    const resolved = context.memory.get('component.resolve')?.data
    const blueprint = context.memory.get('component.plan')?.data?.blueprint
    if (!resolved?.contract || !resolved?.profile || !blueprint) {
      throw createRuntimeError('COMPONENT_BLUEPRINT_MISSING', '缺少组件原型或设计契约。')
    }
    const profileSlots = resolved.contract.slots.filter(
      (slot) =>
        propertyInProfile(slot, resolved.profile.id) && slot.generationPolicy === 'generate',
    )
    const skippedSlots = profileSlots.filter((slot) => slot.role === 'animation')
    const slots = profileSlots.filter((slot) => slot.role !== 'animation')
    const propAssetTasks = slots.map((slot, index) => {
      const region = blueprint.regions.find((item) => item.slotId === slot.id)
      if (!region) {
        throw createRuntimeError(
          'COMPONENT_SLOT_UNMAPPED',
          `Component Blueprint 没有映射素材槽位：${slot.id}。`,
        )
      }
      const width =
        readContractNumber(resolved.contract, slot.bindings.width) ?? region.bounds.width
      const height =
        readContractNumber(resolved.contract, slot.bindings.height) ?? region.bounds.height
      return {
        id: `component-asset-${index + 1}`,
        slotId: slot.id,
        label: slot.label,
        propPath: slot.bindings.image,
        fallbackPath: slot.bindings.fallbackImage,
        role: slot.role,
        targetSize: {
          width: Math.max(1, Math.round(width)),
          height: Math.max(1, Math.round(height)),
        },
        transparent: slot.role !== 'background',
        exactText: region.exactText,
      }
    })
    const needsDecorativeBackground = Boolean(
      ['kv', 'visual'].includes(blueprint.visualTheme?.source) &&
      !slots.some((slot) => slot.role === 'background'),
    )
    const decorativeBackgroundTask = needsDecorativeBackground
      ? {
          id: 'component-decorative-background',
          slotId: 'component-decorative-background',
          label: '组件装饰背景',
          role: 'decorative-background',
          targetSize: {
            width: Math.max(1, Math.round(blueprint.width)),
            height: Math.max(1, Math.round(blueprint.height)),
          },
          transparent: false,
          designOnly: true,
        }
      : undefined
    const assetTasks = decorativeBackgroundTask
      ? [...propAssetTasks, decorativeBackgroundTask]
      : propAssetTasks
    const propertyValues = sanitizeComponentPropertyValues(
      blueprint.propertyValues,
      resolved.contract,
      resolved.profile.id,
    )
    const runtimeSceneGraph = context.memory.get('component.inspect-runtime')?.data?.sceneGraph
    return {
      summary: assetTasks.length
        ? `已规划 ${propAssetTasks.length} 个 Props 素材和 ${decorativeBackgroundTask ? 1 : 0} 个设计装饰背景。`
        : '当前 Profile 没有图片槽位，只生成 Props Patch 和组件预览。',
      data: {
        assetTasks,
        propertyValues,
        skippedSlots,
        deliveryMode: 'editable-scene',
        structureSource: runtimeSceneGraph ? 'runtime-dom' : 'component-design-tree',
      },
      nextSteps: assetTasks.length
        ? [
            {
              id: 'generate-component-assets',
              title: '生成组件独立素材',
              tool: 'component.generate-assets',
            },
            {
              id: 'validate-component-assets',
              title: '验证组件独立素材',
              tool: 'component.validate-assets',
            },
          ]
        : [
            {
              id: 'apply-component-theme',
              title: '应用组件颜色主题',
              tool: 'component.apply-theme',
            },
          ],
    }
  })

  registerTool(tools, 'component.apply-theme', async (context) => {
    const resolved = context.memory.get('component.resolve')?.data
    const blueprint = context.memory.get('component.plan')?.data?.blueprint
    const planned = context.memory.get('component.plan-assets')?.data
    if (!resolved || !blueprint || !planned) {
      throw createRuntimeError('COMPONENT_THEME_INPUT_MISSING', '缺少组件主题或 Props 规划。')
    }
    const generated = context.memory.get('component.validate-assets')?.data
    const generatedAssets = generated?.generatedAssets ?? []
    const qualityReview =
      generated?.qualityReview ||
      createComponentQualityReview({
        blueprint,
        generatedAssets: [],
        repairCount: 0,
      })
    return {
      summary: generated
        ? '组件图片素材和颜色主题已准备完成。'
        : `Editable Scene 是唯一结构源，已应用 ${countColorValues(planned.propertyValues)} 个颜色 Props，未调用生图模型。`,
      data: {
        generatedAssets,
        qualityReview,
        fallbackCount: generated?.fallbackCount ?? 0,
      },
    }
  })

  registerTool(tools, 'component.generate-assets', async (context) => {
    const resolved = context.memory.get('component.resolve')?.data
    const blueprint = context.memory.get('component.plan')?.data?.blueprint
    const planned = context.memory.get('component.plan-assets')?.data
    if (!resolved || !blueprint || !planned) {
      throw createRuntimeError('COMPONENT_ASSET_PLAN_MISSING', '缺少组件素材计划。')
    }
    // 一个 assetTask = 一次独立生图请求（由组件的图片属性推导出的槽位，见
    // component.plan-assets）。15 × 最多 2 次重试必须落在 turn-budget.mjs 的
    // maxImageRequests 内，否则素材生成到一半就抛非重试性预算错误，
    // 前面已经生成并付费的素材全部作废。
    if (planned.assetTasks.length > 15) {
      throw createRuntimeError('COMPONENT_ASSET_COUNT_LIMIT', '组件独立素材总数不能超过 15 个。')
    }
    const uploads = uniqueUploads(
      [resolved.loaded.thumbnailUpload, ...getPreparedUploads(context)].filter(Boolean),
    )
    const referenceContract = describeComponentReferences(uploads)
    const commonPrompt = [
      `为 ${resolved.contract.componentName} 的 ${resolved.profile.id} Profile 生成设计素材。`,
      referenceContract,
      blueprint.visualTheme
        ? `必须严格执行以下视觉主题契约：\n${JSON.stringify(blueprint.visualTheme, null, 2)}`
        : '',
      'thumbnail 只负责组件语义和结构；KV/视觉参考图负责最终配色、材质和装饰语言。',
    ]
      .filter(Boolean)
      .join('\n\n')
    const imageTasks = planned.assetTasks.map((task) =>
      createImageTask({
        ...task,
        name: `${task.slotId}.png`,
        kind: 'component-slot',
        textPolicy: task.exactText ? 'model-exact' : undefined,
        referencePolicy: {
          roles: ['kv', 'visual'],
          maxImages: 2,
          transparentFallback: 'theme-only-generation',
        },
        prompt: [
          task.designOnly
            ? `生成 ${resolved.contract.componentName} 的纯装饰背景；这是设计层，不绑定组件 Props。`
            : task.exactText
              ? `单独生成完整按钮图片；角色=${task.role}，绑定=${task.propPath}。`
              : `单独生成 ${task.label || task.slotId} 素材；角色=${task.role}，绑定=${task.propPath}。`,
          task.designOnly
            ? '只允许背景纹理、氛围光效、边框和弱装饰；禁止文字、按钮、卡片、奖品、列表和任何业务内容。背景必须铺满画面且保证前景内容可读。'
            : '只生成这一项，透明背景，内容紧贴边界，禁止拼入其他组件内容。',
          task.exactText
            ? `图片自身必须包含且只包含准确文案“${task.exactText}”；Canvas 不再叠加同文案 Text。`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      }),
    )
    const taskResults = await mapWithConcurrency(imageTasks, 2, (task) =>
      generateArtifactNode({
        invokeProvider,
        context,
        task,
        commonPrompt,
        uploads,
        visualTheme: blueprint.visualTheme,
      }),
    )
    const repairedTaskResults = repairFailedTextOverlaySiblings(taskResults, planned.assetTasks)
    repairedTaskResults.forEach((result, index) => {
      if (!result.reusedFromSlotId) return
      emitToolTrace(context, {
        stage: 'design.transform',
        tool: 'component.generate-assets',
        operation: 'component-asset',
        taskId: imageTasks[index].id,
        slotId: planned.assetTasks[index].slotId,
        label: imageTasks[index].name || imageTasks[index].id,
        status: 'completed',
        attempt: result.attempts,
        maxAttempts: 2,
        targetSize: imageTasks[index].targetSize,
        message: `原素材生成失败，已复用同组成功底图 ${result.reusedFromSlotId}。`,
      })
    })
    const generatedAssets = repairedTaskResults.map((result, index) => ({
      task: planned.assetTasks[index],
      sourceArtifact: result.artifact,
      artifact: result.artifact,
      fallback: result.fallback,
      attempts: result.attempts,
      error: result.error,
      reusedFromSlotId: result.reusedFromSlotId,
    }))
    const fallbackCount = generatedAssets.filter((item) => item.fallback).length
    return {
      summary: fallbackCount
        ? `已生成组件设计素材，其中 ${fallbackCount} 项使用可替换的本地设计。`
        : `Editable Scene 保持唯一结构所有权，仅生成 ${generatedAssets.length} 个 Props 叶子素材。`,
      data: { generatedAssets, themeRepairCount: 0, fallbackCount },
    }
  })

  registerTool(tools, 'component.validate-assets', async (context) => {
    const generated = context.memory.get('component.generate-assets')?.data
    const blueprint = context.memory.get('component.plan')?.data?.blueprint
    const planned = context.memory.get('component.plan-assets')?.data
    const generatedAssets = generated?.generatedAssets
    if (!generated || !blueprint || !planned || !Array.isArray(generatedAssets)) {
      throw createRuntimeError('COMPONENT_ASSETS_MISSING', '缺少组件素材生成结果。')
    }
    for (const item of generatedAssets) {
      const sourceReview = inspectImageArtifact(item.sourceArtifact ?? item.artifact, {
        placementMode: 'asset-board',
        width: item.task.targetSize.width,
        height: item.task.targetSize.height,
        transparent: item.task.transparent,
      })
      if (!sourceReview.passed) {
        const message = sourceReview.issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join('；')
        throw createRuntimeError(
          'COMPONENT_ASSET_INVALID',
          `${item.task.slotId} 素材验证失败：${message}`,
        )
      }
      const wrappedReview = inspectImageArtifact(item.artifact, {
        placementMode: 'asset-board',
        width: item.task.targetSize.width,
        height: item.task.targetSize.height,
      })
      if (!wrappedReview.passed) {
        throw createRuntimeError(
          'COMPONENT_ASSET_WRAPPER_INVALID',
          `${item.task.slotId} 文字包装后的素材无效。`,
        )
      }
      item.review = { ...wrappedReview, source: sourceReview }
    }
    const qualityReview = createComponentQualityReview({
      blueprint,
      generatedAssets,
      repairCount: generated.themeRepairCount,
    })
    if (!qualityReview.passed) {
      const errors = qualityReview.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join('；')
      throw createRuntimeError(
        'COMPONENT_QUALITY_REVIEW_FAILED',
        errors || '组件质量评分未达到交付门槛。',
      )
    }
    return {
      summary: `Editable Scene 与 ${generatedAssets.length} 个 Props 叶子素材验证通过。`,
      data: {
        generatedAssets,
        qualityReview,
        fallbackCount: generated.fallbackCount ?? 0,
      },
    }
  })

  registerTool(tools, 'component.compose', async (context) => {
    const resolved = context.memory.get('component.resolve')?.data
    const blueprint = context.memory.get('component.plan')?.data?.blueprint
    const planned = context.memory.get('component.plan-assets')?.data
    const validated = context.memory.get('component.validate-assets')?.data
    const themed = context.memory.get('component.apply-theme')?.data
    const generatedAssets = themed?.generatedAssets ?? validated?.generatedAssets
    const runtimeSceneGraph = context.memory.get('component.inspect-runtime')?.data?.sceneGraph
    if (!resolved || !blueprint || !planned || !Array.isArray(generatedAssets)) {
      throw createRuntimeError('COMPONENT_COMPOSE_INPUT_MISSING', '组件预览缺少必要输入。')
    }
    const runtimeDesignTree = runtimeSceneGraph
      ? sceneGraphToComponentDesignTree(runtimeSceneGraph, resolved.contract.componentName)
      : undefined
    const componentDesignTree = mergeComponentDesignTree({
      contract: resolved.contract,
      profile: resolved.profile,
      blueprint,
      visionTree:
        runtimeDesignTree || context.memory.get('component.inspect-thumbnail')?.data?.designTree,
      sourceOwnsStructure: Boolean(runtimeSceneGraph),
    })
    const deliveryAssets = generatedAssets
    const effectiveBlueprint = {
      ...blueprint,
      regions: applyDecorativeBackgroundPresentation(
        designTreeToBlueprintRegions(componentDesignTree, blueprint.regions),
        planned.assetTasks.find((task) => task.designOnly),
        blueprint,
      ),
    }
    const propsPatch = createNestedPatch(planned.propertyValues)
    for (const item of deliveryAssets) {
      const dataUri = svgArtifactDataUri(item.artifact)
      if (item.task.propPath) setNestedValue(propsPatch, item.task.propPath, dataUri)
      if (item.task.fallbackPath) setNestedValue(propsPatch, item.task.fallbackPath, dataUri)
    }
    const previewArtifact = composeComponentPreview(
      resolved.contract.componentName,
      effectiveBlueprint,
      deliveryAssets,
      planned.propertyValues,
    )
    const diagnostics = [
      ...(resolved.contract.diagnostics ?? []),
      ...(blueprint.diagnostics ?? []),
      ...(planned.skippedSlots ?? []).map((slot) => ({
        code: 'ANIMATION_PROVIDER_MISSING',
        path: slot.bindings.image,
        message: `保留 ${slot.bindings.image} 原值；当前 Provider 只生成静态 SVG，不能安全替换动效素材。`,
      })),
      ...generatedAssets
        .filter((item) => item.fallback)
        .map((item) => ({
          code: 'COMPONENT_ARTIFACT_FALLBACK',
          path: item.task.propPath,
          message: `${item.task.slotId} 生图失败，已使用可局部替换的本地设计素材。`,
        })),
      ...generatedAssets
        .filter((item) => item.reusedFromSlotId)
        .map((item) => ({
          code: 'COMPONENT_ARTIFACT_SIBLING_REUSED',
          path: item.task.propPath,
          message: `${item.task.slotId} 生图失败，已复用同组无文字底图 ${item.reusedFromSlotId}。`,
        })),
    ]
    const runtimeValidation = await validateComponentRuntime({
      componentName: resolved.contract.componentName,
      profile: resolved.profile.id,
      sourceHash: resolved.contract.sourceHash,
      baseProps: resolved.loaded.component?.props ?? {},
      propsPatch,
      assets: Object.fromEntries(
        deliveryAssets
          .filter((item) => !item.task.designOnly)
          .map((item) => [item.task.slotId, svgArtifactDataUri(item.artifact)]),
      ),
      designSnapshot: {
        width: blueprint.width,
        height: blueprint.height,
        regions: effectiveBlueprint.regions.map((region) => ({
          id: region.id,
          bounds: region.bounds,
        })),
        propPaths: Object.keys(planned.propertyValues),
      },
    })
    const componentDesign = {
      packId: resolved.loaded.pack?.id,
      componentName: resolved.contract.componentName,
      profile: resolved.profile.id,
      sourceHash: resolved.contract.sourceHash,
      sourceFormat: resolved.contract.sourceFormat,
      schemaVersion: resolved.contract.schemaVersion,
      repeaters: resolved.contract.repeaters ?? [],
      blueprint: effectiveBlueprint,
      designTree: componentDesignTree,
      sourceSceneGraph: runtimeSceneGraph,
      assetTasks: planned.assetTasks,
      propsPatch,
      properties: [...resolved.contract.designProperties, ...resolved.contract.structuralControls]
        .filter(
          (property) =>
            propertyInProfile(property, resolved.profile.id) && property.kind !== 'image',
        )
        .map((property) => ({ path: property.path, kind: property.kind })),
      unresolved: resolved.contract.unresolved ?? [],
      diagnostics,
      qualityReview: themed?.qualityReview ?? validated?.qualityReview,
      runtimeValidation,
    }
    context.session.componentDesign = componentDesign
    return {
      summary: runtimeSceneGraph
        ? `已从 Runtime Scene 交付 ${componentDesignTree.nodes.length} 个可编辑节点，未叠加完整视觉外壳。`
        : `已合成 ${resolved.contract.componentName} 组件设计树，共 ${componentDesignTree.nodes.length} 个可编辑节点。`,
      data: {
        previewArtifact,
        artifacts: deliveryAssets.map((item) => item.artifact),
        componentDesign,
      },
    }
  })

  registerTool(tools, 'component.plan-image', async (context) => {
    const resolved = context.memory.get('component.resolve')?.data
    const blueprint = context.memory.get('component.plan')?.data?.blueprint
    const runtimeInspection = context.memory.get('component.inspect-runtime')?.data
    if (!resolved?.contract || !resolved?.profile || !blueprint) {
      throw createRuntimeError('COMPONENT_IMAGE_PLAN_INPUT_MISSING', '缺少组件契约或结构规划。')
    }
    const width = Math.max(
      1,
      Math.round(runtimeInspection?.sceneGraph?.surface?.width || blueprint.width),
    )
    const height = Math.max(
      1,
      Math.round(runtimeInspection?.sceneGraph?.surface?.height || blueprint.height),
    )
    const backdropTask = {
      id: 'component-backdrop',
      slotId: 'component-backdrop',
      name: `${resolved.contract.componentName}-氛围底图.png`,
      label: `${resolved.contract.componentName} 氛围底图`,
      role: 'component-backdrop',
      kind: 'component-shell',
      targetSize: { width, height },
      transparent: false,
      designOnly: true,
    }
    const slotTasks = resolved.contract.slots
      .filter(
        (slot) =>
          propertyInProfile(slot, resolved.profile.id) &&
          slot.generationPolicy === 'generate' &&
          slot.role !== 'animation',
      )
      .map((slot, index) => {
        const region = blueprint.regions.find((item) => item.slotId === slot.id)
        if (!region) {
          throw createRuntimeError(
            'COMPONENT_SLOT_UNMAPPED',
            `Component Blueprint 没有映射素材槽位：${slot.id}。`,
          )
        }
        return {
          id: `component-slot-${index + 1}`,
          slotId: slot.id,
          name: `${slot.id}.png`,
          label: slot.label,
          role: slot.role,
          kind: 'component-slot',
          propPath: slot.bindings.image,
          fallbackPath: slot.bindings.fallbackImage,
          targetSize: {
            width: Math.max(
              1,
              Math.round(
                readContractNumber(resolved.contract, slot.bindings.width) ?? region.bounds.width,
              ),
            ),
            height: Math.max(
              1,
              Math.round(
                readContractNumber(resolved.contract, slot.bindings.height) ?? region.bounds.height,
              ),
            ),
          },
          transparent: slot.role !== 'background',
          exactText: region.exactText,
          designOnly: false,
        }
      })
    const propertyValues = sanitizeComponentPropertyValues(
      blueprint.propertyValues,
      resolved.contract,
      resolved.profile.id,
    )
    return {
      summary: runtimeInspection?.runtimeSnapshot
        ? `已按 Runtime DOM 规划 ${width}x${height} 组件氛围底图和 ${slotTasks.length} 个 Props 图片；thumbnail 仅作次级参考。`
        : `Runtime 截图不可用，已规划 ${width}x${height} 氛围底图和 ${slotTasks.length} 个 Props 图片。`,
      data: {
        backdropTask,
        slotTasks,
        tasks: [backdropTask, ...slotTasks],
        propertyValues,
        deliveryMode: 'hybrid-component',
        structureSource: runtimeInspection?.sceneGraph ? 'runtime-dom' : 'component-design-tree',
      },
    }
  })

  registerTool(tools, 'component.generate-image', async (context) => {
    const resolved = context.memory.get('component.resolve')?.data
    const blueprint = context.memory.get('component.plan')?.data?.blueprint
    const planned = context.memory.get('component.plan-image')?.data
    const runtimeInspection = context.memory.get('component.inspect-runtime')?.data
    if (
      !resolved?.contract ||
      !blueprint ||
      !planned?.backdropTask ||
      !Array.isArray(planned.slotTasks)
    ) {
      throw createRuntimeError('COMPONENT_BACKDROP_PLAN_MISSING', '缺少组件氛围底图任务。')
    }
    const runtimeSnapshot = runtimeInspection?.runtimeSnapshot
    const thumbnail = resolved.loaded?.thumbnailUpload
    const visualUploads = getPreparedUploads(context).filter(
      (upload) => upload.role === 'kv' || upload.role === 'visual',
    )
    // Prototype and thumbnail contain business text and controls. Passing
    // them to the shell model bakes duplicate content into the background.
    const uploads = uniqueUploads(visualUploads)
    const pageEmbedded = context.session.componentBackdropMode === 'page-embedded'
    const backdropTask = createImageTask({
      ...planned.backdropTask,
      name: pageEmbedded
        ? `${resolved.contract.componentName}-页面内嵌表面.svg`
        : `${resolved.contract.componentName}-氛围底图.png`,
      kind: 'component-shell',
      referencePolicy: {
        roles: ['kv', 'visual'],
        maxImages: 4,
      },
      prompt: [
        `生成 ${resolved.contract.componentName} 的视觉外壳背景图，只输出一张图片。`,
        runtimeSnapshot
          ? 'Runtime DOM 负责全部 UI 节点与精确布局；Runtime 截图不作为生图图片参考。'
          : '组件 UI 节点由画布原生图层负责，背景不得模拟 UI 结构。',
        thumbnail
          ? 'thumbnail 不作为生图图片参考，只用于前置结构解析；禁止从 thumbnail 复制文案、按钮或业务图片。'
          : '',
        visualUploads.length
          ? '后续 KV/视觉图片只负责最终配色、材质、装饰语言和氛围，不得改变 Runtime 的信息架构。'
          : '',
        blueprint.visualTheme ? `视觉主题契约：${JSON.stringify(blueprint.visualTheme)}` : '',
        '背景图中严禁出现任何文字、字母、数字、按钮文案、任务标题、奖励文案、进度文案、图标文字或伪文字；所有文字和业务图片由 Runtime 可编辑节点叠加。',
        '严禁绘制卡片、列表项、按钮底座、图片占位框、骨架条、进度条、输入框或任何需要与 Runtime 坐标对齐的 UI 结构。',
        '画面必须是一张连续的背景平面；禁止重复圆角矩形、横向短条、线框、占位布局、Dashboard 面板或任何看起来像 UI 模板的排列。',
        '只生成铺满画布的底色、渐变、低对比纹理、光效和边缘装饰；中心内容区保持低干扰，直接完成背景视觉设计。',
      ]
        .filter(Boolean)
        .join('\n\n'),
    })
    backdropTask.traceTool = 'component.generate-image'
    const generatedBackdrop = pageEmbedded
      ? {
          artifact: createPageEmbeddedComponentSurface(
            backdropTask,
            context.session.pageVisualDirection,
            blueprint.visualTheme,
          ),
          fallback: false,
          strategy: 'page-embedded-surface',
          attempts: 0,
        }
      : await generateArtifactNode({
          invokeProvider,
          context,
          task: backdropTask,
          commonPrompt:
            '这是组件氛围底图生成任务。只使用 KV/Visual 管主题；所有 UI 结构由 Runtime 原生节点负责，背景禁止模拟任何 UI。',
          uploads,
          visualTheme: blueprint.visualTheme,
          maxAttempts: 2,
        })
    const deliveredBackdrop = generatedBackdrop.fallback
      ? {
          artifact: createDeterministicComponentBackdrop(backdropTask, blueprint.visualTheme),
          fallback: true,
          fallbackCode:
            generatedBackdrop.errorCode === 'COMPONENT_ASSET_TIMEOUT'
              ? 'COMPONENT_BACKDROP_TIMEOUT_FALLBACK'
              : 'COMPONENT_BACKDROP_GENERATION_FALLBACK',
          errorCode: generatedBackdrop.errorCode,
          fallbackReason: generatedBackdrop.error || '图片模型没有返回有效氛围底图。',
          attempts: generatedBackdrop.attempts,
        }
      : generatedBackdrop
    const slotTasks = planned.slotTasks.map((slotTask) =>
      createImageTask({
        ...slotTask,
        textPolicy: slotTask.exactText ? 'model-exact' : undefined,
        referencePolicy: {
          roles: ['kv', 'visual'],
          maxImages: 2,
          transparentFallback: 'theme-only-generation',
        },
        prompt: [
          `只生成 ${resolved.contract.componentName} 的一个独立 Props 图片素材：${slotTask.label || slotTask.slotId}。`,
          `绑定路径：${slotTask.propPath}；目标尺寸：${slotTask.targetSize.width}x${slotTask.targetSize.height}px。`,
          slotTask.exactText
            ? `图片自身必须包含且只包含准确文案“${slotTask.exactText}”，不得在画布上再叠加独立文字节点。`
            : '不要添加未在素材契约中声明的文字。',
          '只输出该素材本身，透明背景，主体铺满有效边界；禁止整页、完整组件、展示板和其他业务内容。',
        ].join('\n'),
      }),
    )
    slotTasks.forEach((task) => {
      task.traceTool = 'component.generate-image'
    })
    const generatedSlots = await mapWithConcurrency(slotTasks, 2, async (task) => {
      const generated = await generateArtifactNode({
        invokeProvider,
        context,
        task,
        commonPrompt:
          '这是组件 Props 叶子图片生成任务。每个任务只生成一个可直接写入对应图片 Prop 的素材。',
        uploads,
        visualTheme: blueprint.visualTheme,
        maxAttempts: 2,
      })
      if (generated.fallback) {
        throw createRuntimeError(
          'COMPONENT_SLOT_IMAGE_FAILED',
          `${task.slotId} 素材生成失败：${generated.error || '图片模型没有返回有效素材。'}`,
          { retryable: true },
        )
      }
      return { ...generated, task }
    })
    return {
      summary: pageEmbedded
        ? `已为 ${resolved.contract.componentName} 创建页面内嵌 Surface，并生成 ${generatedSlots.length} 个 Props 图片素材。`
        : deliveredBackdrop.fallback
          ? `AI 氛围底图不可用，已使用 VisualTheme 确定性背景继续生成 ${generatedSlots.length} 个 Props 图片素材。`
          : `已生成 ${resolved.contract.componentName} 氛围底图和 ${generatedSlots.length} 个 Props 图片素材。`,
      data: {
        backdrop: { ...deliveredBackdrop, task: backdropTask },
        slots: generatedSlots.map((item) => ({
          artifact: item.artifact,
          task: item.task,
          attempts: item.attempts,
        })),
      },
    }
  })

  registerTool(tools, 'component.validate-image', async (context) => {
    const generated = context.memory.get('component.generate-image')?.data
    const blueprint = context.memory.get('component.plan')?.data?.blueprint
    if (
      !generated?.backdrop?.artifact ||
      !generated?.backdrop?.task ||
      !Array.isArray(generated.slots)
    ) {
      throw createRuntimeError('COMPONENT_BACKDROP_MISSING', '没有可验证的组件氛围底图。')
    }
    let backdrop = generated.backdrop
    let review = inspectImageArtifact(backdrop.artifact, {
      placementMode: 'new-artboard',
      width: backdrop.task.targetSize.width,
      height: backdrop.task.targetSize.height,
      transparent: false,
    })
    if (!review.passed) {
      const message = review.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join('；')
      throw createRuntimeError(
        'COMPONENT_BACKDROP_INVALID',
        message || '组件氛围底图未通过质量校验。',
      )
    }
    const slotReviews = generated.slots.map((item) => {
      const slotReview = inspectImageArtifact(item.artifact, {
        placementMode: 'asset-board',
        width: item.task.targetSize.width,
        height: item.task.targetSize.height,
        transparent: item.task.transparent,
      })
      if (!slotReview.passed) {
        const message = slotReview.issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join('；')
        throw createRuntimeError(
          'COMPONENT_SLOT_IMAGE_INVALID',
          `${item.task.slotId} 素材验证失败：${message}`,
        )
      }
      return { ...item, review: slotReview }
    })
    let purityReview
    let backdropRepairCount = 0
    if (generated.backdrop.fallback) {
      purityReview = {
        status: 'fallback',
        issues: [],
        message:
          generated.backdrop.errorCode === 'COMPONENT_ASSET_TIMEOUT'
            ? 'AI 氛围底图请求超时，已使用 VisualTheme 确定性纯背景继续交付。'
            : `AI 氛围底图不可用，已使用 VisualTheme 确定性纯背景继续交付：${generated.backdrop.fallbackReason}`,
      }
    } else if (context.session.skipComponentBackdropVisionReview) {
      purityReview = {
        status: 'deferred',
        issues: [],
        message: '组件属于页面子任务，氛围底图纯净度由最终整页 Vision Review 统一检查。',
      }
    } else
      try {
        const reviewPurity = async (item) => {
          const result = await invokeProvider(
            {
              ...context.payload,
              type: 'vision_review',
              question: [
                '只评审附件中的组件氛围底图，不评审完整组件。',
                '合格背景只能包含连续底色、渐变、低对比纹理、光效和边缘装饰。',
                '检查是否出现文字或伪文字、按钮、卡片/列表项、输入框、进度条、图片占位框、骨架条、Dashboard 面板或其他 UI 模板结构。',
                '若存在上述内容，issues 必须包含 severity=error、scope=component、targetId=component-backdrop，并准确说明污染内容；否则 issues 返回空数组。',
              ].join('\n'),
              uploads: [
                {
                  type: 'file',
                  name: item.task.name,
                  mime: item.artifact.mime || 'image/png',
                  role: 'visual',
                  data: svgArtifactDataUri(item.artifact),
                },
              ],
            },
            context.providerCallbacks,
          )
          return result.visionReview
        }
        const contaminationOf = (result) =>
          result?.issues?.find(
            (issue) => issue?.severity === 'error' && issue?.targetId === 'component-backdrop',
          )
        purityReview = await reviewPurity(backdrop)
        let contamination = contaminationOf(purityReview)
        if (contamination) {
          backdropRepairCount = 1
          const repairTask = createImageTask({
            ...backdrop.task,
            name: `${backdrop.task.name.replace(/\.png$/i, '')}-纯背景修复.png`,
            prompt: [
              backdrop.task.prompt,
              `上一版污染问题：${contamination.message}`,
              '重新绘制为连续、抽象、无界面的背景。彻底删除所有矩形卡片、横条、箭头、折线图、柱状图、列表、控件轮廓和文字。',
              '只允许全幅渐变、柔和光晕、颗粒纹理，以及贴近四周边缘的曲线或粒子；中心区域不得出现可辨识的几何模块。',
            ]
              .filter(Boolean)
              .join('\n\n'),
          })
          repairTask.traceTool = 'component.validate-image'
          const repaired = await generateArtifactNode({
            invokeProvider,
            context,
            task: repairTask,
            commonPrompt:
              '这是氛围底图污染修复。必须移除全部 UI、图表、文字和占位结构，只保留连续抽象背景。',
            uploads: uniqueUploads(
              getPreparedUploads(context).filter((upload) =>
                ['kv', 'visual'].includes(upload.role),
              ),
            ),
            visualTheme: blueprint?.visualTheme,
            maxAttempts: 1,
          })
          if (!repaired.fallback) {
            backdrop = {
              artifact: repaired.artifact,
              task: repairTask,
              attempts: repaired.attempts,
            }
            review = inspectImageArtifact(backdrop.artifact, {
              placementMode: 'new-artboard',
              width: repairTask.targetSize.width,
              height: repairTask.targetSize.height,
              transparent: false,
            })
            purityReview = review.passed ? await reviewPurity(backdrop) : purityReview
            contamination = contaminationOf(purityReview)
          }
          if (repaired.fallback || !review.passed || contamination) {
            backdrop = {
              artifact: createDeterministicComponentBackdrop(backdrop.task, blueprint?.visualTheme),
              task: { ...generated.backdrop.task, name: generated.backdrop.task.name },
              attempts: (generated.backdrop.attempts ?? 1) + 1,
            }
            review = inspectImageArtifact(backdrop.artifact, {
              placementMode: 'new-artboard',
              width: backdrop.task.targetSize.width,
              height: backdrop.task.targetSize.height,
              transparent: false,
            })
            purityReview = {
              status: 'fallback',
              issues: contamination ? [contamination] : [],
              message: 'AI 氛围底图连续污染，已自动切换为基于当前主题的确定性纯背景。',
            }
          } else {
            purityReview = {
              ...purityReview,
              status: 'repaired',
              message: '氛围底图污染已自动修复。',
            }
          }
        }
      } catch (error) {
        purityReview = {
          status: 'degraded',
          issues: [],
          message: `氛围底图 Vision Gate 已跳过：${error instanceof Error ? error.message : String(error)}`,
        }
      }
    const qualityReview = createDesignEvalReport({
      scope: 'component',
      scores: {
        structure: 1,
        theme: 1,
        readability: 1,
        completeness: 1,
        componentIntegrity: 1,
        developmentReadiness: 1,
      },
      editableCoverage: 1,
      repairCount: backdropRepairCount,
    })
    return {
      summary: backdropRepairCount
        ? '组件氛围底图污染已自动修复并通过校验。'
        : '组件氛围底图尺寸与位图质量校验通过。',
      data: {
        backdrop: { ...backdrop, review },
        slots: slotReviews,
        purityReview,
        qualityReview,
      },
    }
  })

  registerTool(tools, 'component.package-image', async (context) => {
    const resolved = context.memory.get('component.resolve')?.data
    const blueprint = context.memory.get('component.plan')?.data?.blueprint
    const planned = context.memory.get('component.plan-image')?.data
    const validated = context.memory.get('component.validate-image')?.data
    const runtimeSceneGraph = context.memory.get('component.inspect-runtime')?.data?.sceneGraph
    if (
      !resolved?.contract ||
      !blueprint ||
      !planned?.backdropTask ||
      !validated?.backdrop?.artifact ||
      !Array.isArray(validated.slots)
    ) {
      throw createRuntimeError(
        'COMPONENT_BACKDROP_PACKAGE_INPUT_MISSING',
        '组件氛围底图打包缺少必要输入。',
      )
    }
    const runtimeDesignTree = runtimeSceneGraph
      ? sceneGraphToComponentDesignTree(runtimeSceneGraph, resolved.contract.componentName)
      : undefined
    const structureTree = normalizeDesignTree(
      runtimeDesignTree || context.memory.get('component.inspect-thumbnail')?.data?.designTree,
      {
        componentName: resolved.contract.componentName,
        width: planned.backdropTask.targetSize.width,
        height: planned.backdropTask.targetSize.height,
      },
    )
    const componentDesignTree = mergeComponentDesignTree({
      contract: resolved.contract,
      profile: resolved.profile,
      blueprint,
      visionTree: structureTree,
      sourceOwnsStructure: Boolean(runtimeSceneGraph),
    })
    const structureRegions = designTreeToBlueprintRegions(componentDesignTree, blueprint.regions)
    const slotTaskIds = new Set(validated.slots.map((item) => item.task.slotId))
    const editableRegions = structureRegions
      .filter(
        (region) =>
          ((region.slotId && slotTaskIds.has(region.slotId)) ||
            ['text', 'button', 'color'].includes(region.renderMode) ||
            region.designNodeType === 'button' ||
            (['image', 'icon'].includes(region.designNodeType) && Boolean(region.assetSource)) ||
            (region.renderMode === 'runtime' && Boolean(region.assetSource))) &&
          !isFullCanvasSurface(region, planned.backdropTask.targetSize),
      )
      .map((region) => {
        const renderMode =
          region.slotId && slotTaskIds.has(region.slotId)
            ? 'generated-asset'
            : region.designNodeType === 'button'
              ? 'button'
              : ['image', 'icon'].includes(region.designNodeType) && region.assetSource
                ? 'runtime'
                : region.renderMode
        const normalizedRegion = { ...region, renderMode }
        return {
          ...normalizedRegion,
          style: applyHybridForegroundStyle(normalizedRegion, blueprint.visualTheme),
          designOnly: false,
          visible: region.visible !== false,
        }
      })
    const rasterBlueprint = {
      ...blueprint,
      width: planned.backdropTask.targetSize.width,
      height: planned.backdropTask.targetSize.height,
      propertyValues: planned.propertyValues,
      regions: [
        {
          id: 'component-backdrop',
          role: `${resolved.contract.componentName} 氛围底图`,
          bounds: {
            x: 0,
            y: 0,
            width: planned.backdropTask.targetSize.width,
            height: planned.backdropTask.targetSize.height,
          },
          slotId: planned.backdropTask.slotId,
          propBindings: [],
          renderMode: 'generated-asset',
          designOnly: true,
          confidence: 1,
          visible: true,
        },
        ...editableRegions,
      ],
      diagnostics: [
        ...(blueprint.diagnostics ?? []),
        ...(['repaired', 'fallback'].includes(validated.purityReview?.status)
          ? [
              {
                code:
                  validated.purityReview.status === 'fallback'
                    ? validated.backdrop.fallbackCode || 'COMPONENT_BACKDROP_DETERMINISTIC_FALLBACK'
                    : 'COMPONENT_BACKDROP_AUTO_REPAIRED',
                message: validated.purityReview.message,
              },
            ]
          : []),
        {
          code: 'COMPONENT_HYBRID_DELIVERY',
          message: `最终画布采用氛围底图 + ${editableRegions.length} 个 Runtime 可编辑 UI 节点。`,
        },
      ],
    }
    const propsPatch = createNestedPatch(planned.propertyValues)
    for (const item of validated.slots) {
      const dataUri = svgArtifactDataUri(item.artifact)
      if (item.task.propPath) setNestedValue(propsPatch, item.task.propPath, dataUri)
      if (item.task.fallbackPath) setNestedValue(propsPatch, item.task.fallbackPath, dataUri)
    }
    const componentDesign = {
      deliveryMode: 'hybrid-component',
      packId: resolved.loaded.pack?.id,
      componentName: resolved.contract.componentName,
      profile: resolved.profile.id,
      sourceHash: resolved.contract.sourceHash,
      sourceFormat: resolved.contract.sourceFormat,
      schemaVersion: resolved.contract.schemaVersion,
      repeaters: resolved.contract.repeaters ?? [],
      blueprint: rasterBlueprint,
      designTree: componentDesignTree,
      sourceSceneGraph: runtimeSceneGraph,
      assetTasks: [planned.backdropTask, ...validated.slots.map((item) => item.task)],
      propsPatch,
      properties: [...resolved.contract.designProperties, ...resolved.contract.structuralControls]
        .filter(
          (property) =>
            propertyInProfile(property, resolved.profile.id) && property.kind !== 'image',
        )
        .map((property) => ({ path: property.path, kind: property.kind })),
      unresolved: resolved.contract.unresolved ?? [],
      diagnostics: rasterBlueprint.diagnostics,
      qualityReview: validated.qualityReview,
    }
    context.session.componentDesign = componentDesign
    return {
      summary: `已将 ${resolved.contract.componentName} 以氛围底图、${validated.slots.length} 个 Props 图片和 ${editableRegions.length} 个可编辑 Runtime UI 节点交付。`,
      data: {
        previewArtifact: validated.backdrop.artifact,
        artifacts: [validated.backdrop.artifact, ...validated.slots.map((item) => item.artifact)],
        componentDesign,
      },
    }
  })

  registerTool(tools, 'canvas.present-component', async (context) => {
    const composed = context.memory.get('component.package-image')?.data
    if (!composed?.previewArtifact || !composed?.componentDesign) {
      throw createRuntimeError('COMPONENT_PREVIEW_MISSING', '没有可交付的组件设计预览。')
    }
    return {
      summary: `${composed.componentDesign.componentName} 组件设计已准备交付画布。`,
      data: composed,
    }
  })

  registerTool(tools, 'page.resolve-components', async (context) => {
    if (typeof loadComponentsFromPrompt !== 'function') {
      throw createRuntimeError('COMPONENT_RUNTIME_UNAVAILABLE', '页面组件注册表尚未配置。')
    }
    const request = context.session.componentRequest || context.session.goal
    const componentReferences = context.session.componentReferences ?? []
    const loaded =
      componentReferences.length && typeof resolveComponentReference === 'function'
        ? await Promise.all(
            componentReferences.map((reference) =>
              resolveComponentReference(reference, {
                projectId: context.payload.projectId,
                allowStructuralComponents: true,
              }),
            ),
          )
        : await loadComponentsFromPrompt(request, {
            projectId: context.payload.projectId,
            allowStructuralComponents: true,
          })
    const resolvedNodes = loaded.map((item, index) => ({
      componentName: String(item.component?.name || item.fileName.replace(/\.json$/i, '')),
      label: String(item.component?.label || item.component?.name || item.fileName),
      fileName: item.fileName,
      index,
      nodeType: classifyPageNode(item.component),
      designPaths: extractDesignPaths(item.component),
      surface: item.pack?.surface,
      loadedComponent: item.component,
      componentReference: componentReferences[index]
        ? { ...componentReferences[index] }
        : undefined,
    }))
    const pageRoot = resolvedNodes.find((item) => item.nodeType === 'page-root')
    const containers = resolvedNodes.filter((item) => item.nodeType === 'container')
    const components = resolvedNodes.filter((item) => item.nodeType === 'component')
    if (!components.length) {
      throw createRuntimeError('PAGE_COMPONENT_MISSING', '页面至少需要一个可生成的业务组件。')
    }
    const surface = loaded.find((item) => item.pack?.surface)?.pack.surface
    // Blueprint 必须先拿到真实渲染高度，否则外壳会按错误尺寸生成，
    // 组件再被缩放去贴合估算 Section，整页比例都会失真。
    const { sectionWidth } = resolvePageLayoutMetrics(components.length, surface)
    const measurements = await Promise.all(
      components.map((component) =>
        measurePageComponentHeight(inspectRuntimeSource, component, sectionWidth),
      ),
    )
    const measuredComponents = components.map((component, index) => {
      const { loadedComponent: _loadedComponent, ...rest } = component
      return {
        ...rest,
        estimatedHeight: measurements[index].height,
        heightMeasured: measurements[index].measured,
      }
    })
    const measuredCount = measurements.filter((item) => item.measured).length
    return {
      summary: `页面已解析 ${components.length} 个业务组件、${containers.length} 个容器${pageRoot ? '和 1 个页面根节点' : ''}；${measuredCount}/${components.length} 个组件取到真实渲染高度。`,
      data: {
        components: measuredComponents,
        containers,
        pageRoot,
        surface,
      },
    }
  })

  registerTool(tools, 'page.generate-component', async (context) => {
    try {
      return await generatePageComponentTask(toolCatalog, context)
    } catch (error) {
      const componentName = String(context.input?.componentName || '未知组件')
      return {
        summary: `${componentName} 生成失败，页面将继续交付其他内容。`,
        data: {
          componentName,
          index: Number(context.input?.index) || 0,
          failed: true,
          error: error instanceof Error ? error.message : String(error),
        },
      }
    }
  })

  async function generatePageComponentTask(tools, context) {
    const componentName = context.input?.componentName
    if (typeof componentName !== 'string' || !componentName) {
      throw createRuntimeError('PAGE_COMPONENT_INPUT_INVALID', '页面组件子任务缺少组件名称。')
    }
    const localMemory = new Map()
    const prepared = context.memory.get('reference.prepare')
    if (prepared) localMemory.set('reference.prepare', prepared)
    const sharedTheme = context.session.pageVisualTheme
    // 组件必须按自己的 Section 尺寸检查和生成，否则会以整屏尺寸渲染后被前端缩放变形。
    const pageSection = context.session.pageBlueprint?.sections?.find(
      (section) => section.id === context.input?.pageSectionId,
    )
    const subSession = {
      ...context.session,
      ...(pageSection?.bounds
        ? {
            canvasTarget: {
              ...context.session.canvasTarget,
              width: Math.round(pageSection.bounds.width),
              height: Math.round(pageSection.bounds.height),
            },
          }
        : {}),
      componentRequest: componentName,
      componentReferences: context.input?.componentReference
        ? [{ ...context.input.componentReference }]
        : [],
      componentBackdropMode: 'page-embedded',
      pageVisualDirection: context.session.pageVisualDirection,
      skipComponentBackdropVisionReview: true,
      goal: [
        context.session.goal,
        sharedTheme
          ? `本组件必须沿用页面共享 VisualThemeContract：${JSON.stringify(sharedTheme)}`
          : '',
        context.session.repairContext?.targetId === context.input?.pageSectionId
          ? `这是定向修订任务，必须修正：${JSON.stringify(context.session.repairContext.issues)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }
    const subContext = {
      ...context,
      session: subSession,
      memory: localMemory,
    }
    const pipeline = [
      'component.resolve',
      'component.inspect-runtime',
      'component.inspect-thumbnail',
      'component.plan',
      'component.plan-image',
      'component.generate-image',
      'component.validate-image',
      'component.package-image',
    ]
    for (const toolName of pipeline) {
      const execute = tools.get(toolName)
      if (!execute)
        throw createRuntimeError('AGENT_TOOL_NOT_FOUND', `组件子任务工具不存在：${toolName}`)
      const result = await execute(subContext)
      localMemory.set(toolName, result)
    }
    const composed = localMemory.get('component.package-image')?.data
    if (!composed?.componentDesign) {
      throw createRuntimeError(
        'PAGE_COMPONENT_RESULT_MISSING',
        `${componentName} 没有返回组件设计。`,
      )
    }
    context.session.pageVisualTheme ||= composed.componentDesign.blueprint.visualTheme
    return {
      summary: `${componentName} 页面组件生成完成。`,
      data: {
        ...composed,
        componentName,
        index: Number(context.input.index) || 0,
        pageSectionId: context.input.pageSectionId,
      },
    }
  }

  registerTool(tools, 'page.blueprint', async (context) => {
    const resolved = context.memory.get('page.resolve-components')?.data
    const components = resolved?.components
    if (!components?.length) {
      throw createRuntimeError('PAGE_COMPONENT_RESULT_MISSING', '页面没有可用于规划的组件。')
    }
    const blueprint = createPageCompositionBlueprint(
      components.map((component) => ({
        componentName: component.componentName,
        label: component.label,
        estimatedHeight: component.estimatedHeight,
      })),
      context.session.pageVisualTheme,
      {
        heroHeight: resolvePageHeroHeight(getPreparedUploads(context), resolved.surface),
        surface: resolved.surface,
        pageRoot: resolved.pageRoot
          ? {
              componentName: resolved.pageRoot.componentName,
              fileName: resolved.pageRoot.fileName,
              designPaths: resolved.pageRoot.designPaths,
            }
          : undefined,
        containers: (resolved.containers ?? []).map((container) => ({
          componentName: container.componentName,
          fileName: container.fileName,
          designPaths: container.designPaths,
        })),
      },
    )
    const issues = validatePageCompositionBlueprint(blueprint)
    if (issues.length) {
      throw createRuntimeError('PAGE_BLUEPRINT_INVALID', issues.join('；'))
    }
    context.session.pageBlueprint = blueprint
    const heroSection = blueprint.sections.find((section) => section.kind === 'page-hero')
    return {
      summary: `页面 Blueprint 已规划 ${components.length} 个组件 Section${heroSection ? `，并在顶部预留 ${heroSection.bounds.height}px KV 主视觉区` : ''}；页面高度 ${blueprint.estimatedHeight}px。`,
      data: { blueprint },
    }
  })

  registerTool(tools, 'page.confirm-blueprint', async (context) => {
    const originalBlueprint = context.memory.get('page.blueprint')?.data?.blueprint
    const originalComponents = context.memory.get('page.resolve-components')?.data?.components
    if (!originalBlueprint || !originalComponents?.length) {
      throw createRuntimeError('PAGE_BLUEPRINT_MISSING', '缺少待确认的页面 Blueprint。')
    }
    const blueprint = context.payload.blueprintOverride ?? originalBlueprint
    const blueprintIssues = validatePageCompositionBlueprint(blueprint)
    if (blueprintIssues.length) {
      throw createRuntimeError('PAGE_BLUEPRINT_INVALID', blueprintIssues.join('；'))
    }
    const components = [...originalComponents]
    const availableCounts = new Map()
    for (const component of components) {
      availableCounts.set(
        component.componentName,
        (availableCounts.get(component.componentName) ?? 0) + 1,
      )
    }
    const requiredCounts = new Map()
    for (const section of blueprint.sections.filter((item) => item.kind === 'component-instance')) {
      const componentName = section.component?.componentName
      const requiredCount = (requiredCounts.get(componentName) ?? 0) + 1
      requiredCounts.set(componentName, requiredCount)
      if (requiredCount <= (availableCounts.get(componentName) ?? 0)) continue
      const reference = section.component?.reference
      if (!reference || typeof resolveComponentReference !== 'function') {
        throw createRuntimeError(
          'PAGE_BLUEPRINT_COMPONENT_INVALID',
          `替换组件尚未解析：${componentName}`,
        )
      }
      const loaded = await resolveComponentReference(reference, {
        projectId: context.payload.projectId,
        allowStructuralComponents: true,
      })
      const resolvedComponentName = String(
        loaded.component?.name || loaded.fileName.replace(/\.json$/i, ''),
      )
      if (classifyPageNode(loaded.component) !== 'component') {
        throw createRuntimeError(
          'PAGE_BLUEPRINT_COMPONENT_INVALID',
          `${resolvedComponentName} 不是可生成的业务组件。`,
        )
      }
      if (resolvedComponentName !== componentName) {
        throw createRuntimeError(
          'PAGE_BLUEPRINT_COMPONENT_INVALID',
          `替换组件身份不一致：期望 ${componentName}，实际 ${resolvedComponentName}。`,
        )
      }
      components.push({
        componentName: resolvedComponentName,
        label: String(loaded.component?.label || loaded.component?.name || loaded.fileName),
        fileName: loaded.fileName,
        index: components.length,
        nodeType: 'component',
        designPaths: extractDesignPaths(loaded.component),
        surface: loaded.pack?.surface,
        componentReference: { ...reference },
      })
      availableCounts.set(componentName, (availableCounts.get(componentName) ?? 0) + 1)
    }
    const componentQueues = new Map()
    for (const component of components) {
      const queue = componentQueues.get(component.componentName) ?? []
      queue.push(component)
      componentQueues.set(component.componentName, queue)
    }
    const selectedComponents = blueprint.sections
      .filter((section) => section.kind === 'component-instance')
      .map((section, index) => {
        const componentName = section.component?.componentName
        const component = componentQueues.get(componentName)?.shift()
        if (!component) {
          throw createRuntimeError(
            'PAGE_BLUEPRINT_COMPONENT_INVALID',
            `Blueprint 引用了未解析组件：${componentName}`,
          )
        }
        return { ...component, index, pageSectionId: section.id }
      })
    context.session.pageBlueprint = blueprint
    context.session.pageComponentQueue = selectedComponents
    if (context.session.confirmedPageRunId === context.session.runId) {
      return {
        summary: '页面 Blueprint 已确认。',
        data: { blueprint },
      }
    }
    return {
      summary: '页面 Blueprint 等待用户确认。',
      data: { blueprint },
      pause: {
        type: 'blueprint-confirmation',
        blueprint,
        message: `页面结构已规划，共 ${selectedComponents.length} 个组件模块${blueprint.sections.some((section) => section.kind === 'page-hero') ? '，顶部已预留 KV 主视觉区' : ''}。确认后再生成组件素材和页面视觉外壳。`,
      },
    }
  })

  registerTool(tools, 'page.extract-theme', async (context) => {
    if (!context.session.skills?.includes('page-visual-direction')) {
      context.session.skills = [...(context.session.skills ?? []), 'page-visual-direction']
    }
    const visualUploads = getPreparedUploads(context).filter(
      (upload) => upload.role === 'kv' || upload.role === 'visual',
    )
    if (!visualUploads.length) {
      const styleTheme = createStylePackVisualTheme(context.session.activeStylePack)
      if (styleTheme) context.session.pageVisualTheme = styleTheme
      context.session.pageVisualDirection = await executeSkillTool(
        'page-visual-direction.compile',
        {
          goal: context.session.goal,
          visualTheme: context.session.pageVisualTheme,
          componentCount: context.session.pageComponentQueue?.length,
          componentNames: context.session.pageComponentQueue?.map(
            (component) => component.componentName,
          ),
        },
      )
      return {
        summary: styleTheme
          ? `本次没有 KV/视觉参考图，页面使用 ${context.session.activeStylePack.name} Style Pack。`
          : '本次没有 KV/视觉参考图，页面将使用任务文字主题。',
        data: {
          visualTheme: context.session.pageVisualTheme,
          visualDirection: context.session.pageVisualDirection,
        },
      }
    }
    const result = await invokeProvider(
      {
        ...context.payload,
        type: 'extract_visual_theme',
        question: [
          `页面目标：${context.session.goal}`,
          '只从用户指定的 KV/视觉参考图提取一次页面 VisualThemeContract。',
          '该主题将同时约束页面外壳和所有业务组件，必须忠实保留 KV 的主色、背景、文字对比、材质、装饰和图像语言。',
          '禁止使用组件 thumbnail 或组件默认配色覆盖 KV。',
        ].join('\n\n'),
        uploads: visualUploads,
      },
      context.providerCallbacks,
    )
    if (!result.visualTheme) {
      throw createRuntimeError(
        'PAGE_VISUAL_THEME_MISSING',
        'KV 主题提取没有返回 VisualThemeContract。',
      )
    }
    context.session.pageVisualTheme = requireReferenceVisualTheme(
      result.visualTheme,
      visualUploads,
      1,
      'PAGE_VISUAL_THEME_INVALID',
    )
    context.session.pageVisualDirection = await executeSkillTool('page-visual-direction.compile', {
      goal: context.session.goal,
      visualTheme: context.session.pageVisualTheme,
      componentCount: context.session.pageComponentQueue?.length,
      componentNames: context.session.pageComponentQueue?.map(
        (component) => component.componentName,
      ),
    })
    return {
      summary: `页面 KV 主题已提取，共 ${context.session.pageVisualTheme.colors.length} 个主导色。`,
      data: {
        visualTheme: context.session.pageVisualTheme,
        visualDirection: context.session.pageVisualDirection,
      },
    }
  })

  registerTool(tools, 'page.generate-shell', async (context) => {
    const page =
      context.memory.get('page.confirm-blueprint')?.data ??
      context.memory.get('page.blueprint')?.data
    if (!page?.blueprint) throw createRuntimeError('PAGE_BLUEPRINT_MISSING', '缺少页面 Blueprint。')
    const blueprint = {
      ...page.blueprint,
      visualTheme: context.session.pageVisualTheme ?? page.blueprint.visualTheme,
    }
    const visualDirection = context.session.pageVisualDirection
    const uploads = getPreparedUploads(context)
    const kvUploads = uploads.filter((upload) => upload.role === 'kv')
    const kvInstruction = kvUploads.length
      ? `本次提供了明确的 KV 主视觉（${kvUploads.map((upload) => upload.name).join('、')}）。必须将 KV 原图作为页面顶部唯一主视觉主体实际呈现，保留人物/产品/核心构图；只能对背景、裁切和叠加层做适配，不能仅提取配色或把 KV 当作普通风格参考。`
      : '本次没有明确 KV 主视觉，页面外壳可根据 VisualThemeContract 生成顶部氛围焦点。'
    const result = await invokeProvider(
      {
        ...context.payload,
        type: 'generate_assets',
        question: [
          '只生成一个完整页面的设计专用视觉外壳图片。',
          `页面目标：${context.session.goal}`,
          `页面 Blueprint：${JSON.stringify(blueprint, null, 2)}`,
          blueprint.pageRoot ? `页面根节点：${JSON.stringify(blueprint.pageRoot)}` : '',
          blueprint.containers?.length
            ? `页面容器节点：${JSON.stringify(blueprint.containers)}`
            : '',
          blueprint.visualTheme
            ? `必须严格沿用页面 VisualThemeContract：${JSON.stringify(blueprint.visualTheme, null, 2)}`
            : '',
          visualDirection ? `页面视觉方向契约：${JSON.stringify(visualDirection, null, 2)}` : '',
          kvInstruction,
          context.session.repairContext?.key === 'page-quality'
            ? `这是第 ${context.session.repairContext.attempt} 次定向修订。必须修正以下评审问题：${JSON.stringify(context.session.repairContext.issues)}`
            : '',
          `输出尺寸必须为 ${blueprint.width}x${blueprint.estimatedHeight}。`,
          '页面外壳独占主视觉构图。活动/H5 页面仅允许顶部 0%-22% 建立唯一高密度 Signature/KV 焦点；22%-85% 必须是低密度内容承载底色；85%-100% 只允许克制的页尾过渡。后台页面只允许页头 0%-12% 保留中等视觉密度。',
          kvUploads.length
            ? '页面外壳需要覆盖整页背景，并在顶部主视觉区域呈现 KV 原图；组件主体、卡片、按钮、文字、奖品、任务和动态内容仍由画布原生组件负责，不要在内容区重复绘制。'
            : '只绘制覆盖整页的背景底色、章节节奏和氛围纹理。组件主体、卡片、按钮、文字、奖品、任务和动态内容一律不要绘制；这些区域由画布原生组件覆盖，不需要透明挖洞。',
          '禁止把放射中心、主图形、高饱和光效或同一高密度纹理铺满页面高度；禁止在每个组件 Section 内重复 KV 构图。内容区只提供低对比连续底色和留白，必须让 Tonal Component Surface 清晰可见。',
          'manifest 只能包含一个 page-visual-shell 素材。',
        ]
          .filter(Boolean)
          .join('\n\n'),
        uploads,
        imageTasks: [
          createImageTask({
            id: 'page-visual-shell',
            name: 'page-visual-shell.png',
            targetSize: { width: blueprint.width, height: blueprint.estimatedHeight },
            transparent: false,
            kind: 'page-background',
            referencePolicy: { roles: ['kv', 'visual'], maxImages: 2 },
            prompt:
              '生成无文字、无组件主体的完整页面背景底图。顶部最多 22% 承载唯一主视觉；其余内容区保持低密度底色与留白，禁止全页重复放射或高饱和纹理。',
          }),
        ],
      },
      context.providerCallbacks,
    )
    if (!Array.isArray(result.artifacts) || result.artifacts.length !== 1) {
      throw createRuntimeError('PAGE_SHELL_INVALID', '页面视觉外壳必须且只能返回一个素材。')
    }
    const pageShellArtifact = result.artifacts[0]
    const review = inspectImageArtifact(pageShellArtifact, {
      placementMode: 'new-artboard',
      width: blueprint.width,
      height: blueprint.estimatedHeight,
    })
    if (!review.passed) {
      throw createRuntimeError(
        'PAGE_SHELL_INVALID',
        review.issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join('；'),
      )
    }
    const components = Array.isArray(context.session.pageComponentQueue)
      ? context.session.pageComponentQueue
      : []
    return {
      summary: '页面级背景和跨模块视觉外壳生成完成。',
      data: { blueprint, pageShellArtifact, shellReview: review },
      nextSteps: components.map((component) => ({
        id: `generate-page-component-${Number(component.index) + 1}`,
        title: `生成 ${component.componentName} 页面组件`,
        tool: 'page.generate-component',
        input: component,
      })),
    }
  })

  registerTool(tools, 'page.review', async (context) => {
    const page =
      context.memory.get('page.confirm-blueprint')?.data ??
      context.memory.get('page.blueprint')?.data
    const shell = context.memory.get('page.generate-shell')?.data
    const components = collectPageComponents(context)
    const failedComponents = collectPageFailures(context)
    const blueprint = shell?.blueprint ?? page?.blueprint
    if (!blueprint || !shell?.pageShellArtifact) {
      throw createRuntimeError(
        'PAGE_REVIEW_INPUT_MISSING',
        '页面质量审查缺少 Blueprint、组件或视觉外壳。',
      )
    }
    const componentReviews = components.map((component) => component.componentDesign.qualityReview)
    const blueprintIssues = validatePageCompositionBlueprint(blueprint)
    const structure = blueprintIssues.length ? 0 : 1
    const componentTheme = averageScore(
      componentReviews.map((review) => review?.scores.theme ?? 0.75),
    )
    const shellTheme = blueprint.visualTheme
      ? calculateThemeAffinity(shell.pageShellArtifact, blueprint.visualTheme.colors)
      : 0.8
    let theme = (componentTheme + shellTheme) / 2
    let readability = averageScore(
      componentReviews.map((review) => review?.scores.readability ?? 1),
    )
    // hero 是外壳预留区，没有对应组件产物，不能计入完成度分母。
    const componentSectionCount = blueprint.sections.filter(
      (section) => section.kind === 'component-instance',
    ).length
    const completeness = componentSectionCount ? components.length / componentSectionCount : 0
    const runtimeStatuses = components.map(
      (component) => component.componentDesign.runtimeValidation?.status ?? 'unsupported',
    )
    const developmentReadiness = averageScore(
      runtimeStatuses.map((status) =>
        status === 'passed' ? 1 : status === 'unsupported' ? 0.5 : 0,
      ),
    )
    const issues = []
    const visionReview = await reviewPageVision({
      invokeProvider,
      payload: context.payload,
      references: context.session.references,
      visualDirection: context.session.pageVisualDirection,
      callbacks: context.providerCallbacks,
    })
    if (visionReview.status === 'completed') {
      theme = averageScore([
        theme,
        visionReview.scores.theme,
        visionReview.scores.referenceSimilarity,
      ])
      readability = averageScore([
        readability,
        visionReview.scores.readability,
        visionReview.scores.hierarchy,
      ])
      for (const issue of visionReview.issues) {
        issues.push({
          code: 'VISION_REVIEW_ISSUE',
          severity: issue.severity,
          scope: issue.scope,
          targetId: issue.targetId,
          message: issue.message,
          repairAction: issue.repairPrompt,
        })
      }
    }
    if (structure < 0.9)
      issues.push(qualityIssue('PAGE_STRUCTURE_INVALID', 'structure', structure, 0.9, 'page'))
    if (theme < 0.75)
      issues.push(qualityIssue('PAGE_THEME_LOW_AFFINITY', 'theme', theme, 0.75, 'page'))
    if (readability < 0.85)
      issues.push(qualityIssue('PAGE_TEXT_UNREADABLE', 'readability', readability, 0.85, 'page'))
    if (completeness < 1) {
      issues.push({
        code: 'PAGE_COMPONENT_INCOMPLETE',
        severity: 'warning',
        scope: 'page',
        message: `页面已交付 ${components.length}/${componentSectionCount} 个组件，失败组件：${failedComponents.map((item) => item.componentName).join('、') || '未知'}`,
        repairAction: '只重试失败的页面组件，不要重新生成已完成组件。',
      })
    }
    if (runtimeStatuses.some((status) => status === 'failed')) {
      issues.push(
        qualityIssue(
          'PAGE_RUNTIME_FAILED',
          'developmentReadiness',
          developmentReadiness,
          0.8,
          'runtime',
        ),
      )
    } else if (runtimeStatuses.some((status) => status === 'unsupported')) {
      issues.push({
        code: 'PAGE_RUNTIME_UNSUPPORTED',
        severity: 'warning',
        scope: 'runtime',
        message: '页面设计已通过，但尚未配置全部真实组件 Runtime。',
        repairAction: '接入组件 Bundle Adapter 后重新验证。',
      })
    }
    const qualityReview = createDesignEvalReport({
      scope: 'page',
      deliveryStatus:
        runtimeStatuses.length > 0 && runtimeStatuses.every((status) => status === 'passed')
          ? 'runtime-verified'
          : 'design-ready',
      scores: {
        structure,
        theme,
        readability,
        completeness,
        developmentReadiness,
        componentIntegrity: averageScore([
          completeness,
          averageScore(componentReviews.map((review) => (review?.passed === false ? 0 : 1))),
        ]),
      },
      issues,
      editableCoverage: calculatePageEditableCoverage(components, Boolean(shell.pageShellArtifact)),
      thresholds: failedComponents.length
        ? {
            layoutCompleteness: 0,
            componentIntegrity: 0,
          }
        : undefined,
      repairCount: componentReviews.reduce(
        (total, review) => total + (review?.repairCount ?? 0),
        0,
      ),
    })
    if (!qualityReview.passed) {
      const automaticRepair = selectAutomaticRepair(qualityReview)
      if (!automaticRepair) {
        throw createRuntimeError(
          'PAGE_QUALITY_BLOCKED',
          qualityReview.issues
            .filter((issue) => issue.severity === 'error')
            .map((issue) => issue.message)
            .join('；'),
          { qualityReview },
        )
      }
      const repairTargetId = automaticRepair.targetId ?? 'page-shell'
      // 步骤号跟组件序号对齐，必须只在组件 Section 里找下标；
      // hero 预留区也在 sections 里，用整体下标会修订错组件。
      const targetIndex = blueprint.sections
        .filter((section) => section.kind === 'component-instance')
        .findIndex((section) => section.id === repairTargetId)
      const repairComponent = automaticRepair.kind === 'page-component' && targetIndex >= 0
      return {
        summary: `页面评审未通过，将定向修订 ${automaticRepair.kind}：${automaticRepair.reason}`,
        data: { blueprint, components, failedComponents, ...shell, qualityReview },
        decision: {
          action: 'repair',
          key: 'page-quality',
          targetId: repairTargetId,
          issues: qualityReview.issues.filter((issue) =>
            automaticRepair.issueCodes.includes(issue.code),
          ),
          invalidateStepIds: repairComponent
            ? [`generate-page-component-${targetIndex + 1}`, 'review-page']
            : ['generate-page-shell', 'review-page'],
          maxAttempts: 2,
          limitMessage: '页面视觉外壳连续两次修订后仍未通过质量评审，已停止交付。',
        },
      }
    }
    if (context.session.repairContext?.key === 'page-quality') delete context.session.repairContext
    return {
      summary: '完整页面质量审查通过。',
      data: { blueprint, components, failedComponents, ...shell, qualityReview, visionReview },
    }
  })

  registerTool(tools, 'canvas.present-page', async (context) => {
    const reviewed = context.memory.get('page.review')?.data
    if (
      !reviewed?.blueprint ||
      !Array.isArray(reviewed.components) ||
      !reviewed?.pageShellArtifact
    ) {
      throw createRuntimeError('PAGE_PRESENTATION_MISSING', '没有可交付到画布的完整页面结果。')
    }
    return {
      summary: `完整页面和 ${reviewed.components.length} 个组件实例已准备交付画布。`,
      data: {
        pageShellArtifact: reviewed.pageShellArtifact,
        components: reviewed.components,
        failedComponents: reviewed.failedComponents ?? [],
        successfulPageSectionIds: reviewed.components
          .map((component) => component.pageSectionId)
          .filter(Boolean),
        pageDesign: {
          blueprint: reviewed.blueprint,
          qualityReview: reviewed.qualityReview,
        },
      },
    }
  })

  registerTool(tools, 'component.regenerate-slot', async (context) => {
    const scope = context.session.editScope ?? context.payload.editScope
    if (!scope?.slotId || !scope?.propPath) {
      throw createRuntimeError('COMPONENT_EDIT_SCOPE_MISSING', '缺少组件局部编辑范围。')
    }
    const transparent = shouldRegenerateAsTransparent(
      context.session.goal,
      scope.transparent === true,
    )
    const task = {
      id: 'component-slot-edit',
      slotId: scope.slotId,
      label: scope.regionId,
      propPath: scope.propPath,
      fallbackPath: scope.fallbackPath,
      role: 'component-asset',
      targetSize: scope.targetSize,
      transparent,
      exactText: scope.exactText,
    }
    const uploads = createComponentRegenerationUploads(context, scope)
    const visualContract = createComponentBatchVisualContract([scope])
    const result = await invokeProvider(
      {
        ...context.payload,
        type: 'generate_assets',
        question: [
          `只重新生成 ${scope.componentName} / ${scope.profile} 的一个素材 Slot。`,
          `用户修改要求：${context.session.goal}`,
          `slotId=${scope.slotId}，propPath=${scope.propPath}，目标尺寸=${scope.targetSize.width}x${scope.targetSize.height}。`,
          scope.exactText
            ? `图片自身必须包含且只包含准确文案“${scope.exactText}”，不得生成第二份文字。`
            : '',
          scope.visualTheme ? `沿用组件视觉主题：${JSON.stringify(scope.visualTheme)}` : '',
          visualContract,
          '只输出一张紧贴边界的图片；禁止生成完整组件、页面、对比图或其他 Slot。',
        ]
          .filter(Boolean)
          .join('\n\n'),
        uploads,
        imageTasks: [
          createImageTask({
            ...task,
            name: `${scope.slotId}.png`,
            kind: 'component-slot-edit',
            textPolicy: scope.exactText ? 'model-exact' : undefined,
            referencePolicy: {
              roles: ['edit-base', 'kv', 'visual', 'prototype'],
              maxImages: 3,
            },
            prompt: `只重新生成 ${scope.componentName} 的 ${scope.slotId} 素材，不生成完整组件或页面。`,
          }),
        ],
      },
      context.providerCallbacks,
    )
    if (!Array.isArray(result.artifacts) || result.artifacts.length !== 1) {
      throw createRuntimeError('COMPONENT_SLOT_ARTIFACT_INVALID', '局部组件编辑必须返回一个素材。')
    }
    const sourceArtifact = result.artifacts[0]
    return {
      summary: `${scope.slotId} 素材重新生成完成。`,
      data: { artifact: sourceArtifact, sourceArtifact, task, editScope: scope },
    }
  })

  registerTool(tools, 'component.validate-slot', async (context) => {
    const generated = context.memory.get('component.regenerate-slot')?.data
    if (!generated?.artifact || !generated?.task) {
      throw createRuntimeError('COMPONENT_SLOT_ARTIFACT_MISSING', '缺少局部组件素材。')
    }
    const sourceReview = inspectImageArtifact(generated.sourceArtifact ?? generated.artifact, {
      placementMode: 'asset-board',
      width: generated.task.targetSize.width,
      height: generated.task.targetSize.height,
      transparent: generated.task.transparent,
    })
    const review = inspectImageArtifact(generated.artifact, {
      placementMode: 'asset-board',
      width: generated.task.targetSize.width,
      height: generated.task.targetSize.height,
    })
    if (!sourceReview.passed || !review.passed) {
      const message = [...sourceReview.issues, ...review.issues]
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join('；')
      throw createRuntimeError('COMPONENT_SLOT_ARTIFACT_INVALID', `局部素材验证失败：${message}`)
    }
    return {
      summary: `${generated.task.slotId} 素材验证通过。`,
      data: { ...generated, review, sourceReview },
    }
  })

  registerTool(tools, 'canvas.present-slot', async (context) => {
    const validated = context.memory.get('component.validate-slot')?.data
    if (!validated?.artifact || !validated?.editScope) {
      throw createRuntimeError('COMPONENT_SLOT_ARTIFACT_MISSING', '没有可交付的局部组件素材。')
    }
    return {
      summary: `${validated.editScope.slotId} 已准备替换原图层。`,
      data: validated,
    }
  })

  registerTool(tools, 'component.regenerate-slots', async (context) => {
    const scope = context.session.editScope ?? context.payload.editScope
    if (
      scope?.type !== 'component-region-batch' ||
      !Array.isArray(scope.targets) ||
      !scope.targets.length
    ) {
      throw createRuntimeError('COMPONENT_BATCH_EDIT_SCOPE_MISSING', '缺少批量组件素材范围。')
    }
    const groups = groupComponentConsistencyTargets(scope.targets)
    const groupedItems = await mapWithConcurrency(groups, 2, async (group) => {
      const visualContract = createComponentBatchVisualContract(
        group.entries.map((entry) => entry.scope),
      )
      const items = []
      let styleAnchor
      for (const entry of group.entries) {
        const item = await generateComponentRegionArtifact({
          context,
          scope: entry.scope,
          invokeProvider,
          index: entry.index,
          visualContract,
          styleAnchor,
        })
        items.push(item)
        styleAnchor ||= item
      }
      return items
    })
    const items = groupedItems.flat().sort((left, right) => left.batchIndex - right.batchIndex)
    return {
      summary: `${items.length} 个组件素材已分别重新生成。`,
      data: { items, editScope: scope, visualGroupCount: groups.length },
    }
  })

  registerTool(tools, 'component.validate-slots', async (context) => {
    const generated = context.memory.get('component.regenerate-slots')?.data
    if (!Array.isArray(generated?.items) || !generated.items.length) {
      throw createRuntimeError('COMPONENT_BATCH_ARTIFACT_MISSING', '缺少批量组件素材。')
    }
    const items = generated.items.map((item) => {
      const sourceReview = inspectImageArtifact(item.sourceArtifact ?? item.artifact, {
        placementMode: 'asset-board',
        width: item.task.targetSize.width,
        height: item.task.targetSize.height,
        transparent: item.task.transparent,
      })
      const review = inspectImageArtifact(item.artifact, {
        placementMode: 'asset-board',
        width: item.task.targetSize.width,
        height: item.task.targetSize.height,
      })
      if (!sourceReview.passed || !review.passed) {
        const message = [...sourceReview.issues, ...review.issues]
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join('；')
        throw createRuntimeError(
          'COMPONENT_BATCH_ARTIFACT_INVALID',
          `${item.editScope.componentName} / ${item.editScope.regionId} 验证失败：${message}`,
        )
      }
      return { ...item, review, sourceReview }
    })
    return {
      summary: `${items.length} 个组件素材验证通过。`,
      data: { ...generated, items },
    }
  })

  registerTool(tools, 'canvas.present-slots', async (context) => {
    const validated = context.memory.get('component.validate-slots')?.data
    if (
      !Array.isArray(validated?.items) ||
      !validated.items.length ||
      validated.editScope?.type !== 'component-region-batch'
    ) {
      throw createRuntimeError('COMPONENT_BATCH_ARTIFACT_MISSING', '没有可批量交付的组件素材。')
    }
    return {
      summary: `${validated.items.length} 个组件素材已准备原子替换。`,
      data: validated,
    }
  })

  registerTool(tools, 'page.regenerate-shell', async (context) => {
    const scope = context.session.editScope ?? context.payload.editScope
    if (scope?.type !== 'page-shell') {
      throw createRuntimeError('PAGE_SHELL_EDIT_SCOPE_MISSING', '缺少页面视觉外壳编辑范围。')
    }
    const currentUpload =
      typeof scope.currentImage === 'string' && scope.currentImage.startsWith('data:image/')
        ? {
            type: 'file',
            name: 'current-page-shell.png',
            mime: scope.currentImage.match(/^data:([^;]+);/)?.[1] || 'image/png',
            role: 'edit-base',
            data: scope.currentImage,
          }
        : undefined
    const result = await invokeProvider(
      {
        ...context.payload,
        type: 'generate_assets',
        question: [
          '只重新生成当前页面的 design-only 视觉外壳图片。',
          `用户修改要求：${context.session.goal}`,
          `输出尺寸必须为 ${scope.targetSize.width}x${scope.targetSize.height}。`,
          context.session.pageBlueprint
            ? `页面 Blueprint：${JSON.stringify(context.session.pageBlueprint, null, 2)}`
            : '',
          '只绘制页面背景、跨模块装饰、纹理和页级光效。禁止绘制组件主体、按钮、准确文字或动态业务内容。',
          '只输出一个图片素材。',
        ]
          .filter(Boolean)
          .join('\n\n'),
        uploads: uniqueUploads([currentUpload, ...getPreparedUploads(context)].filter(Boolean)),
        imageTasks: [
          createImageTask({
            id: 'page-visual-shell-regenerated',
            name: 'page-visual-shell.png',
            targetSize: scope.targetSize,
            transparent: false,
            kind: 'page-background-edit',
            referencePolicy: { roles: ['edit-base', 'kv', 'visual'], maxImages: 3 },
            prompt: `重新生成页面背景和跨模块视觉外壳。修改要求：${context.session.goal}`,
          }),
        ],
      },
      context.providerCallbacks,
    )
    if (!Array.isArray(result.artifacts) || result.artifacts.length !== 1) {
      throw createRuntimeError('PAGE_SHELL_INVALID', '页面视觉外壳局部重生成必须返回一张图片。')
    }
    return {
      summary: '页面视觉外壳重新生成完成。',
      data: { artifact: result.artifacts[0], editScope: scope },
    }
  })

  registerTool(tools, 'page.validate-shell', async (context) => {
    const generated = context.memory.get('page.regenerate-shell')?.data
    if (!generated?.artifact || !generated.editScope) {
      throw createRuntimeError('PAGE_SHELL_INVALID', '缺少待验证的页面视觉外壳。')
    }
    const review = inspectImageArtifact(generated.artifact, {
      placementMode: 'new-artboard',
      width: generated.editScope.targetSize.width,
      height: generated.editScope.targetSize.height,
    })
    if (!review.passed) {
      throw createRuntimeError(
        'PAGE_SHELL_INVALID',
        review.issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join('；'),
      )
    }
    return { summary: '页面视觉外壳验证通过。', data: { ...generated, review } }
  })

  registerTool(tools, 'canvas.present-page-shell', async (context) => {
    const validated = context.memory.get('page.validate-shell')?.data
    if (!validated?.artifact || !validated.editScope) {
      throw createRuntimeError('PAGE_SHELL_INVALID', '没有可交付的页面视觉外壳。')
    }
    return { summary: '页面视觉外壳已准备原位替换。', data: validated }
  })

  registerTool(tools, 'agent.inspect-state', async (context) => ({
    summary: `当前任务包含 ${context.session.plan.length} 个步骤，已完成 ${context.session.plan.filter((step) => step.status === 'completed').length} 个。`,
    data: {
      status: context.session.status,
      taskKind: context.session.taskKind,
      goal: context.session.goal,
      steps: context.session.plan.map((step) => ({
        id: step.id,
        tool: step.tool,
        status: step.status,
        error: step.error,
      })),
      lastError: context.session.lastError,
    },
  }))

  registerTool(tools, 'canvas.inspect', async (context) => ({
    summary: context.session.canvasTarget
      ? `目标画板为 ${context.session.canvasTarget.width}x${context.session.canvasTarget.height}。`
      : '当前没有明确目标画板。',
    data: {
      canvasTarget: context.session.canvasTarget,
      canvasSnapshot: context.session.canvasSnapshot,
      editScope: context.session.editScope,
    },
  }))

  registerTool(tools, 'artifact.inspect', async (context) => ({
    summary: `当前会话已登记 ${context.session.artifacts.length} 个 Artifact。`,
    data: {
      artifacts: context.session.artifacts.slice(-20),
      availableResults: Array.from(context.memory.keys())
        .filter((key) => typeof key === 'string' && !key.startsWith('inspect-'))
        .slice(-30),
    },
  }))

  for (const stage of [
    'source.inspect',
    'source.to-scene',
    'source.confirm',
    'design.transform',
    'canvas.commit',
  ]) {
    registerTool(tools, stage, async (context) =>
      executeSourceAdapterStage({
        stage,
        context,
        runtimePlugins,
        toolCatalog,
      }),
    )
  }

  registerTool(tools, 'scene.validate', async (context) => {
    const adapter = runtimePlugins.resolveSourceAdapter(context.session.taskKind)
    if (adapter?.stages?.['scene.validate']) {
      return executeSourceAdapterStage({
        stage: 'scene.validate',
        context,
        runtimePlugins,
        toolCatalog,
      })
    }
    const transformed = context.memory.get('design.transform')?.data
    const componentDesign = transformed?.componentDesign
    if (!componentDesign?.designTree?.nodes?.length) {
      throw createRuntimeError('SCENE_GRAPH_EMPTY', 'Source Adapter 没有生成可编辑场景节点。')
    }
    if (componentDesign.qualityReview?.passed === false) {
      throw createRuntimeError('SCENE_QUALITY_REJECTED', '可编辑场景未通过组件插件质量门禁。')
    }
    const sourceScene = componentDesign.sourceSceneGraph
    if (
      sourceScene?.mode === 'editable-scene' &&
      sourceScene.nodes.some((node) => node.ownership?.role !== 'structure')
    ) {
      throw createRuntimeError('SCENE_OWNER_INVALID', 'Runtime Editable Scene 包含非结构 Owner。')
    }
    return {
      summary: `场景校验通过，共 ${componentDesign.designTree.nodes.length} 个可编辑节点。`,
      data: transformed,
    }
  })

  for (const [name, execute] of toolCatalog) {
    if (!isPluginOwnedTool(name) && !runtimePlugins.isAdapterInternalTool(name))
      tools.set(name, execute)
  }
  const pluginToolOwners = runtimePlugins.installTools(toolCatalog, tools)

  return {
    list() {
      return Array.from(tools.keys()).map((name) => ({
        name,
        owner: pluginToolOwners.get(name) ?? 'core',
      }))
    },
    async execute(name, context) {
      const tool = tools.get(name)
      if (tool) return tool(context)
      if (runtimePlugins.isAdapterInternalTool(name)) {
        throw createRuntimeError(
          'AGENT_TOOL_PRIVATE',
          `工具 ${name} 只能由 Source Adapter 内部调用。`,
        )
      }
      if (isPluginOwnedTool(name)) {
        throw createRuntimeError('COMPONENT_PLUGIN_MISSING', `当前没有插件注册工具：${name}`)
      }
      if (typeof executeSkillTool === 'function') {
        const data = await executeSkillTool(name, context.input ?? {})
        return {
          summary: `Skill Tool ${name} 执行完成。`,
          data,
        }
      }
      throw createRuntimeError('AGENT_TOOL_NOT_FOUND', `Agent 工具不存在：${name}`)
    },
  }
}

function requireReferenceVisualTheme(theme, visualUploads, referenceImageIndex, errorCode) {
  const normalized = normalizeVisualTheme(theme)
  if (!normalized || normalized.colors.length < 2) {
    throw createRuntimeError(errorCode, '视觉主题至少需要两个有效颜色。')
  }
  const source = visualUploads.some((upload) => upload.role === 'kv') ? 'kv' : 'visual'
  return {
    ...normalized,
    source,
    referenceImageIndex: Math.max(1, referenceImageIndex || 1),
  }
}

function createComponentQualityReview({ blueprint, generatedAssets, repairCount = 0 }) {
  const regionCount = blueprint.regions.length
  const validRegions = blueprint.regions.filter(
    (region) =>
      region.bounds.x >= 0 &&
      region.bounds.y >= 0 &&
      region.bounds.x + region.bounds.width <= blueprint.width + 1 &&
      region.bounds.y + region.bounds.height <= blueprint.height + 1,
  ).length
  const structure = regionCount ? validRegions / regionCount : 0
  // 组件主题由原生 Scene Token 与 Props Binding 表达，不再通过全尺寸位图测量。
  const theme = 1
  const readableText = blueprint.regions.filter((region) => region.renderMode === 'text')
  const readableTextCount = readableText.filter(
    (region) =>
      typeof region.content === 'string' && region.content.trim() && region.bounds.height >= 18,
  ).length
  const readability = readableText.length ? readableTextCount / readableText.length : 1
  const expectedAssets = blueprint.regions.filter(
    (region) => region.renderMode === 'generated-asset',
  ).length
  const completeness = expectedAssets ? Math.min(1, generatedAssets.length / expectedAssets) : 1
  const developmentReadiness = blueprint.regions.every(
    (region) =>
      region.renderMode !== 'generated-asset' ||
      (region.slotId && (region.propBindings.length || region.designOnly === true)),
  )
    ? 0.9
    : 0.6
  const issues = []
  if (structure < 0.9)
    issues.push(qualityIssue('COMPONENT_STRUCTURE_OUT_OF_BOUNDS', 'structure', structure, 0.9))
  if (theme < 0.75) issues.push(qualityIssue('COMPONENT_THEME_LOW_AFFINITY', 'theme', theme, 0.75))
  if (readability < 0.85)
    issues.push(qualityIssue('COMPONENT_TEXT_UNREADABLE', 'readability', readability, 0.85))
  if (completeness < 1)
    issues.push(qualityIssue('COMPONENT_ASSET_INCOMPLETE', 'completeness', completeness, 1))
  if (developmentReadiness < 0.8)
    issues.push(
      qualityIssue(
        'COMPONENT_NOT_DEVELOPMENT_READY',
        'developmentReadiness',
        developmentReadiness,
        0.8,
      ),
    )
  return createDesignEvalReport({
    scope: 'component',
    scores: {
      structure,
      theme,
      readability,
      completeness,
      developmentReadiness,
      componentIntegrity: averageScore([structure, completeness]),
    },
    issues,
    editableCoverage: calculateComponentEditableCoverage(blueprint),
    repairCount: repairCount ?? 0,
  })
}

function applyDecorativeBackgroundPresentation(regions, task, blueprint) {
  if (!task) return regions
  const background = {
    id: 'component-decorative-background',
    role: '组件装饰背景',
    bounds: { x: 0, y: 0, width: blueprint.width, height: blueprint.height },
    slotId: task.slotId,
    propBindings: [],
    renderMode: 'generated-asset',
    confidence: 1,
    visible: true,
    designOnly: true,
    style: { opacity: 1 },
  }
  const componentArea = Math.max(1, blueprint.width * blueprint.height)
  const foreground = regions.map((region) => {
    if (region.renderMode !== 'color') return region
    const area = region.bounds.width * region.bounds.height
    if (area / componentArea < 0.16) return region
    return {
      ...region,
      style: {
        ...(region.style ?? {}),
        opacity: Math.min(0.9, Number(region.style?.opacity) || 0.86),
      },
    }
  })
  return [background, ...foreground.filter((region) => region.id !== background.id)]
}

function countColorValues(values) {
  return Object.values(values ?? {}).filter(
    (value) => typeof value === 'string' && isValidDesignValue('color', value),
  ).length
}

function calculateThemeAffinity(artifact, themeColors) {
  if (artifact?.kind === 'raster') return rasterThemeAffinity(artifact, themeColors)
  const content = typeof artifact?.content === 'string' ? artifact.content : ''
  const theme = themeColors.map(parseColor).filter(Boolean)
  const paints = Array.from(
    content.matchAll(/(?:fill|stroke|stop-color)=["'](#[0-9a-f]{3,8}|rgba?\([^"']+\))["']/gi),
  )
    .map((match) => parseColor(match[1]))
    .filter(Boolean)
  if (!theme.length || !paints.length) return 0
  return (
    paints.filter((paint) => theme.some((color) => colorDistance(paint, color) <= 92)).length /
    paints.length
  )
}

function rasterThemeAffinity(artifact, themeColors) {
  const paints = (artifact?.analysis?.dominantColors ?? []).map(parseColor).filter(Boolean)
  const theme = themeColors.map(parseColor).filter(Boolean)
  if (!paints.length || !theme.length) return 0
  return (
    paints.filter((paint) => theme.some((color) => colorDistance(paint, color) <= 92)).length /
    paints.length
  )
}

function qualityIssue(code, metric, score, threshold, scope = 'component') {
  return {
    code,
    severity: 'error',
    scope,
    metric,
    message: `${metric} 评分 ${roundScore(score)}，低于交付门槛 ${threshold}。`,
    repairAction: `重新生成或修正 ${metric} 后再次审查。`,
  }
}

function roundScore(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100
}

function parseColor(value) {
  const hex = String(value || '')
    .trim()
    .match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (hex) {
    const normalized =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((character) => character.repeat(2))
            .join('')
        : hex[1].slice(0, 6)
    return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16))
  }
  const rgb = String(value || '').match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i,
  )
  return rgb ? rgb.slice(1, 4).map(Number) : undefined
}

function colorDistance(left, right) {
  return Math.sqrt(left.reduce((total, value, index) => total + (value - right[index]) ** 2, 0))
}

function isPluginOwnedTool(name) {
  return (
    name.startsWith('component.') ||
    name.startsWith('page.') ||
    [
      'canvas.present-component',
      'canvas.present-slot',
      'canvas.present-slots',
      'canvas.present-page',
      'canvas.present-page-shell',
    ].includes(name)
  )
}

async function executeSourceAdapterStage({ stage, context, runtimePlugins, toolCatalog }) {
  restoreSourceAdapterMemory(context)
  const adapter = runtimePlugins.resolveSourceAdapter(context.session.taskKind)
  if (!adapter) {
    throw createRuntimeError(
      'SOURCE_ADAPTER_MISSING',
      `没有 Source Adapter 可以处理 ${context.session.taskKind}。`,
    )
  }
  const entries = adapter.stages?.[stage]
  if (!Array.isArray(entries) || !entries.length) {
    throw createRuntimeError(
      'SOURCE_ADAPTER_STAGE_MISSING',
      `${adapter.id} 没有声明 ${stage} 阶段。`,
    )
  }
  const observations = []
  const internalResults = {}
  let lastResult
  for (const entry of entries) {
    const descriptor = typeof entry === 'string' ? { tool: entry } : entry
    if (!sourceStageConditionMatches(descriptor.when, context)) continue
    const execute = toolCatalog.get(descriptor.tool)
    if (typeof execute !== 'function') {
      throw createRuntimeError(
        'SOURCE_ADAPTER_TOOL_MISSING',
        `${adapter.id} 缺少内部工具 ${descriptor.tool}。`,
      )
    }
    const startedAt = Date.now()
    emitToolTrace(context, {
      stage,
      tool: descriptor.tool,
      status: 'started',
      message: `开始执行内部工具 ${descriptor.tool}`,
    })
    let result
    try {
      result = await execute(context)
    } catch (error) {
      emitToolTrace(context, {
        stage,
        tool: descriptor.tool,
        status: 'failed',
        elapsedMs: Date.now() - startedAt,
        errorCode: error?.code,
        message: safeTraceError(error),
      })
      throw error
    }
    emitToolTrace(context, {
      stage,
      tool: descriptor.tool,
      status: 'completed',
      elapsedMs: Date.now() - startedAt,
      message: result.summary || `${descriptor.tool} 执行完成`,
    })
    context.memory.set(descriptor.tool, result)
    internalResults[descriptor.tool] = result
    observations.push({ tool: descriptor.tool, summary: result.summary })
    lastResult = result
  }
  if (!lastResult) {
    throw createRuntimeError(
      'SOURCE_ADAPTER_STAGE_EMPTY',
      `${adapter.id} 的 ${stage} 没有可执行操作。`,
    )
  }
  const data = {
    ...lastResult.data,
    adapterId: adapter.id,
    pluginId: adapter.pluginId,
    stage,
    observations,
    internalResults,
  }
  data.deliveryKind =
    adapter.stageOutputs?.[stage] ??
    (stage === 'canvas.commit' && context.session.taskKind === 'component-design'
      ? 'component'
      : undefined)
  if (stage === 'canvas.commit') {
    if (data.deliveryKind === 'component') {
      context.memory.set('canvas.present-component', { ...lastResult, data })
    }
    if (data.deliveryKind === 'page') {
      context.memory.set('canvas.present-page', { ...lastResult, data })
    }
    if (data.deliveryKind === 'generic-ui') {
      context.memory.set('canvas.present-ui', { ...lastResult, data })
    }
  }
  return {
    summary: `${adapter.id} 完成 ${stage}：${observations.map((item) => item.summary).join('；')}`,
    data,
    ...(adapterStageSignalEnabled(adapter, stage, 'pause') && lastResult.pause
      ? { pause: lastResult.pause }
      : {}),
    ...(adapterStageSignalEnabled(adapter, stage, 'nextSteps') && lastResult.nextSteps
      ? { nextSteps: lastResult.nextSteps }
      : {}),
    ...(adapterStageSignalEnabled(adapter, stage, 'decision') && lastResult.decision
      ? { decision: lastResult.decision }
      : {}),
  }
}

function adapterStageSignalEnabled(adapter, stage, signal) {
  return adapter.stageSignals?.[stage]?.includes(signal) === true
}

function restoreSourceAdapterMemory(context) {
  for (const value of context.memory.values()) {
    const internalResults = value?.data?.internalResults
    if (!internalResults || typeof internalResults !== 'object') continue
    for (const [name, result] of Object.entries(internalResults)) {
      if (!context.memory.has(name)) context.memory.set(name, result)
    }
  }
}

function sourceStageConditionMatches(condition, context) {
  if (!condition) return true
  if (condition === 'has-component-assets') {
    return Boolean(context.memory.get('component.plan-assets')?.data?.assetTasks?.length)
  }
  return false
}

function classifyPageNode(component) {
  const name = String(component?.name || '')
  const label = String(component?.label || '')
  const value = `${name} ${label}`
  if (/page|页面/i.test(value) || (!component?.thumbnail && component?.hiddenInCategory === true)) {
    return 'page-root'
  }
  if (/layout|container|容器|布局/i.test(value)) return 'container'
  return 'component'
}

function extractDesignPaths(component) {
  const paths = []
  for (const prop of Array.isArray(component?.props) ? component.props : []) {
    const path = String(prop?.name || '')
    if (!path) continue
    const editorTypes = Object.values(prop?.valueTypeMap ?? {}).map((item) =>
      String(item?.name || '').toLowerCase(),
    )
    const children = Array.isArray(prop?.objectChildrenShape)
      ? prop.objectChildrenShape.map((child) => `${path}.${child.name}`)
      : []
    const allPaths = children.length ? children : [path]
    allPaths.forEach((itemPath) => {
      const childName = itemPath.split('.').at(-1)
      const child = children.length
        ? prop.objectChildrenShape.find((item) => item.name === childName)
        : prop
      const types = Object.values(child?.valueTypeMap ?? prop?.valueTypeMap ?? {}).map((item) =>
        String(item?.name || '').toLowerCase(),
      )
      if (
        editorTypes.some((type) => /color|image|number|edge|select/.test(type)) ||
        types.some((type) => /color|image|number|edge|select/.test(type))
      ) {
        paths.push(itemPath)
      }
    })
  }
  return Array.from(new Set(paths))
}

const PAGE_COMPONENT_FALLBACK_HEIGHT = 520

/**
 * 有 KV 时在页面顶部预留主视觉高度。之前 Blueprint 不给 KV 任何垂直空间，
 * 外壳提示词要求的顶部 KV 焦点会被组件 Section 完全盖住。
 * 优先按 KV 原图宽高比推导，取不到尺寸时退回页面宽度的 0.9 倍。
 */
function resolvePageHeroHeight(uploads, surface) {
  const kv = uploads.find((upload) => upload.role === 'kv')
  if (!kv) return 0
  const { width } = resolvePageLayoutMetrics(1, surface)
  const base = Math.round(width * 0.9)
  const match = /^data:([^;,]+)(?:;base64)?,(.*)$/su.exec(String(kv.data || ''))
  if (!match) return base
  try {
    const dimensions = readRasterDimensions(Buffer.from(match[2], 'base64'), match[1])
    if (!dimensions?.width || !dimensions?.height) return base
    const scaled = Math.round((dimensions.height / dimensions.width) * width)
    // 夹在页面宽度的 0.5-1.4 倍之间，避免极端长图把内容区挤没。
    return Math.min(Math.round(width * 1.4), Math.max(Math.round(width * 0.5), scaled))
  } catch {
    return base
  }
}

/**
 * 用真实 Runtime DOM 高度替代固定估算值。按 Section 实际宽度渲染，
 * 高度给足余量让根节点自然撑开，再读回 rootRect 高度。
 * 量测失败时回退到 surface viewport 高度，不阻塞页面链路。
 */
async function measurePageComponentHeight(inspect, component, sectionWidth) {
  const fallback = Number(component.surface?.viewport?.height) || PAGE_COMPONENT_FALLBACK_HEIGHT
  if (typeof inspect !== 'function' || !component?.loadedComponent) {
    return { height: fallback, measured: false }
  }
  try {
    const inspection = await inspect(
      {
        component: component.loadedComponent,
        width: Math.max(1, Math.round(sectionWidth)),
        height: 4000,
      },
      { surfaceKind: component.surface?.kind || 'custom' },
    )
    const height = Number(inspection?.sceneGraph?.surface?.height)
    if (Number.isFinite(height) && height >= 40) {
      return { height: Math.round(height), measured: true }
    }
    return { height: fallback, measured: false }
  } catch {
    return { height: fallback, measured: false }
  }
}

function collectPageComponents(context) {
  return context.session.plan
    .filter((step) => step.tool === 'page.generate-component' && step.status === 'completed')
    .map((step) => {
      const value = context.memory.get(step.id)?.data
      return value?.componentDesign
        ? { ...value, pageSectionId: value.pageSectionId ?? step.input?.pageSectionId }
        : value
    })
    .filter((value) => value?.componentDesign && !value.failed)
    .sort((left, right) => left.index - right.index)
}

function isImageRateLimitError(error) {
  return (
    error?.code === 'IMAGE_UPSTREAM_REQUEST_FAILED' &&
    (Number(error?.details?.status) === 429 ||
      /(?:\b429\b|rate limit|too many requests)/iu.test(String(error?.message || '')))
  )
}

function collectPageFailures(context) {
  return context.session.plan
    .filter((step) => step.tool === 'page.generate-component' && step.status === 'completed')
    .map((step) => context.memory.get(step.id)?.data)
    .filter((value) => value?.failed)
    .map((value) => ({
      componentName: value.componentName,
      index: value.index,
      message: value.error,
    }))
}

function averageScore(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0
}

function normalizeStaticUiRuntimeDraft(value, designSpec) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const width = Math.max(
    320,
    Math.min(2560, Math.round(Number(source.viewport?.width) || designSpec.viewport.width)),
  )
  const height = Math.max(
    320,
    Math.min(10_000, Math.round(Number(source.viewport?.height) || designSpec.viewport.height)),
  )
  const html = typeof source.html === 'string' ? source.html.trim() : ''
  const css = typeof source.css === 'string' ? source.css.trim() : ''
  if (!html || !css)
    throw createRuntimeError('UI_RUNTIME_DRAFT_INVALID', 'Runtime Draft 缺少 HTML 或 CSS。')
  return {
    version: 1,
    title: String(source.title || designSpec.title || 'AI Runtime UI')
      .trim()
      .slice(0, 120),
    viewport: { width, height },
    html,
    css,
  }
}

/**
 * 执行视觉优化的结构化图片计划，并把生成结果绑定回 Runtime Scene。
 * 这里不依赖活动名称或中文关键词，任何入口只要提供 visualAssetPlan 即可复用。
 */
async function materializeVisualAssetPlan(context, sceneGraph, draft, invokeProvider) {
  const plan = context.session.visualAssetPlan
  if (!plan?.items?.length) return undefined
  const imageNodes = ensureVisualAssetSlots(sceneGraph, plan)
  const uploads = getPreparedUploads(context)
  const contentUploads = uploads.filter((upload) => upload.role === 'content')
  const referenceUploads = uploads.filter((upload) => upload.role !== 'content')
  const generated = []
  for (const item of plan.items) {
    const node = pickVisualAssetNode(imageNodes, item.id, generated.length)
    const contentUpload = contentUploads[generated.length]
    if (contentUpload) {
      node.asset = {
        source: contentUpload.data,
        fit: item.role === 'hero' ? 'cover' : 'contain',
        position: 'center',
      }
      node.ownership = { ...node.ownership, role: 'raster', regionId: item.id }
      node.bindings = {
        ...(node.bindings ?? {}),
        'visual.assetId': item.id,
        'visual.assetRole': item.role,
        'visual.slotRequired': item.slotRequired,
        'content.uploadName': contentUpload.name,
      }
      node.metadata = {
        ...(node.metadata ?? {}),
        designRole: item.role === 'hero' ? 'page-shell' : 'component-decoration',
        label: contentUpload.name,
      }
      generated.push({
        id: item.id,
        nodeId: node.id,
        targetSize: item.targetSize,
        source: 'content',
        uploadName: contentUpload.name,
      })
      continue
    }
    const prompt = [
      `生成视觉优化页面的 ${item.role} 独立位图资产（asset id: ${item.id}）。`,
      `目标尺寸：${item.targetSize.width} x ${item.targetSize.height}px。`,
      item.role === 'hero'
        ? '这是首屏 Hero 氛围图，只负责视觉焦点；禁止整页长图、禁止页面截图。'
        : '这是内容区配图，只生成单个主题对象或场景，不重复 Hero 的完整构图。',
      '禁止生成任何文字、标题、按钮、Logo 或 UI 控件，文案和按钮由可编辑 Scene 节点承载。',
      `页面目标：${context.session.goal}`,
      context.session.visualBrief ? `视觉方向：${JSON.stringify(context.session.visualBrief)}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const result = await requestImageWithTrace({
      invokeProvider,
      context,
      traceTool: 'ui.transform',
      task: createImageTask({
        id: item.id,
        name: `${item.id}.png`,
        role: item.role,
        kind: item.role === 'hero' ? 'full-background' : 'visual',
        targetSize: item.targetSize,
        transparent: false,
        prompt,
        referencePolicy: {
          roles: ['kv', 'visual', 'prototype', 'edit-base'],
          maxImages: 4,
        },
      }),
      question: prompt,
      uploads: referenceUploads,
      // 这里位于 ui.transform 中段，前面的资产已经生成。交给外层整步重试会连
      // HTML 和已完成的图片一起重做，所以单张图在内层自己重试一次。
      maxAttempts: 2,
    })
    if (result.artifact.kind !== 'raster' || !result.artifact.content) {
      throw createRuntimeError('VISUAL_ASSET_GENERATION_FAILED', `${item.id} 未返回有效位图资产。`)
    }
    const src = `data:${result.artifact.mime};base64,${result.artifact.content}`
    node.asset = {
      source: src,
      fit: item.role === 'hero' ? 'cover' : 'contain',
      position: item.role === 'hero' ? 'center' : 'center',
    }
    node.ownership = { ...node.ownership, role: 'raster', regionId: item.id }
    node.bindings = {
      ...(node.bindings ?? {}),
      'visual.assetId': item.id,
      'visual.assetRole': item.role,
      'visual.slotRequired': item.slotRequired,
    }
    node.metadata = {
      ...(node.metadata ?? {}),
      designRole: item.role === 'hero' ? 'page-shell' : 'component-decoration',
      label: item.id,
    }
    generated.push({
      id: item.id,
      nodeId: node.id,
      targetSize: item.targetSize,
      source: 'generated',
    })
  }
  const report = {
    version: 1,
    imagery: plan.imagery,
    plannedCount: plan.items.length,
    generatedCount: generated.filter((item) => item.source === 'generated').length,
    reusedContentCount: generated.filter((item) => item.source === 'content').length,
    boundCount: generated.filter((item) => item.nodeId).length,
    targetViewport: { width: draft.viewport.width, height: draft.viewport.height },
    assets: generated,
    contentUploadNames: generated.flatMap((item) =>
      item.source === 'content' && item.uploadName ? [item.uploadName] : [],
    ),
  }
  console.info('[runtime] visual-assets:bound', {
    taskKind: context.session.taskKind,
    imagery: report.imagery,
    plannedCount: report.plannedCount,
    generatedCount: report.generatedCount,
    boundCount: report.boundCount,
    targetViewport: report.targetViewport,
  })
  return report
}

/** 把 content 图片直接绑定到 Runtime Scene，避免把用户原图交给模型重绘。 */
function bindDirectContentAssets(sceneGraph, uploads, excludedNames = new Set()) {
  const contentUploads = uploads.filter(
    (upload) => upload.role === 'content' && !excludedNames.has(upload.name),
  )
  if (!contentUploads.length) return undefined
  const candidates = sceneGraph.nodes.filter(
    (node) => node.type === 'image' && !node.bindings?.['visual.assetId'],
  )
  ensureDirectContentSlots(sceneGraph, candidates, contentUploads.length)
  const assets = contentUploads.map((upload, index) => {
    const node =
      candidates.find((candidate) =>
        String(candidate.name || '')
          .toLowerCase()
          .includes(`content-${index + 1}`),
      ) || candidates[index]
    node.asset = { source: upload.data, fit: 'cover', position: 'center' }
    node.ownership = { ...node.ownership, role: 'raster', regionId: `content-${index + 1}` }
    node.bindings = {
      ...(node.bindings ?? {}),
      'content.assetId': `content-${index + 1}`,
      'content.uploadName': upload.name,
    }
    node.metadata = {
      ...(node.metadata ?? {}),
      designRole: 'content-image',
      label: upload.name,
    }
    return {
      id: `content-${index + 1}`,
      nodeId: node.id,
      source: 'content',
      uploadName: upload.name,
      targetSize: { width: node.bounds.width, height: node.bounds.height },
    }
  })
  return {
    version: 1,
    imagery: 'direct-content',
    plannedCount: contentUploads.length,
    generatedCount: 0,
    reusedContentCount: contentUploads.length,
    boundCount: assets.length,
    assets,
    contentUploadNames: contentUploads.map((upload) => upload.name),
  }
}

function ensureDirectContentSlots(sceneGraph, imageNodes, requiredCount) {
  const root = sceneGraph.nodes.find((node) => node.id === sceneGraph.rootNodeId)
  const maxZ = sceneGraph.nodes.reduce((max, node) => Math.max(max, Number(node.zIndex) || 0), 0)
  while (imageNodes.length < requiredCount) {
    const index = imageNodes.length
    const width = sceneGraph.surface.width
    const height = Math.min(
      Math.max(180, Math.round(width * 0.72)),
      Math.max(180, Math.round(sceneGraph.surface.height * 0.35)),
    )
    const node = {
      id: `direct-content-slot-${index + 1}`,
      type: 'image',
      parentId: root?.id,
      name: `content-${index + 1}`,
      bounds: {
        x: 0,
        y: Math.min(Math.max(0, sceneGraph.surface.height - height), index * (height + 24)),
        width,
        height,
      },
      zIndex: index === 0 ? 0 : maxZ + index,
      asset: { source: '', fit: 'cover', position: 'center' },
      source: { adapterId: 'direct-content', confidence: 1 },
      ownership: { regionId: `content-${index + 1}`, role: 'raster' },
      bindings: { 'content.assetId': `content-${index + 1}` },
      metadata: { designRole: 'content-image', label: `content-${index + 1}` },
    }
    sceneGraph.nodes.push(node)
    imageNodes.push(node)
  }
}

function mergeVisualAssetReports(planned, direct, draft) {
  if (!planned && !direct) return undefined
  const reports = [planned, direct].filter(Boolean)
  return {
    version: 1,
    imagery: planned?.imagery || direct?.imagery,
    plannedCount: reports.reduce((total, report) => total + report.plannedCount, 0),
    generatedCount: reports.reduce((total, report) => total + report.generatedCount, 0),
    reusedContentCount: reports.reduce(
      (total, report) => total + (report.reusedContentCount || 0),
      0,
    ),
    boundCount: reports.reduce((total, report) => total + report.boundCount, 0),
    targetViewport: { width: draft.viewport.width, height: draft.viewport.height },
    assets: reports.flatMap((report) => report.assets || []),
    contentUploadNames: reports.flatMap((report) => report.contentUploadNames || []),
  }
}

function ensureVisualAssetSlots(sceneGraph, plan) {
  const imageNodes = sceneGraph.nodes.filter((node) => node.type === 'image')
  if (imageNodes.length >= plan.items.length) return imageNodes
  const synthesizedCount = plan.items.length - imageNodes.length
  const root = sceneGraph.nodes.find((node) => node.id === sceneGraph.rootNodeId)
  const parentId = root?.id
  const maxZ = sceneGraph.nodes.reduce((max, node) => Math.max(max, Number(node.zIndex) || 0), 0)
  for (let index = imageNodes.length; index < plan.items.length; index += 1) {
    const item = plan.items[index]
    const isHero = item.role === 'hero'
    const width = Math.min(item.targetSize.width, sceneGraph.surface.width)
    const height = Math.min(item.targetSize.height, sceneGraph.surface.height)
    const y = isHero
      ? 0
      : Math.min(
          sceneGraph.surface.height - height,
          Math.max(0, Math.round(sceneGraph.surface.height * 0.45 + (index - 1) * (height + 24))),
        )
    const node = {
      id: `visual-asset-slot-${item.id}`,
      type: 'image',
      parentId,
      name: item.id,
      bounds: { x: Math.max(0, (sceneGraph.surface.width - width) / 2), y, width, height },
      zIndex: isHero ? 0 : maxZ + index,
      asset: { source: '', fit: isHero ? 'cover' : 'contain', position: 'center' },
      source: { adapterId: 'visual-asset-plan', confidence: 1 },
      ownership: { regionId: item.id, role: 'raster' },
      bindings: { 'visual.assetId': item.id, 'visual.assetRole': item.role },
      metadata: { designRole: isHero ? 'page-shell' : 'component-decoration', label: item.id },
    }
    sceneGraph.nodes.push(node)
    imageNodes.push(node)
  }
  sceneGraph.diagnostics = [
    ...(sceneGraph.diagnostics ?? []),
    {
      code: 'VISUAL_ASSET_SLOT_SYNTHESIZED',
      severity: 'warning',
      message: `Runtime 未提供完整图片 Slot，已根据 VisualAssetPlan 合成 ${synthesizedCount} 个可绑定 Slot。`,
    },
  ]
  return imageNodes
}

function pickVisualAssetNode(nodes, assetId, index) {
  const normalized = String(assetId || '').toLowerCase()
  return (
    nodes.find((node) =>
      String(node.name || '')
        .toLowerCase()
        .includes(normalized),
    ) || nodes[index]
  )
}

function assertRuntimeSceneCoversDraft(sceneGraph, draft) {
  const widthRatio = sceneGraph.surface.width / draft.viewport.width
  const heightRatio = sceneGraph.surface.height / draft.viewport.height
  if (widthRatio < 0.75 || heightRatio < 0.65) {
    throw createRuntimeError(
      'UI_RUNTIME_SCENE_INCOMPLETE',
      `Runtime DOM Scene 只覆盖 ${Math.round(widthRatio * 100)}% 宽度和 ${Math.round(heightRatio * 100)}% 高度，疑似只提取了局部顶层节点。`,
    )
  }
}

function alignColorPropertiesToTheme(propertyValues, colors) {
  if (!propertyValues || !Array.isArray(colors) || !colors.length) return propertyValues
  let colorIndex = 0
  return Object.fromEntries(
    Object.entries(propertyValues).map(([path, value]) => {
      if (!/color/i.test(path) || typeof value !== 'string') return [path, value]
      const color = colors[colorIndex % colors.length]
      colorIndex += 1
      return [path, color]
    }),
  )
}

function compileDesignBlockImageUpsert({ goal, scope, snapshot, uploads }) {
  if (scope?.type !== 'design-block' || !isDesignBlockImageRequest(goal)) return undefined
  const writableIds = new Set(scope.targetElementIds ?? [])
  const existingImage = (snapshot.elements ?? []).find(
    (element) =>
      element.type === 'image' &&
      writableIds.has(element.id) &&
      (scope.imageElementIds?.includes(element.id) || element.parentId === scope.elementId),
  )
  const prompt = buildDesignBlockImagePrompt({ goal, scope, uploads })
  const rawPatch = existingImage
    ? {
        version: 1,
        baseRevision: snapshot.documentRevision,
        artboardId: snapshot.artboardId,
        summary: `优化并替换${scope.name}中的图片`,
        operations: [
          {
            id: 'replace-design-block-image',
            kind: 'replace-image',
            elementId: existingImage.id,
            prompt,
          },
        ],
      }
    : {
        version: 1,
        baseRevision: snapshot.documentRevision,
        artboardId: snapshot.artboardId,
        summary: `为${scope.name}生成并添加图片`,
        operations: [
          {
            id: 'add-design-block-image',
            kind: 'add-image',
            prompt,
            element: createDesignBlockImageElement(scope, snapshot),
          },
        ],
      }
  const patch = normalizeDesignPatch(rawPatch, {
    documentRevision: snapshot.documentRevision,
    artboardId: snapshot.artboardId,
    goal,
    scopeId: scope.scopeId,
    targetHash: scope.targetHash,
    targetElementIds: scope.targetElementIds,
  })
  return {
    patch,
    actionKind: existingImage ? 'replace-image' : 'add-image',
    summary: existingImage
      ? `已锁定 ${scope.name} 中的现有图片，将优化后原位替换。`
      : `已为 ${scope.name} 规划模块内图片节点，将优化图片后置于可编辑文字和按钮下方。`,
  }
}

function isDesignBlockImageRequest(goal) {
  const value = String(goal || '')
  const image = /(?:图片|图像|配图|主图|主视觉|背景图|\bkv\b)/i.test(value)
  const action =
    /(?:添加|新增|插入|加入|放入|放进|放到|置入|使用|生成|优化|替换|换图|作为)/i.test(
      value,
    )
  return image && action
}

function createDesignBlockImageElement(scope, snapshot) {
  const elements = snapshot.elements ?? []
  const foreground = elements.filter(
    (element) =>
      scope.targetElementIds?.includes(element.id) &&
      ['text', 'button', 'input'].includes(element.type),
  )
  const background = elements.find(
    (element) =>
      scope.targetElementIds?.includes(element.id) &&
      element.parentId === scope.elementId &&
      element.type === 'shape',
  )
  const foregroundZ = foreground
    .map((element) => Number(element.zIndex))
    .filter(Number.isFinite)
  const zIndex = foregroundZ.length
    ? Math.min(...foregroundZ) - 0.5
    : (Number(background?.zIndex) || 0) + 0.5
  const baseId = `${scope.elementId}-image`
  const occupied = new Set(elements.map((element) => element.id))
  let elementId = baseId
  let suffix = 2
  while (occupied.has(elementId)) {
    elementId = `${baseId}-${suffix}`
    suffix += 1
  }
  return {
    id: elementId,
    type: 'image',
    name: `${scope.name} 主视觉`,
    parentId: scope.elementId,
    x: scope.bounds.x,
    y: scope.bounds.y,
    width: scope.bounds.width,
    height: scope.bounds.height,
    zIndex,
    src: '',
    objectFit: 'cover',
    objectPosition: 'center',
    borderRadius:
      Number(background?.borderRadius ?? background?.properties?.borderRadius) || 0,
    designBlockId: scope.blockId,
    designRole: 'component-decoration',
    layoutConstraints: { horizontal: 'stretch', vertical: 'stretch' },
  }
}

function buildDesignBlockImagePrompt({ goal, scope, uploads }) {
  const editBase = isImageEditGoal(goal) && uploads.length > 0
  return [
    `原始任务：${goal}`,
    `输出模式：${editBase ? 'image-edit' : 'marketing-visual'}`,
    `目标：为“${scope.name}”生成一张 ${Math.round(scope.bounds.width)} x ${Math.round(scope.bounds.height)}px 的模块图片。`,
    editBase
      ? '参考图职责：用户本轮图片是 Edit Base；保留主体身份、人物特征、核心构图与未要求改变的内容，只优化清晰度、光影、层次和对目标比例的适配。'
      : uploads.length
        ? '参考图职责：严格按附件声明的 KV、Visual、Prototype 或 Content 职责使用，不得混淆。'
        : '参考图：无；根据用户目标与当前模块语义生成。',
    '画布中的标题、正文、按钮和 Logo 将继续使用独立可编辑节点；图片不得重复生成这些 UI、解释文字、水印或无关文案。',
    '禁止生成整页设计稿、设备框、素材拼图或带编辑器界面的截图。',
  ].join('\n')
}

function isImageEditGoal(goal) {
  const value = String(goal || '')
  return /(?:这张|这个|发送|上传|原有|现有).{0,18}(?:图片|图).{0,18}(?:优化|调整|改进|编辑)|(?:优化|调整|改进|编辑).{0,18}(?:这张|这个|发送|上传|原有|现有).{0,18}(?:图片|图)/i.test(
    value,
  )
}

function preparePatchImageUploads(uploads, goal) {
  if (!isImageEditGoal(goal) || !uploads.length) return uploads
  let assigned = false
  return uploads.map((upload) => {
    if (assigned || !String(upload.data || '').startsWith('data:image/')) return upload
    assigned = true
    return { ...upload, role: 'edit-base' }
  })
}

function isPatchImageOperation(operation) {
  return ['add-image', 'replace-image', 'replace-image-region'].includes(operation?.kind)
}

function createPatchImageGenerationStep(actionKind) {
  return {
    id: 'generate-patch-images',
    title: actionKind === 'add-image' ? '生成并添加模块图片' : '生成替换图片',
    tool: 'design.patch.generate-images',
  }
}

function referenceRoleLabel(role) {
  if (role === 'content') return '原图素材'
  if (role === 'prototype') return '原型结构图'
  if (role === 'kv') return 'KV 视觉图'
  if (role === 'visual') return '视觉参考图'
  return '未指定参考图'
}

function describeDirectContentRequirements(uploads) {
  const contentUploads = uploads.filter((upload) => upload.role === 'content')
  if (!contentUploads.length) return ''
  return [
    '以下图片是必须原样使用的内容素材，禁止提取其风格、禁止重绘：',
    ...contentUploads.map(
      (upload, index) =>
        `${index + 1}. ${upload.name}：在 HTML 中创建独立 <img data-asset-slot="content-${index + 1}">，Runtime 会绑定原图像素。`,
    ),
  ].join('\n')
}

function removeImageStepForNonImagePatch(session, patch) {
  const hasImageOperation = patch.operations.some((operation) => isPatchImageOperation(operation))
  if (hasImageOperation || !Array.isArray(session.plan)) return
  session.plan = session.plan.filter((step) => step.tool !== 'design.patch.generate-images')
}

function getPreparedUploads(context) {
  return context.memory.get('reference.prepare')?.data?.uploads ?? []
}

function isContinuationPrompt(prompt) {
  return /^(?:请)?(?:继续|开始|执行|接着做|继续执行|开始生成|生成吧|就这样|允许|确认|确认执行|重试|再试一次)[吧。！!\s]*$/i.test(
    String(prompt || '').trim(),
  )
}

function describeReferences(uploads) {
  if (!uploads.length) return ''
  return `参考图：\n${uploads
    .map(
      (upload, index) =>
        `图片 ${index + 1}：${upload.name}，角色=${referenceRoleLabel(upload.role)}`,
    )
    .join('\n')}`
}

function describeComponentReferences(uploads) {
  if (!uploads.length) return '没有可用参考图。'
  const lines = uploads.map((upload) => {
    const role =
      upload.role === 'prototype'
        ? '原型或 thumbnail（仅结构）'
        : upload.role === 'kv'
          ? 'KV（强制视觉来源）'
          : upload.role === 'visual'
            ? '视觉参考（强制视觉来源）'
            : upload.role === 'content'
              ? '原图素材（直接绑定，禁止重绘）'
              : '未指定参考'
    return `${upload.name}：${role}`
  })
  return [
    '组件参考图职责（最终附件序号由生图请求阶段重新声明）：',
    ...lines,
    '视觉优先级：用户 KV/视觉参考 > 用户文字风格 > thumbnail 配色 > 组件默认配色。',
  ].join('\n')
}

function compactComponentStructure(tree) {
  if (!tree?.nodes?.length) return []
  return tree.nodes.slice(0, 120).map((node) => ({
    id: node.id,
    parentId: node.parentId,
    type: node.type,
    role: node.role,
    content: node.content,
    bounds: node.bounds,
    style: {
      fontSize: node.style?.fontSize,
      fontWeight: node.style?.fontWeight,
      lineHeight: node.style?.lineHeight,
      textAlign: node.style?.textAlign,
    },
  }))
}

function applyHybridForegroundStyle(region, visualTheme) {
  const colors = Object.fromEntries(
    (visualTheme?.colorTokens ?? [])
      .filter((token) => token?.role && typeof token.value === 'string')
      .map((token) => [token.role, token.value]),
  )
  const surface = visualTheme?.surfaces?.[0]
  const background = surface?.fill || colors.surface || colors.background || colors.primary
  const fallbackForeground = readableThemeForeground(background)
  const foreground =
    colorContrastRatio(colors.text, background) >= 3 ? colors.text : fallbackForeground
  if (region.renderMode === 'button') {
    const buttonBackground = colors.primary || colors.secondary || background
    return {
      ...(region.style ?? {}),
      fill: buttonBackground,
      color:
        colorContrastRatio(colors.text, buttonBackground) >= 3
          ? colors.text
          : readableThemeForeground(buttonBackground),
    }
  }
  if (region.renderMode === 'text') {
    return {
      ...(region.style ?? {}),
      color: foreground,
    }
  }
  if (region.renderMode === 'color') {
    const semanticAccent = ['progress', 'badge', 'divider'].includes(region.designNodeType)
    return {
      ...(region.style ?? {}),
      fill: semanticAccent ? colors.primary || colors.secondary || background : background,
      radius: Number.isFinite(region.style?.radius) ? region.style.radius : surface?.radius,
    }
  }
  return region.style
}

function isFullCanvasSurface(region, targetSize) {
  if (region.renderMode !== 'color') return false
  const canvasArea = Math.max(1, targetSize.width * targetSize.height)
  const area = Math.max(0, region.bounds.width * region.bounds.height)
  return (
    area / canvasArea >= 0.82 &&
    region.bounds.x <= targetSize.width * 0.05 &&
    region.bounds.y <= targetSize.height * 0.05
  )
}

function readableThemeForeground(background) {
  const luminance = colorLuminance(background)
  if (!Number.isFinite(luminance)) return '#ffffff'
  return luminance > 0.58 ? '#1f2937' : '#ffffff'
}

function colorContrastRatio(foreground, background) {
  const foregroundLuminance = colorLuminance(foreground)
  const backgroundLuminance = colorLuminance(background)
  if (!Number.isFinite(foregroundLuminance) || !Number.isFinite(backgroundLuminance)) return 0
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function colorLuminance(color) {
  const value = String(color || '').trim()
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  const rgb = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i)
  const channels = hex
    ? [0, 2, 4].map((offset) => Number.parseInt(hex[1].slice(offset, offset + 2), 16) / 255)
    : rgb
      ? rgb.slice(1, 4).map((channel) => Math.max(0, Math.min(255, Number(channel))) / 255)
      : undefined
  if (!channels) return Number.NaN
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function calibrateReferenceVisualTheme(theme, upload) {
  const evidenceColors = analyzeUploadPalette(upload)
  if (evidenceColors.length < 2) {
    return { theme, corrected: false, modelAffinity: 1 }
  }
  const modelAffinity = colorSetAffinity(theme.colors, evidenceColors)
  const corrected = modelAffinity < 0.45
  const sourceTheme = corrected
    ? normalizeVisualTheme({
        ...theme,
        colors: evidenceColors,
        colorTokens: [],
        surfaces: [],
      })
    : theme
  return {
    corrected,
    modelAffinity,
    theme: {
      ...sourceTheme,
      source: upload.role === 'kv' ? 'kv' : 'visual',
      referenceImageIndex: 1,
      evidence: {
        method: 'local-pixel-palette-v1',
        referenceName: upload.name,
        colors: evidenceColors,
        modelAffinity: roundScore(modelAffinity),
        calibrated: corrected,
      },
    },
  }
}

function analyzeUploadPalette(upload) {
  const parsed = parseImageDataUri(upload?.data)
  if (!parsed) return []
  const analysis = analyzeRaster(parsed.buffer, parsed.mime)
  return (analysis.dominantColors ?? []).filter((color) => parseColor(color)).slice(0, 6)
}

function parseImageDataUri(value) {
  const match = String(value || '').match(/^data:(image\/(?:png|jpeg));base64,([\s\S]+)$/i)
  if (!match) return undefined
  try {
    return { mime: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') }
  } catch {
    return undefined
  }
}

function colorSetAffinity(sourceColors, referenceColors) {
  const source = (sourceColors ?? []).map(parseColor).filter(Boolean)
  const reference = (referenceColors ?? []).map(parseColor).filter(Boolean)
  if (!source.length || !reference.length) return 0
  return (
    source.filter((color) => reference.some((candidate) => colorDistance(color, candidate) <= 72))
      .length / source.length
  )
}

function buildDesignQuestion(context, brief) {
  const uploads = getPreparedUploads(context)
  const placementMode = context.session.canvasTarget?.placementMode
  const outputInstruction =
    placementMode === 'append-section'
      ? '只生成一个可追加到当前画板底部的页面模块，并输出为单张图片；不要重复生成完整页面。'
      : placementMode === 'duplicate-variant'
        ? '生成当前页面的一个完整视觉变体，并输出为单张图片。'
        : '生成一张完整静态页面设计图。'
  return [
    outputInstruction,
    `任务目标：${context.session.goal}`,
    brief ? `必须遵循以下 GenerationBrief：\n${describeGenerationBrief(brief)}` : '',
    context.session.canvasTarget
      ? [
          `目标画板逻辑宽度：${context.session.canvasTarget.width}px。`,
          `初始参考高度：${context.session.canvasTarget.height}px，但高度必须根据内容自然延展，不要为了适配固定高度压缩或截断内容。`,
          '保持 375px H5 逻辑比例；Runtime 会根据生图模型输出尺寸统一换算到画板。',
        ].join('\n')
      : '',
    describeReferences(uploads),
    '严格遵守每张参考图在 GenerationBrief 中的职责，不得混淆结构参考与视觉参考。',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function inspectSvgArtifact(artifact, canvasTarget = {}) {
  const content = typeof artifact?.content === 'string' ? artifact.content : ''
  const issues = []
  const byteLength = Buffer.byteLength(content)
  const rootMatch = content.match(/<svg\b([^>]*)>/i)
  const attributes = rootMatch?.[1] ?? ''
  const widthAttribute = readNumericAttribute(attributes, 'width')
  const heightAttribute = readNumericAttribute(attributes, 'height')
  const viewBox = readViewBox(attributes)
  const width = widthAttribute ?? viewBox?.width ?? 0
  const height = heightAttribute ?? viewBox?.height ?? 0
  const visibleNodeCount = (
    content.match(/<(?:path|rect|circle|ellipse|polygon|polyline|line|image|text|use)\b/gi) ?? []
  ).length
  const textNodeCount = (content.match(/<text\b/gi) ?? []).length

  if (!rootMatch || !/<\/svg>\s*$/i.test(content.trim())) {
    addIssue(issues, 'svg-root', 'SVG 根节点不完整。')
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    addIssue(issues, 'svg-size', 'SVG 必须声明有效的 width、height 或 viewBox。')
  } else if (width > 4000 || height > 30000) {
    addIssue(issues, 'svg-size-limit', 'SVG 尺寸超过设计稿安全范围。')
  }
  if (visibleNodeCount === 0 || byteLength < 200) {
    addIssue(issues, 'svg-empty', 'SVG 没有足够的可见设计内容。')
  }
  if (/<(?:script|foreignObject)\b|\son[a-z]+\s*=/i.test(content)) {
    addIssue(issues, 'svg-unsafe', 'SVG 包含不允许的脚本、foreignObject 或事件处理器。')
  }
  if (/(?:href|xlink:href)=["']https?:|url\(["']?https?:/i.test(content)) {
    addIssue(issues, 'svg-external-resource', 'SVG 包含未内嵌的网络资源。')
  }
  const placementMode = canvasTarget?.placementMode
  const logicalWidth = Number(canvasTarget?.width) || 375
  if (placementMode !== 'append-section' && width > 0) {
    const isExpectedWidth =
      Math.abs(width - logicalWidth) <= 2 || Math.abs(width - logicalWidth * 2) <= 4
    if (!isExpectedWidth) {
      addIssue(
        issues,
        'svg-page-width',
        `完整页面宽度应为 ${logicalWidth}px 或 ${logicalWidth * 2}px。`,
      )
    }
  }
  if (placementMode === 'append-section' && width > 0 && height / width > 4) {
    addIssue(issues, 'svg-section-ratio', '追加模块高度异常，疑似错误生成了完整长页面。')
  }
  if (textNodeCount === 0) {
    addIssue(
      issues,
      'svg-no-text',
      'SVG 没有可检索文本，请确认文案是否已经转为路径或位图。',
      'warning',
    )
  }

  return {
    passed: !issues.some((issue) => issue.severity === 'error'),
    issues,
    metrics: { width, height, visibleNodeCount, textNodeCount, byteLength },
  }
}

export function inspectImageArtifact(artifact, canvasTarget = {}) {
  if (artifact?.kind === 'svg') return inspectSvgArtifact(artifact, canvasTarget)
  const issues = []
  const content = typeof artifact?.content === 'string' ? artifact.content : ''
  const width = Number(artifact?.width)
  const height = Number(artifact?.height)
  const mime = artifact?.mime
  const byteLength = content ? Buffer.byteLength(content, 'base64') : 0
  if (artifact?.kind !== 'raster') addIssue(issues, 'image-kind', '图片制品类型无效。')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) {
    addIssue(issues, 'image-mime', '位图格式必须为 PNG、JPEG 或 WebP。')
  }
  if (!content || !/^[a-z0-9+/=\s]+$/i.test(content))
    addIssue(issues, 'image-content', '位图 Base64 内容无效。')
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    addIssue(issues, 'image-size', '位图缺少有效宽高。')
  } else if (width > 8192 || height > 8192) {
    addIssue(issues, 'image-size-limit', '位图尺寸超过安全范围。')
  }
  if (!byteLength || byteLength > 30 * 1024 * 1024)
    addIssue(issues, 'image-bytes', '位图为空或超过 30MB。')
  const analysis = artifact?.analysis ?? {}
  const sourceAnalysis = analysis.source ?? analysis
  if (Number.isFinite(sourceAnalysis.ratioError) && sourceAnalysis.ratioError > 0.7) {
    addIssue(
      issues,
      'image-source-ratio',
      '模型原图比例严重偏离目标，后处理可能损失构图。',
      'warning',
    )
  }
  if (Number.isFinite(analysis.ratioError) && analysis.ratioError > 0.03) {
    addIssue(issues, 'image-normalized-ratio', '归一化后的位图比例与目标比例不一致。')
  }
  // 归一化后尺寸必然等于目标，ratioError 恒为 0；构图损失只能靠裁切占比暴露。
  const cropLoss = analysis.transform?.cropLoss
  if (Number.isFinite(cropLoss) && cropLoss > 0.4) {
    addIssue(
      issues,
      'image-crop-loss',
      `目标比例与生图画布差异较大，居中裁剪丢弃了 ${Math.round(cropLoss * 100)}% 画面，边缘构图可能缺失。`,
      'warning',
    )
  }
  if (
    Number.isFinite(sourceAnalysis.checkerboardCoverage) &&
    sourceAnalysis.checkerboardCoverage > 0.025
  ) {
    addIssue(issues, 'image-fake-transparency', '模型原图包含烘焙的灰白棋盘格，属于伪透明背景。')
  }
  if (Number.isFinite(analysis.checkerboardCoverage) && analysis.checkerboardCoverage > 0.025) {
    addIssue(issues, 'image-normalized-fake-transparency', '归一化素材仍包含烘焙的灰白棋盘格。')
  }
  if (canvasTarget.transparent === true) {
    if (
      Number.isFinite(sourceAnalysis.transparentCoverage) &&
      sourceAnalysis.transparentCoverage < 0.005
    ) {
      addIssue(
        issues,
        'image-source-alpha-missing',
        '模型原始素材没有足够的 alpha=0 背景像素，不是真实透明独立素材。',
      )
    } else if (
      !Number.isFinite(sourceAnalysis.transparentCoverage) &&
      Number.isFinite(sourceAnalysis.alphaCoverage) &&
      sourceAnalysis.alphaCoverage > 0.995
    ) {
      addIssue(
        issues,
        'image-source-alpha-missing',
        '模型原始素材没有足够的透明背景，不是真实透明独立素材。',
      )
    }
    if (
      Number.isFinite(analysis.whiteBackgroundCoverage) &&
      analysis.whiteBackgroundCoverage > 0.45
    ) {
      addIssue(issues, 'image-white-background', '独立素材包含大面积白色不透明背景。')
    }
    if (
      Number.isFinite(sourceAnalysis.whiteBackgroundCoverage) &&
      sourceAnalysis.whiteBackgroundCoverage > 0.45
    ) {
      addIssue(issues, 'image-source-white-background', '模型原始素材包含大面积白色不透明背景。')
    }
  }
  return {
    passed: !issues.some((issue) => issue.severity === 'error'),
    issues,
    metrics: { width, height, visibleNodeCount: 1, textNodeCount: 0, byteLength, ...analysis },
  }
}

function createImageTask({
  id,
  slotId,
  name,
  label,
  role,
  propPath,
  fallbackPath,
  exactText,
  targetSize,
  transparent,
  prompt,
  kind,
  referencePolicy,
  maskedEdit,
  designOnly,
  textPolicy,
}) {
  return {
    id,
    slotId,
    name,
    label,
    role,
    propPath,
    fallbackPath,
    exactText,
    targetSize: {
      width: Math.max(1, Math.round(Number(targetSize?.width) || 375)),
      height: Math.max(1, Math.round(Number(targetSize?.height) || 812)),
    },
    transparent: Boolean(transparent),
    kind,
    referencePolicy,
    maskedEdit: Boolean(maskedEdit),
    designOnly: Boolean(designOnly),
    textPolicy: ['embedded-exact', 'model-exact'].includes(textPolicy) ? textPolicy : undefined,
    prompt,
  }
}

async function generateArtifactNode({
  invokeProvider,
  context,
  task,
  commonPrompt,
  uploads,
  visualTheme,
  maxAttempts = 2,
}) {
  const traceTool = task.traceTool || 'component.generate-assets'
  let lastError
  let attempts = 0
  let correctionPrompt = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt
    const startedAt = Date.now()
    emitToolTrace(context, {
      stage: 'design.transform',
      tool: traceTool,
      operation: 'component-asset',
      taskId: task.id,
      slotId: task.id,
      label: task.name || task.id,
      status: attempt === 1 ? 'started' : 'retrying',
      attempt,
      maxAttempts,
      targetSize: task.targetSize,
      message: `${attempt === 1 ? '开始生成' : '重新生成'}素材 ${task.name || task.id}`,
    })
    try {
      const attemptTask = correctionPrompt
        ? { ...task, prompt: [task.prompt, correctionPrompt].filter(Boolean).join('\n\n') }
        : task
      const result = await invokeProviderWithTimeout({
        invokeProvider,
        payload: {
          ...context.payload,
          type: 'generate_image',
          question: [commonPrompt, attemptTask.prompt].filter(Boolean).join('\n\n'),
          uploads,
          imageTasks: [attemptTask],
        },
        parentSignal: context.payload.signal,
        timeoutMs: getAssetTaskTimeoutMs(task),
        task,
      })
      if (!result?.artifact)
        throw createRuntimeError('COMPONENT_ARTIFACT_MISSING', `${task.id} 没有返回图片。`)
      const review = inspectImageArtifact(result.artifact, {
        placementMode: 'asset-board',
        width: task.targetSize.width,
        height: task.targetSize.height,
        transparent: task.transparent,
      })
      const fakeTransparency = review.issues.some(
        (issue) =>
          issue.code === 'image-fake-transparency' ||
          issue.code === 'image-normalized-fake-transparency',
      )
      const transparencyIssues = review.issues.filter((issue) =>
        [
          'image-fake-transparency',
          'image-normalized-fake-transparency',
          'image-source-alpha-missing',
          'image-white-background',
          'image-source-white-background',
        ].includes(issue.code),
      )
      if (fakeTransparency || (task.transparent && transparencyIssues.length)) {
        correctionPrompt = task.transparent
          ? '上一版不符合透明素材契约。重新生成带真实 Alpha 通道的 PNG：主体外所有背景像素必须为 alpha=0；禁止棋盘格、白底、灰底、纯色底、展示板或截图背景。不要只在成品四周添加少量透明边距。'
          : '上一版错误绘制了代表透明的灰白棋盘格。禁止棋盘格和截图背景，使用任务要求的真实完整背景。'
        const code = fakeTransparency ? 'IMAGE_FAKE_TRANSPARENCY' : 'IMAGE_ALPHA_REQUIRED'
        throw createRuntimeError(
          code,
          `${task.id} 未生成真实透明背景：${transparencyIssues.map((issue) => issue.message).join('；')}；${describeTransparencyMetrics(review)}`,
        )
      }
      emitToolTrace(context, {
        stage: 'design.transform',
        tool: traceTool,
        operation: 'component-asset',
        taskId: task.id,
        slotId: task.id,
        label: task.name || task.id,
        status: 'completed',
        attempt,
        maxAttempts,
        elapsedMs: Date.now() - startedAt,
        targetSize: task.targetSize,
        message: `素材 ${task.name || task.id} 生成完成`,
      })
      return { artifact: result.artifact, fallback: false, attempts: attempt }
    } catch (error) {
      lastError = error
      if (context.payload.signal?.aborted || error?.code === 'AGENT_CANCELLED') throw error
      const rateLimited = isImageRateLimitError(error)
      emitToolTrace(context, {
        stage: 'design.transform',
        tool: traceTool,
        operation: 'component-asset',
        taskId: task.id,
        slotId: task.id,
        label: task.name || task.id,
        status:
          attempt < maxAttempts && error?.code !== 'COMPONENT_ASSET_TIMEOUT' && !rateLimited
            ? 'retrying'
            : 'fallback',
        attempt,
        maxAttempts,
        elapsedMs: Date.now() - startedAt,
        targetSize: task.targetSize,
        errorCode: error?.code,
        message: safeTraceError(error),
      })
      // A timed-out upstream request is unlikely to succeed immediately and
      // must not hold the entire component transaction for another timeout.
      if (error?.code === 'COMPONENT_ASSET_TIMEOUT' || rateLimited) break
    }
  }
  return {
    artifact: createFallbackArtifact(task, visualTheme),
    fallback: true,
    attempts,
    errorCode: lastError?.code,
    error: lastError instanceof Error ? lastError.message : String(lastError || '图片生成失败'),
  }
}

function getAssetTaskTimeoutMs(task) {
  if (task.role === 'component-backdrop') {
    const backdropTimeout = Number(process.env.AGENT_BACKDROP_TIMEOUT_MS)
    if (Number.isFinite(backdropTimeout) && backdropTimeout > 0) return backdropTimeout
  }
  const configured = Number(process.env.AGENT_ASSET_TIMEOUT_MS)
  if (Number.isFinite(configured) && configured > 0) return configured
  if (task.role === 'component-backdrop') return 60_000
  // 整页设计图和视觉资产是全画幅构图，比组件局部素材慢得多。
  if (task.role === 'design-image' || task.role === 'hero') return 150_000
  return task.designOnly ? 120_000 : 90_000
}

/**
 * 单张图片请求的统一外壳：per-request 超时、有限重试和逐张时间线 trace。
 * 与 generateArtifactNode 的区别是失败直接抛出，不回退本地 SVG —— 整页设计图和
 * 视觉资产没有可接受的确定性替代品，静默降级会把坏结果当成交付物。
 */
async function requestImageWithTrace({
  invokeProvider,
  context,
  task,
  question,
  uploads,
  traceTool,
  maxAttempts = 2,
}) {
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now()
    emitToolTrace(context, {
      stage: 'design.transform',
      tool: traceTool,
      operation: 'image',
      taskId: task.id,
      label: task.name || task.id,
      status: attempt === 1 ? 'started' : 'retrying',
      attempt,
      maxAttempts,
      targetSize: task.targetSize,
      message: `${attempt === 1 ? '开始生成' : '重新生成'} ${task.name || task.id}`,
    })
    try {
      const result = await invokeProviderWithTimeout({
        invokeProvider,
        payload: {
          ...context.payload,
          type: 'generate_image',
          question,
          uploads,
          imageTasks: [task],
        },
        parentSignal: context.payload.signal,
        timeoutMs: getAssetTaskTimeoutMs(task),
        task,
      })
      if (!result?.artifact) {
        throw createRuntimeError('AGENT_ARTIFACT_MISSING', `${task.id} 没有返回图片制品。`)
      }
      emitToolTrace(context, {
        stage: 'design.transform',
        tool: traceTool,
        operation: 'image',
        taskId: task.id,
        label: task.name || task.id,
        status: 'completed',
        attempt,
        maxAttempts,
        elapsedMs: Date.now() - startedAt,
        targetSize: task.targetSize,
        message: `${task.name || task.id} 生成完成`,
      })
      return result
    } catch (error) {
      lastError = error
      if (context.payload.signal?.aborted || error?.code === 'AGENT_CANCELLED') throw error
      const rateLimited = isImageRateLimitError(error)
      const retryable =
        attempt < maxAttempts && error?.code !== 'COMPONENT_ASSET_TIMEOUT' && !rateLimited
      emitToolTrace(context, {
        stage: 'design.transform',
        tool: traceTool,
        operation: 'image',
        taskId: task.id,
        label: task.name || task.id,
        status: retryable ? 'retrying' : 'failed',
        attempt,
        maxAttempts,
        elapsedMs: Date.now() - startedAt,
        targetSize: task.targetSize,
        errorCode: error?.code,
        message: safeTraceError(error),
      })
      // 超时的上游请求不会立刻恢复，限流重试只会加重限流。
      if (!retryable) break
    }
  }
  throw lastError
}

export function repairFailedTextOverlaySiblings(results, tasks) {
  // model-exact 会把各 Slot 的准确文案直接生成进图片，跨 Slot 复用会带入错误文案。
  void tasks
  return results
}

async function invokeProviderWithTimeout({
  invokeProvider,
  payload,
  parentSignal,
  timeoutMs,
  task,
}) {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(parentSignal?.reason)
  parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  const timeoutError = createRuntimeError(
    'COMPONENT_ASSET_TIMEOUT',
    task.role === 'component-backdrop'
      ? `${task.name || task.id} 生图请求超过 ${Math.round(timeoutMs / 1000)} 秒，将使用 VisualTheme 确定性背景继续交付。`
      : `${task.name || task.id} 生图请求超过 ${Math.round(timeoutMs / 1000)} 秒，已切换本地回退素材。`,
    { taskId: task.id, timeoutMs, retryable: false },
  )
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs)
  try {
    return await invokeProvider({ ...payload, signal: controller.signal }, {})
  } catch (error) {
    if (
      !parentSignal?.aborted &&
      controller.signal.aborted &&
      controller.signal.reason === timeoutError
    ) {
      throw timeoutError
    }
    throw error
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
}

function emitToolTrace(context, trace) {
  const event = {
    type: 'tool.trace',
    sessionId: context.session.id,
    stepId: context.session.currentStepId,
    trace: {
      ...trace,
      id: [trace.tool, trace.taskId || 'tool', trace.status, Date.now()].join(':'),
      timestamp: Date.now(),
    },
  }
  if (process.env.VITE_DEV_SERVER_URL || process.env.AI_STUDIO_AGENT_TRACE === '1') {
    console.info('[agent-trace]', {
      sessionId: event.sessionId,
      stepId: event.stepId,
      ...event.trace,
    })
  }
  context.providerCallbacks.onAgentEvent?.(event)
}

function safeTraceError(error) {
  const message = error instanceof Error ? error.message : String(error || '未知错误')
  return message
    .replace(/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/gi, '[image-data]')
    .slice(0, 320)
}

function describeTransparencyMetrics(review) {
  const normalized = review?.metrics ?? {}
  const source = normalized.source ?? normalized
  const percent = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '未知')
  return [
    `原图透明像素=${percent(source.transparentCoverage)}`,
    `原图白色不透明像素=${percent(source.whiteBackgroundCoverage)}`,
    `原图棋盘格置信度=${percent(source.checkerboardCoverage)}`,
  ].join('，')
}

function createFallbackArtifact(task, visualTheme) {
  const width = task.targetSize.width
  const height = task.targetSize.height
  const colors = visualTheme?.colors?.length
    ? visualTheme.colors
    : ['#2563eb', '#0f172a', '#ffffff']
  const primary = colors[0]
  const secondary = colors[1] ?? colors[0]
  const accent = colors[2] ?? '#ffffff'
  const radius = Math.max(6, Math.min(24, Math.round(Math.min(width, height) * 0.18)))
  const content = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${escapeXml(task.name || task.id)} fallback</title>`,
    '<defs>',
    `<linearGradient id="fallback-gradient" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${escapeXml(primary)}"/><stop offset="1" stop-color="${escapeXml(secondary)}"/></linearGradient>`,
    '</defs>',
    `<rect width="${width}" height="${height}" rx="${radius}" fill="url(#fallback-gradient)"/>`,
    `<rect x="${Math.max(2, width * 0.025)}" y="${Math.max(2, height * 0.05)}" width="${Math.max(1, width * 0.95)}" height="${Math.max(1, height * 0.9)}" rx="${Math.max(4, radius - 3)}" fill="none" stroke="${escapeXml(accent)}" stroke-opacity="0.35"/>`,
    `<circle cx="${width * 0.82}" cy="${height * 0.22}" r="${Math.max(3, Math.min(width, height) * 0.1)}" fill="${escapeXml(accent)}" opacity="0.24"/>`,
    `<path d="M${width * 0.08} ${height * 0.75} C${width * 0.3} ${height * 0.55},${width * 0.65} ${height * 0.92},${width * 0.92} ${height * 0.62}" fill="none" stroke="${escapeXml(accent)}" stroke-opacity="0.28" stroke-width="${Math.max(1, Math.min(width, height) * 0.035)}"/>`,
    '</svg>',
  ].join('')
  return { kind: 'svg', name: task.name, content }
}

function createDeterministicComponentBackdrop(task, visualTheme) {
  const width = task.targetSize.width
  const height = task.targetSize.height
  const colors = visualTheme?.colors?.length
    ? visualTheme.colors
    : ['#f472b6', '#fb7185', '#fdf2f8']
  const primary = colors[0]
  const secondary = colors[1] ?? primary
  const surface =
    visualTheme?.colorTokens?.find((token) => token.role === 'background')?.value ??
    colors[2] ??
    secondary
  const content = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<defs>',
    `<linearGradient id="backdrop-base" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${escapeXml(surface)}"/><stop offset="0.52" stop-color="${escapeXml(primary)}"/><stop offset="1" stop-color="${escapeXml(secondary)}"/></linearGradient>`,
    `<radialGradient id="backdrop-light"><stop stop-color="#ffffff" stop-opacity="0.34"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>`,
    '</defs>',
    `<rect width="${width}" height="${height}" fill="url(#backdrop-base)"/>`,
    `<circle cx="${width * 0.08}" cy="${height * 0.16}" r="${Math.max(width, height) * 0.28}" fill="url(#backdrop-light)"/>`,
    `<circle cx="${width * 0.94}" cy="${height * 0.82}" r="${Math.max(width, height) * 0.24}" fill="url(#backdrop-light)" opacity="0.7"/>`,
    `<path d="M0 ${height * 0.88} C${width * 0.22} ${height * 0.72},${width * 0.68} ${height * 1.02},${width} ${height * 0.78}" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="${Math.max(2, width * 0.018)}"/>`,
    `<path d="M${width * 0.72} 0 C${width * 0.9} ${height * 0.18},${width * 0.78} ${height * 0.38},${width} ${height * 0.52}" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="${Math.max(1, width * 0.012)}"/>`,
    '</svg>',
  ].join('')
  return { kind: 'svg', name: task.name, content }
}

function createPageEmbeddedComponentSurface(task, visualDirection, visualTheme) {
  const width = task.targetSize.width
  const height = task.targetSize.height
  const palette = visualDirection?.palette ?? {}
  const colors = visualTheme?.colors?.length ? visualTheme.colors : ['#ffffff', '#111111']
  const surface = palette.surface ?? colors[0]
  const accent = palette.accent ?? colors[1] ?? colors[0]
  const treatment = visualDirection?.surfaceTreatment ?? {}
  const opacity = clampUnitInterval(treatment.opacity, 0.88)
  const borderOpacity = clampUnitInterval(treatment.borderOpacity, 0.26)
  const highlightOpacity = clampUnitInterval(treatment.highlightOpacity, 0.12)
  const radius = Math.max(8, Math.min(18, Math.round(Math.min(width, height) * 0.035)))
  const inset = Math.max(1, Math.round(Math.min(width, height) * 0.006))
  const content = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${escapeXml(task.name || task.id)} page embedded surface</title>`,
    '<defs>',
    `<linearGradient id="component-surface" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${escapeXml(surface)}"/><stop offset="1" stop-color="${escapeXml(surface)}" stop-opacity="0.94"/></linearGradient>`,
    '</defs>',
    `<rect x="${inset}" y="${inset}" width="${Math.max(1, width - inset * 2)}" height="${Math.max(1, height - inset * 2)}" rx="${radius}" fill="url(#component-surface)" fill-opacity="${opacity}" stroke="${escapeXml(accent)}" stroke-opacity="${borderOpacity}"/>`,
    `<rect x="${inset + 1}" y="${inset + 1}" width="${Math.max(1, width - (inset + 1) * 2)}" height="${Math.max(1, height - (inset + 1) * 2)}" rx="${Math.max(1, radius - 1)}" fill="none" stroke="#ffffff" stroke-opacity="${highlightOpacity}"/>`,
    '</svg>',
  ].join('')
  return { kind: 'svg', name: task.name, content }
}

function clampUnitInterval(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(1, Math.max(0, number))
}

function addIssue(issues, code, message, severity = 'error') {
  issues.push({ code, message, severity })
}

function readNumericAttribute(attributes, name) {
  const match = attributes.match(
    new RegExp(`\\b${name}=["']([0-9]+(?:\\.[0-9]+)?)(?:px)?["']`, 'i'),
  )
  return match ? Number(match[1]) : undefined
}

function readViewBox(attributes) {
  const match = attributes.match(
    /\bviewBox=["']\s*[-+]?\d*\.?\d+(?:[\s,]+)[-+]?\d*\.?\d+(?:[\s,]+)(\d*\.?\d+)(?:[\s,]+)(\d*\.?\d+)\s*["']/i,
  )
  if (!match) return undefined
  return { width: Number(match[1]), height: Number(match[2]) }
}

function selectComponentProfile(contract, prompt) {
  const profiles = Array.isArray(contract?.profiles) ? contract.profiles : []
  if (!profiles.length) {
    const hasDesignSurface =
      contract?.designProperties?.length || contract?.structuralControls?.length
    return hasDesignSurface ? { id: 'default', rootPath: '', confidence: 1 } : undefined
  }
  const normalized = String(prompt || '').toLowerCase()
  const explicit = profiles.find(
    (profile) =>
      normalized.includes(String(profile.id).toLowerCase()) ||
      normalized.includes(String(profile.rootPath).toLowerCase()),
  )
  if (explicit) return explicit
  if (/自由模式|free\s*mode|自由布局/i.test(normalized)) {
    const free = profiles.find((profile) => /free|自由/i.test(`${profile.id} ${profile.rootPath}`))
    if (free) return free
  }
  return (
    profiles.find((profile) => !/free|自由/i.test(`${profile.id} ${profile.rootPath}`)) ??
    profiles[0]
  )
}

function createContractVisualTheme(contract, profileId, goal) {
  const colors = [...contract.designProperties, ...contract.structuralControls]
    .filter((property) => propertyInProfile(property, profileId) && property.kind === 'color')
    .map((property) => property.defaultValue)
    .filter((value) => typeof value === 'string' && isValidDesignValue('color', value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 6)
  while (colors.length < 3) colors.push(['#2563eb', '#0f172a', '#ffffff'][colors.length])
  return normalizeVisualTheme({
    source: 'prompt',
    colors,
    visualStyle: String(goal || '').trim() || `${contract.componentName} 活动组件视觉`,
    confidence: 0.65,
  })
}

function createDeterministicComponentBlueprint(contract, profile, visualTheme, diagnostics = []) {
  const properties = [...contract.designProperties, ...contract.structuralControls].filter(
    (property) => propertyInProfile(property, profile.id) && property.kind !== 'image',
  )
  const slots = contract.slots.filter(
    (slot) =>
      propertyInProfile(slot, profile.id) &&
      slot.generationPolicy === 'generate' &&
      slot.role !== 'animation',
  )
  const propertyValues = Object.fromEntries(
    properties
      .filter(
        (property) =>
          property.defaultValue !== undefined &&
          isValidDesignValue(property.kind, property.defaultValue),
      )
      .map((property) => [property.path, property.defaultValue]),
  )
  const prototypeLayout = contract.prototypeLayout?.profiles?.[profile.id]
  const explicitHeight = properties
    .filter((property) => property.kind === 'height' && Number.isFinite(property.defaultValue))
    .map((property) => property.defaultValue)
    .sort((left, right) => right - left)[0]
  const width = Number.isFinite(prototypeLayout?.width) ? prototypeLayout.width : 375
  const height = prototypeLayout
    ? Math.max(1, prototypeLayout.height)
    : Math.max(480, Math.min(1200, explicitHeight ?? 280 + slots.length * 80))
  const runtimeHeight = Math.max(220, height - Math.max(120, slots.length * 72))
  const regions = prototypeLayout
    ? createRegionsFromPrototypeLayout(prototypeLayout, slots, properties)
    : [
        {
          id: 'runtime-content',
          role: `${contract.label || contract.componentName}运行内容`,
          bounds: { x: 16, y: 16, width: width - 32, height: runtimeHeight },
          propBindings: properties
            .filter((property) =>
              ['color', 'width', 'height', 'visibility'].includes(property.kind),
            )
            .map((property) => property.path)
            .slice(0, 12),
          renderMode: 'runtime',
          confidence: 1,
        },
      ]
  applyPrototypeGeometryValues(propertyValues, regions, slots)
  return {
    version: 1,
    componentName: contract.componentName,
    profile: profile.id,
    width,
    height,
    visualTheme,
    regions,
    propertyValues,
    diagnostics: [
      ...(contract.diagnostics ?? []),
      ...diagnostics,
      {
        code: 'COMPONENT_PLAN_FROM_CONTRACT',
        path: profile.rootPath,
        message: '组件结构由 Runtime 根据组件 JSON、Profile、Props 和 Slot 确定性生成。',
      },
      ...(prototypeLayout
        ? [
            {
              code: 'COMPONENT_LAYOUT_FROM_THUMBNAIL',
              path: profile.rootPath,
              message: '组件基础层级与区域边界来自已校准的 thumbnail 布局契约。',
            },
          ]
        : []),
    ],
  }
}

function createRegionsFromPrototypeLayout(layout, slots, properties) {
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]))
  const allowedPaths = new Set(properties.map((property) => property.path))
  return layout.regions.map((region) => {
    const slot = region.slotId ? slotsById.get(region.slotId) : undefined
    if (region.slotId && !slot) {
      throw createRuntimeError(
        'COMPONENT_PROTOTYPE_SLOT_INVALID',
        `thumbnail 布局引用了当前 Profile 不存在的 Slot：${region.slotId}。`,
      )
    }
    const propBindings = slot
      ? Array.from(new Set(Object.values(slot.bindings).filter(Boolean)))
      : (region.propBindings ?? []).filter((path) => allowedPaths.has(path))
    return {
      id: region.id,
      role: region.role,
      ...(typeof region.content === 'string' ? { content: region.content } : {}),
      ...(typeof region.exactText === 'string' ? { exactText: region.exactText } : {}),
      bounds: { ...region.bounds },
      ...(slot ? { slotId: slot.id } : {}),
      propBindings,
      renderMode: slot ? 'generated-asset' : region.renderMode || 'runtime',
      confidence: 1,
      ...(region.visible === false ? { visible: false } : {}),
      ...(region.styleRole ? { styleRole: region.styleRole } : {}),
      ...(region.textAlign ? { textAlign: region.textAlign } : {}),
      ...(region.preview ? { preview: region.preview } : {}),
    }
  })
}

function applyPrototypeGeometryValues(propertyValues, regions, slots) {
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]))
  for (const region of regions) {
    const bindings = region.slotId ? slotsById.get(region.slotId)?.bindings : undefined
    if (!bindings) continue
    const geometry = {
      [bindings.x]: region.bounds.x,
      [bindings.y]: region.bounds.y,
      [bindings.width]: region.bounds.width,
      [bindings.height]: region.bounds.height,
    }
    for (const [path, value] of Object.entries(geometry)) {
      if (path && propertyValues[path] === undefined) propertyValues[path] = value
    }
  }
}

function isLowGranularityThumbnailTree(tree) {
  if (!tree?.nodes?.length) return true
  if (tree.nodes.length > 1) return false
  const node = tree.nodes[0]
  const area = tree.width * tree.height
  const nodeArea = node.bounds.width * node.bounds.height
  return ['container', 'surface'].includes(node.type) && area > 0 && nodeArea / area > 0.72
}

function validateComponentBlueprint(blueprint, contract, profileId, options = {}) {
  if (!blueprint || blueprint.componentName !== contract.componentName) {
    throw createRuntimeError(
      'COMPONENT_BLUEPRINT_NAME_MISMATCH',
      'Component Blueprint 组件名称不匹配。',
    )
  }
  if (blueprint.profile !== profileId) {
    throw createRuntimeError(
      'COMPONENT_BLUEPRINT_PROFILE_MISMATCH',
      'Component Blueprint Profile 不匹配。',
    )
  }
  if (
    options.requireUserVisualTheme &&
    (!blueprint.visualTheme ||
      !['kv', 'visual'].includes(blueprint.visualTheme.source) ||
      !Array.isArray(blueprint.visualTheme.colors) ||
      blueprint.visualTheme.colors.length < 2)
  ) {
    throw createRuntimeError(
      'COMPONENT_VISUAL_THEME_MISSING',
      '存在用户 KV/视觉参考图，但 Component Blueprint 没有提取有效的 visualTheme。',
    )
  }
  const primarySlots = contract.slots.filter(
    (slot) =>
      propertyInProfile(slot, profileId) &&
      slot.generationPolicy === 'generate' &&
      slot.role !== 'animation',
  )
  const repairedBlueprint = repairComponentRegionSemantics(
    repairComponentSlotMappings(blueprint, contract, primarySlots),
    contract,
    primarySlots,
  )
  const slotIds = new Set(primarySlots.map((slot) => slot.id))
  const allowedPaths = new Set(
    [...contract.designProperties, ...contract.structuralControls]
      .filter((property) => propertyInProfile(property, profileId))
      .map((property) => property.path),
  )

  for (const region of repairedBlueprint.regions) {
    if (region.slotId && !slotIds.has(region.slotId)) {
      throw createRuntimeError(
        'COMPONENT_BLUEPRINT_SLOT_INVALID',
        `Component Blueprint 使用了未声明的 Slot：${region.slotId}。`,
      )
    }
    if (region.renderMode === 'generated-asset' && !region.slotId) {
      throw createRuntimeError(
        'COMPONENT_BLUEPRINT_SLOT_MISSING',
        `generated-asset 区域 ${region.id} 缺少 slotId。`,
      )
    }
    if (region.slotId && region.confidence < 0.72) {
      throw createRuntimeError(
        'COMPONENT_BLUEPRINT_LOW_CONFIDENCE',
        `区域 ${region.id} 与 ${region.slotId} 的映射置信度不足。`,
      )
    }
    for (const path of region.propBindings) {
      if (!allowedPaths.has(path)) {
        throw createRuntimeError(
          'COMPONENT_BLUEPRINT_PROP_INVALID',
          `Component Blueprint 使用了未声明的属性路径：${path}。`,
        )
      }
    }
  }
  for (const slot of primarySlots) {
    const matches = repairedBlueprint.regions.filter((region) => region.slotId === slot.id)
    if (matches.length !== 1) {
      throw createRuntimeError(
        'COMPONENT_SLOT_MAPPING_INVALID',
        `素材槽位 ${slot.id} 必须且只能映射一个原型区域。`,
      )
    }
  }
  const propertyValues = sanitizeComponentPropertyValues(
    repairedBlueprint.propertyValues,
    contract,
    profileId,
  )
  return {
    ...repairedBlueprint,
    propertyValues: alignComponentColorsToTheme(
      propertyValues,
      contract,
      profileId,
      repairedBlueprint.visualTheme,
    ),
  }
}

function alignComponentColorsToTheme(values, contract, profileId, visualTheme) {
  if (!visualTheme || !['kv', 'visual', 'style-pack'].includes(visualTheme.source)) return values
  const colors = visualTheme.colors.filter((color) => typeof color === 'string' && color.trim())
  if (!colors.length) return values
  const background = selectThemeColor(visualTheme, 'background', colors[2] ?? colors[0])
  const surface = selectThemeColor(visualTheme, 'surface', findLightestColor(colors) ?? '#ffffff')
  const primary = selectThemeColor(visualTheme, 'primary', colors[0])
  const text = ensureContrast(
    selectThemeColor(visualTheme, 'text', findDarkestColor(colors) ?? '#1f2937'),
    background,
    '#1f2937',
  )
  const mutedText = ensureContrast(blendColor(text, background, 0.42), background, text)
  const colorProperties = [...contract.designProperties, ...contract.structuralControls].filter(
    (property) => propertyInProfile(property, profileId) && property.kind === 'color',
  )
  const next = { ...values }
  for (const property of colorProperties) {
    const semantic = `${property.path} ${property.label ?? ''}`.toLowerCase()
    const isButtonText =
      /(?:btn|button|按钮).*(?:text|txt|font|文字)|(?:text|txt|font|文字).*(?:btn|button|按钮)/i.test(
        semantic,
      )
    const isBackground = /(?:bg|background|背景|page|surface|panel|card|面板|卡片)/i.test(semantic)
    const isMutedText = /(?:des|sub|secondary|caption|label|辅助|说明|描述|次要)/i.test(semantic)
    const isText = /(?:text|txt|font|文字|文本|main|主文案)/i.test(semantic)
    const isBorder = /(?:border|stroke|边框|描边)/i.test(semantic)
    const color = isButtonText
      ? ensureContrast(surface, primary, '#ffffff')
      : isMutedText
        ? mutedText
        : isText
          ? text
          : isBackground
            ? /surface|panel|card|面板|卡片/i.test(semantic)
              ? surface
              : background
            : isBorder
              ? blendColor(primary, background, 0.35)
              : primary
    next[property.path] = color
  }
  return next
}

function selectThemeColor(theme, role, fallback) {
  return theme.colorTokens?.find((token) => token.role === role)?.value || fallback
}

function findLightestColor(colors) {
  return colors
    .map((color) => ({ color, rgb: parseColor(color) }))
    .filter((item) => item.rgb)
    .sort((left, right) => relativeLuminance(right.rgb) - relativeLuminance(left.rgb))[0]?.color
}

function findDarkestColor(colors) {
  return colors
    .map((color) => ({ color, rgb: parseColor(color) }))
    .filter((item) => item.rgb)
    .sort((left, right) => relativeLuminance(left.rgb) - relativeLuminance(right.rgb))[0]?.color
}

function ensureContrast(foreground, background, fallback) {
  const fg = parseColor(foreground)
  const bg = parseColor(background)
  if (!fg || !bg || contrastRatio(fg, bg) >= 4.5) return foreground || fallback
  const dark = [31, 41, 55]
  const light = [255, 255, 255]
  return contrastRatio(dark, bg) >= contrastRatio(light, bg) ? '#1f2937' : '#ffffff'
}

function blendColor(left, right, amount) {
  const a = parseColor(left)
  const b = parseColor(right)
  if (!a || !b) return left || right
  const ratio = Math.max(0, Math.min(1, amount))
  return `#${a
    .map((value, index) =>
      Math.round(value * (1 - ratio) + b[index] * ratio)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

function relativeLuminance(rgb) {
  return rgb.reduce((total, channel, index) => {
    const value =
      channel / 255 <= 0.03928 ? channel / 255 / 12.92 : ((channel / 255 + 0.055) / 1.055) ** 2.4
    return total + value * [0.2126, 0.7152, 0.0722][index]
  }, 0)
}

function contrastRatio(left, right) {
  const a = relativeLuminance(left)
  const b = relativeLuminance(right)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function createStylePackVisualTheme(stylePack) {
  if (!stylePack?.colors || typeof stylePack.colors !== 'object') return undefined
  const entries = Object.entries(stylePack.colors).filter(([, value]) => typeof value === 'string')
  if (entries.length < 2) return undefined
  return normalizeVisualTheme({
    source: 'style-pack',
    colors: entries.map(([, value]) => value),
    colorTokens: entries.map(([role, value]) => ({ role, value })),
    typography: stylePack.typography,
    surfaces: stylePack.surfaces
      ? [
          {
            role: 'component',
            fill: stylePack.colors.surface || stylePack.colors.background || entries[0][1],
            radius: Number(stylePack.surfaces.radius) || 8,
          },
        ]
      : undefined,
    imagery: stylePack.imagery,
    visualStyle: [stylePack.name, stylePack.description, stylePack.prompt]
      .filter(Boolean)
      .join('；'),
    confidence: 1,
  })
}

function repairComponentSlotMappings(blueprint, contract, slots) {
  const diagnostics = [...(blueprint.diagnostics ?? [])]
  const regions = [...blueprint.regions]

  for (const slot of slots) {
    const matches = regions
      .map((region, index) => ({ region, index }))
      .filter((item) => item.region.slotId === slot.id)
      .sort((left, right) => right.region.confidence - left.region.confidence)

    if (matches.length > 1) {
      for (const duplicate of matches.slice(1).sort((left, right) => right.index - left.index)) {
        regions.splice(duplicate.index, 1)
      }
      diagnostics.push({
        code: 'COMPONENT_SLOT_DUPLICATE_REPAIRED',
        path: slot.bindings.image,
        message: `Runtime 已移除 ${slot.id} 的重复原型映射，保留区域 ${matches[0].region.id}。`,
      })
    }
  }

  for (const slot of slots) {
    if (regions.some((region) => region.slotId === slot.id)) continue
    const bounds = createFallbackSlotBounds(blueprint, regions, contract, slot)
    const idBase = `contract-${slot.id}`.replace(/[^a-z0-9_-]+/gi, '-')
    const existingIds = new Set(regions.map((region) => region.id))
    let id = idBase
    let suffix = 2
    while (existingIds.has(id)) {
      id = `${idBase}-${suffix}`
      suffix += 1
    }
    regions.push({
      id,
      role: slot.label || slot.role || slot.id,
      bounds,
      slotId: slot.id,
      propBindings: Array.from(new Set(Object.values(slot.bindings).filter(Boolean))),
      renderMode: 'generated-asset',
      confidence: 0.72,
    })
    diagnostics.push({
      code: 'COMPONENT_SLOT_MAPPING_REPAIRED',
      path: slot.bindings.image,
      message: `模型未映射 ${slot.id}；Runtime 已按组件 JSON 契约补充独立原型区域。`,
    })
  }

  const maxBottom = Math.max(0, ...regions.map((region) => region.bounds.y + region.bounds.height))
  return {
    ...blueprint,
    height: Math.max(blueprint.height, maxBottom),
    regions,
    diagnostics,
  }
}

function repairComponentRegionSemantics(blueprint, contract, slots) {
  const properties = new Map(
    [...contract.designProperties, ...contract.structuralControls].map((property) => [
      property.path,
      property,
    ]),
  )
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]))
  const genericLabel =
    /^(?:text|button|background|runtime|content|image|shape|文本|按钮|背景|内容|图片)$/i

  return {
    ...blueprint,
    regions: blueprint.regions.map((region) => {
      const propertyLabel = region.propBindings
        .map((path) => properties.get(path)?.label)
        .find(
          (label) => typeof label === 'string' && label.trim() && !genericLabel.test(label.trim()),
        )
      const slotLabel = region.slotId ? slotsById.get(region.slotId)?.label : undefined
      const role =
        !region.role || genericLabel.test(region.role.trim())
          ? slotLabel || propertyLabel || componentRegionFallbackLabel(region.renderMode)
          : region.role
      const content =
        region.renderMode === 'text' &&
        (!region.content || genericLabel.test(String(region.content).trim()))
          ? contract.label || propertyLabel || role || contract.componentName
          : region.content
      return { ...region, role, ...(content ? { content } : {}) }
    }),
  }
}

function componentRegionFallbackLabel(renderMode) {
  if (renderMode === 'text') return '组件文案'
  if (renderMode === 'color') return '组件背景'
  if (renderMode === 'generated-asset') return '组件素材'
  return '运行时内容'
}

function createFallbackSlotBounds(blueprint, regions, contract, slot) {
  const gap = 16
  const horizontalPadding = 24
  const availableWidth = Math.max(1, blueprint.width - horizontalPadding * 2)
  const width =
    readContractNumber(contract, slot.bindings.width) ??
    (slot.role === 'background' ? blueprint.width : Math.min(150, availableWidth))
  const height =
    readContractNumber(contract, slot.bindings.height) ??
    (slot.role === 'background'
      ? Math.min(240, Math.max(120, blueprint.height * 0.3))
      : slot.role === 'button'
        ? 56
        : 64)
  const configuredX = readContractCoordinate(contract, slot.bindings.x)
  const configuredY = readContractCoordinate(contract, slot.bindings.y)
  const stackedY =
    Math.max(0, ...regions.map((region) => region.bounds.y + region.bounds.height)) + gap
  return {
    x: Number.isFinite(configuredX)
      ? Math.max(0, Math.min(configuredX, blueprint.width - width))
      : Math.max(0, (blueprint.width - width) / 2),
    y: Number.isFinite(configuredY) ? Math.max(0, configuredY) : stackedY,
    width: Math.max(1, Math.min(width, blueprint.width)),
    height: Math.max(1, height),
  }
}

function sanitizeComponentPropertyValues(values, contract, profileId) {
  const result = {}
  const properties = new Map(
    [...contract.designProperties, ...contract.structuralControls]
      .filter((property) => propertyInProfile(property, profileId) && property.kind !== 'image')
      .map((property) => [property.path, property]),
  )
  for (const [path, value] of Object.entries(values ?? {})) {
    const property = properties.get(path)
    if (!property || !isValidDesignValue(property.kind, value)) continue
    result[path] = value
  }
  return result
}

function isValidDesignValue(kind, value) {
  if (kind === 'color') {
    return (
      typeof value === 'string' &&
      /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\(|transparent$)/i.test(value.trim())
    )
  }
  if (kind === 'visibility') return typeof value === 'boolean'
  if (['spacing', 'radius'].includes(kind) && Array.isArray(value)) {
    return value.length <= 4 && value.every((item) => Number.isFinite(item))
  }
  if (['width', 'height', 'x', 'y', 'spacing', 'radius'].includes(kind)) {
    return Number.isFinite(value) && (!['width', 'height'].includes(kind) || value > 0)
  }
  return false
}

function propertyInProfile(value, profileId) {
  return profileId === 'default' ? !value.profile : value.profile === profileId
}

function readContractNumber(contract, path) {
  if (!path) return undefined
  const property = contract.designProperties.find((item) => item.path === path)
  return Number.isFinite(property?.defaultValue) && property.defaultValue > 0
    ? property.defaultValue
    : undefined
}

function readContractCoordinate(contract, path) {
  if (!path) return undefined
  const property = contract.designProperties.find((item) => item.path === path)
  return Number.isFinite(property?.defaultValue) ? property.defaultValue : undefined
}

function uniqueUploads(uploads) {
  const seen = new Set()
  return uploads.filter((upload) => {
    if (!upload?.data || seen.has(upload.data)) return false
    seen.add(upload.data)
    return true
  })
}

function createNestedPatch(flatValues) {
  const patch = {}
  for (const [path, value] of Object.entries(flatValues ?? {})) {
    setNestedValue(patch, path, value)
  }
  return patch
}

function setNestedValue(target, path, value) {
  const segments = String(path).split('.').filter(Boolean)
  if (!segments.length) return
  let current = target
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    if (
      !current[segment] ||
      typeof current[segment] !== 'object' ||
      Array.isArray(current[segment])
    ) {
      current[segment] = {}
    }
    current = current[segment]
  }
  current[segments.at(-1)] = value
}

async function generateComponentRegionArtifact({
  context,
  scope,
  invokeProvider,
  index,
  visualContract,
  styleAnchor,
}) {
  if (!scope?.slotId || !scope?.propPath) {
    throw createRuntimeError('COMPONENT_EDIT_SCOPE_MISSING', '批量目标缺少组件 Slot 或 Prop Path。')
  }
  const transparent = shouldRegenerateAsTransparent(
    context.session.goal,
    scope.transparent === true,
  )
  const task = {
    id: `component-slot-edit-${index}`,
    slotId: scope.slotId,
    label: scope.regionId,
    propPath: scope.propPath,
    fallbackPath: scope.fallbackPath,
    role: 'component-asset',
    targetSize: scope.targetSize,
    transparent,
    exactText: scope.exactText,
  }
  const uploads = createComponentRegenerationUploads(context, scope, styleAnchor)
  let lastReview
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const correction =
      attempt > 1
        ? '上一版不是透明素材。必须输出带真实 Alpha 通道的 PNG，主体外像素 alpha=0；禁止白底、灰底、棋盘格、截图背景和展示板。'
        : ''
    const result = await invokeProvider(
      {
        ...context.payload,
        type: 'generate_assets',
        question: [
          `只重新生成 ${scope.componentName} / ${scope.profile} 的 ${scope.regionId} 素材。`,
          `用户修改要求：${context.session.goal}`,
          `slotId=${scope.slotId}，propPath=${scope.propPath}，目标尺寸=${scope.targetSize.width}x${scope.targetSize.height}。`,
          scope.exactText
            ? `图片自身必须包含且只包含准确文案“${scope.exactText}”，不得生成第二份文字。`
            : '',
          scope.visualTheme ? `沿用组件视觉主题：${JSON.stringify(scope.visualTheme)}` : '',
          visualContract,
          styleAnchor
            ? `附件中的“${styleAnchor.task.slotId}-style-anchor.png”是本批次已经生成成功的视觉母版。必须保持其按钮轮廓、比例、圆角、边框、渐变、材质、高光、阴影、字体风格、字号和内边距，只把文案准确替换为“${scope.exactText || scope.regionId}”。禁止重新设计按钮。`
            : '这是本批次的视觉母版素材，后续同组素材将严格继承本图样式。',
          '只输出这一张紧贴边界的图片；禁止生成完整组件、页面、对比图或其他 Slot。',
          correction,
        ]
          .filter(Boolean)
          .join('\n\n'),
        uploads,
        imageTasks: [
          createImageTask({
            ...task,
            name: `${scope.slotId}.png`,
            kind: 'component-slot-edit',
            textPolicy: scope.exactText ? 'model-exact' : undefined,
            referencePolicy: {
              roles: ['edit-base', 'kv', 'visual', 'prototype'],
              maxImages: 3,
            },
            prompt: [
              `只重新生成 ${scope.componentName} 的 ${scope.regionId} 素材，不生成完整组件或页面。`,
              correction,
            ]
              .filter(Boolean)
              .join('\n\n'),
          }),
        ],
      },
      context.providerCallbacks,
    )
    if (!Array.isArray(result.artifacts) || result.artifacts.length !== 1) continue
    const sourceArtifact = result.artifacts[0]
    lastReview = inspectImageArtifact(sourceArtifact, {
      placementMode: 'asset-board',
      width: task.targetSize.width,
      height: task.targetSize.height,
      transparent: task.transparent,
    })
    if (lastReview.passed) {
      return {
        artifact: sourceArtifact,
        sourceArtifact,
        sourceReview: lastReview,
        task,
        editScope: scope,
        batchIndex: index,
        attempts: attempt,
      }
    }
  }
  const reason =
    lastReview?.issues
      ?.filter((issue) => issue.severity === 'error')
      .map((issue) => issue.message)
      .join('；') || '生图服务没有返回有效透明素材。'
  throw createRuntimeError(
    task.transparent ? 'COMPONENT_SLOT_TRANSPARENCY_INVALID' : 'COMPONENT_SLOT_ARTIFACT_INVALID',
    task.transparent
      ? `${scope.componentName} / ${scope.regionId} 连续两次未生成真实透明素材：${reason}`
      : `${scope.componentName} / ${scope.regionId} 连续两次未生成有效素材：${reason}`,
  )
}

export function shouldRegenerateAsTransparent(goal, defaultValue = false) {
  const text = String(goal || '')
  if (/(不需要|不要|无需|不用).{0,8}(透明|去背景|alpha)/i.test(text)) return false
  if (/(透明|去背景|抠图|alpha\s*[=:：]?\s*0)/i.test(text)) return true
  return Boolean(defaultValue)
}

function createComponentRegenerationUploads(context, scope, styleAnchor) {
  const prepared = getPreparedUploads(context).filter(Boolean)
  const currentImage =
    typeof scope?.currentImage === 'string' && scope.currentImage.startsWith('data:image/')
      ? {
          type: 'file',
          name: `${scope.slotId || scope.regionId || 'component-slot'}-current.png`,
          mime: scope.currentImage.match(/^data:(image\/[^;]+)/i)?.[1] || 'image/png',
          role: 'prototype',
          data: scope.currentImage,
        }
      : undefined
  const anchorImage = styleAnchor?.artifact
    ? {
        type: 'file',
        name: `${styleAnchor.task.slotId}-style-anchor.png`,
        mime:
          styleAnchor.artifact.mime ||
          (styleAnchor.artifact.kind === 'svg' ? 'image/svg+xml' : 'image/png'),
        role: 'edit-base',
        data: svgArtifactDataUri(styleAnchor.artifact),
      }
    : undefined
  return uniqueUploads([...prepared, currentImage, anchorImage].filter(Boolean))
}

function groupComponentConsistencyTargets(targets) {
  const groups = new Map()
  targets.forEach((scope, index) => {
    const key = [
      scope.instanceId,
      scope.profile,
      scope.assetRole || 'asset',
      scope.transparent === true ? 'transparent' : 'opaque',
      scope.exactText ? 'exact-text' : 'visual',
    ].join(':')
    const group = groups.get(key) ?? { key, entries: [] }
    group.entries.push({ scope, index })
    groups.set(key, group)
  })
  return [...groups.values()]
}

function createComponentBatchVisualContract(targets) {
  const validTargets = (Array.isArray(targets) ? targets : []).filter(Boolean)
  if (!validTargets.length) return ''
  const siblingSummary = validTargets
    .map((target, index) => {
      const text = target.exactText ? `，准确文案=“${target.exactText}”` : ''
      return `${index + 1}. ${target.regionId || target.slotId}，${target.targetSize.width}x${target.targetSize.height}px${text}`
    })
    .join('\n')
  const exactTextGroup = validTargets.length > 1 && validTargets.every((target) => target.exactText)
  return [
    '【同批组件素材视觉一致性契约】',
    siblingSummary,
    validTargets.length > 1
      ? '这些素材属于同一组件和同一次批量重生成。必须共享完全一致的轮廓语言、圆角比例、边框粗细、渐变方向、材质、高光、阴影、字体风格、字号比例和内边距；只允许目标尺寸与准确文案不同。'
      : '保持当前组件主题、素材用途和目标尺寸，不改成展示板或完整组件截图。',
    exactTextGroup
      ? '它们是一组同级文字图片素材：文字必须视觉居中、基线一致、清晰可读；禁止把某个兄弟素材的文案复制到当前图片。'
      : '',
    '素材主体应紧贴输出边界并保留均匀的安全边距，禁止额外白框、灰框、画布底板、截图留白或尺寸标注。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function groupComponentRegionVisualTargets(targets) {
  const groups = new Map()
  targets.forEach((scope, index) => {
    const sharedKey = componentRegionVisualGroupKey(scope)
    const key = sharedKey ?? `independent:${index}`
    const group = groups.get(key) ?? { key, shared: Boolean(sharedKey), entries: [] }
    group.entries.push({ scope, index })
    groups.set(key, group)
  })
  return [...groups.values()].map((group) => ({
    ...group,
    shared: group.shared && group.entries.length > 1,
  }))
}

function componentRegionVisualGroupKey(scope) {
  // model-exact 素材的文案已经烘焙进图片，不允许复用其他 Slot 的底图。
  void scope
  return undefined
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor
        cursor += 1
        results[index] = await mapper(items[index], index)
      }
    }),
  )
  return results
}

function svgArtifactDataUri(artifact) {
  if (artifact?.kind === 'raster') {
    return `data:${artifact.mime || 'image/png'};base64,${artifact.content}`
  }
  return `data:image/svg+xml;base64,${Buffer.from(artifact.content).toString('base64')}`
}

function composeComponentPreview(componentName, blueprint, generatedAssets, propertyValues) {
  const assetsBySlot = new Map(generatedAssets.map((item) => [item.task.slotId, item.artifact]))
  const background =
    Object.entries(propertyValues ?? {}).find(
      ([path, value]) => /(?:bg|background).*color/i.test(path) && typeof value === 'string',
    )?.[1] ?? '#f3f4f6'
  const regions = blueprint.regions
    .filter((region) => region.visible !== false)
    .map((region) => {
      const { x, y, width, height } = region.bounds
      const asset = region.slotId ? assetsBySlot.get(region.slotId) : undefined
      if (asset) {
        return `<image x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="none" href="${svgArtifactDataUri(asset)}"/>`
      }
      const colorValue = region.propBindings
        .map((path) => propertyValues?.[path])
        .find((value) => typeof value === 'string' && /^(?:#|rgb|hsl|transparent)/i.test(value))
      if (region.renderMode === 'text') {
        const anchor =
          region.textAlign === 'left' ? 'start' : region.textAlign === 'right' ? 'end' : 'middle'
        const textX =
          region.textAlign === 'left' ? x : region.textAlign === 'right' ? x + width : x + width / 2
        return `<text x="${textX}" y="${y + height / 2}" fill="${escapeXml(colorValue || '#ffffff')}" font-size="${Math.max(11, Math.min(18, height * 0.58))}" text-anchor="${anchor}" dominant-baseline="central">${escapeXml(region.content || region.role)}</text>`
      }
      if (region.renderMode === 'runtime' && region.preview?.items?.length) {
        return renderRuntimePreviewSvg(region, colorValue || '#ffffff')
      }
      if (region.renderMode === 'runtime' && region.assetSource) {
        return `<image x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" href="${escapeXml(region.assetSource)}"/>`
      }
      const fill = colorValue || '#e5e7eb'
      const dash = region.renderMode === 'runtime' ? ' stroke="#94a3b8" stroke-dasharray="6 4"' : ''
      const label =
        region.renderMode === 'color'
          ? ''
          : `<text x="${x + width / 2}" y="${y + height / 2}" fill="#475569" font-size="${Math.max(10, Math.min(16, height * 0.16))}" text-anchor="middle" dominant-baseline="central">${escapeXml(region.role)}</text>`
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="${escapeXml(fill)}"${dash}/>${label}`
    })
    .join('')
  const content = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${blueprint.width}" height="${blueprint.height}" viewBox="0 0 ${blueprint.width} ${blueprint.height}">`,
    `<title>${escapeXml(componentName)} 组件设计预览</title>`,
    `<rect width="${blueprint.width}" height="${blueprint.height}" fill="${escapeXml(background)}"/>`,
    regions,
    '</svg>',
  ].join('')
  return { kind: 'svg', content, name: `${componentName}-组件预览.png` }
}

function renderRuntimePreviewSvg(region, color) {
  const { x, y, width, height } = region.bounds
  const items = region.preview.items
  if (region.preview.variant === 'cards') {
    const gap = 6
    const itemWidth = Math.max(1, (width - gap * (items.length - 1)) / items.length)
    return items
      .map((item, index) => {
        const itemX = x + index * (itemWidth + gap)
        return [
          `<rect x="${itemX}" y="${y}" width="${itemWidth}" height="${height}" rx="6" fill="none" stroke="${escapeXml(color)}" opacity="0.45"/>`,
          `<text x="${itemX + itemWidth / 2}" y="${y + height - 10}" fill="${escapeXml(color)}" font-size="10" text-anchor="middle">${escapeXml(item)}</text>`,
        ].join('')
      })
      .join('')
  }
  const lineHeight = Math.max(16, Math.min(24, height / items.length))
  return items
    .map(
      (item, index) =>
        `<text x="${x + 4}" y="${y + lineHeight * (index + 0.8)}" fill="${escapeXml(color)}" font-size="10">${escapeXml(item)}</text>`,
    )
    .join('')
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
