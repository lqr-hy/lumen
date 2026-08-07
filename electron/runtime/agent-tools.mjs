import { createRuntimeError } from './providers.mjs'
import { validateComponentRuntime } from './component-runtime-adapters.mjs'
import {
  createPageCompositionBlueprint,
  validatePageCompositionBlueprint,
} from './page-composition.mjs'
import { reviewPageVision } from './vision-review.mjs'

export function createAgentToolRegistry({
  invokeProvider,
  executeSkillTool,
  loadComponentFromPrompt,
  loadComponentsFromPrompt,
}) {
  const tools = new Map()

  registerTool(tools, 'reference.prepare', async (context) => {
    const references = context.session.references.filter((reference) => reference.data.startsWith('data:image/'))
    return {
      summary: references.length
        ? `已准备 ${references.length} 张参考图。`
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

  registerTool(tools, 'design.blueprint', async (context) => {
    const uploads = getPreparedUploads(context)
    const placementMode = context.session.canvasTarget?.placementMode ?? 'new-artboard'
    if (context.session.blueprint && isContinuationPrompt(context.payload.question)) {
      return {
        summary: `已复用当前设计结构，共 ${context.session.blueprint.sections.length} 个模块。`,
        data: { blueprint: context.session.blueprint },
      }
    }
    const question = [
      '先规划设计稿结构，不要生成最终图片。',
      `任务目标：${context.session.goal}`,
      `放置模式：${placementMode}`,
      context.session.canvasTarget
        ? `目标逻辑尺寸：${context.session.canvasTarget.width} x ${context.session.canvasTarget.height}px，高度可按内容估算。`
        : '',
      describeReferences(uploads),
      '原型图存在时，它是模块、顺序和结构的唯一来源；KV 只提供视觉风格，不得增加原型中没有的业务模块。',
    ].filter(Boolean).join('\n\n')
    const result = await invokeProvider({
      ...context.payload,
      type: 'generate_blueprint',
      question,
      uploads,
    }, context.providerCallbacks)
    if (!result.blueprint) {
      throw createRuntimeError('AGENT_BLUEPRINT_MISSING', '设计规划工具没有返回 Blueprint。')
    }
    if (result.blueprint.mode !== placementMode) {
      throw createRuntimeError(
        'AGENT_BLUEPRINT_MODE_MISMATCH',
        `Design Blueprint 模式为 ${result.blueprint.mode}，与目标模式 ${placementMode} 不一致。`,
      )
    }
    context.session.blueprint = result.blueprint
    return {
      summary: `设计结构规划完成，共 ${result.blueprint.sections.length} 个模块。`,
      data: { blueprint: result.blueprint },
    }
  })

  registerTool(tools, 'design.generate', async (context) => {
    const uploads = getPreparedUploads(context)
    const blueprint = context.memory.get('design.blueprint')?.data?.blueprint
    const question = buildDesignQuestion(context, blueprint)
    const result = await invokeProvider({
      ...context.payload,
      type: 'generate_image',
      question,
      uploads,
      imageTasks: [createImageTask({
        id: 'design-image',
        name: 'AI 生成设计图.png',
        targetSize: context.session.canvasTarget,
        transparent: false,
        prompt: question,
      })],
    }, context.providerCallbacks)
    if (!result.artifact) {
      throw createRuntimeError('AGENT_ARTIFACT_MISSING', '图片生成工具没有返回制品。')
    }
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
    const blueprint = context.memory.get('design.blueprint')?.data?.blueprint
    const issueText = reviewed.review.issues
      .map((issue) => `- [${issue.code}] ${issue.message}`)
      .join('\n')
    const question = [
      buildDesignQuestion(context, blueprint),
      '上一版没有通过 Runtime 质量审查。请重新生成完整 SVG，不要只解释问题。',
      `必须修正的问题：\n${issueText}`,
    ].join('\n\n')
    const result = await invokeProvider({
      ...context.payload,
      type: 'generate_image',
      question,
      uploads,
      imageTasks: [createImageTask({
        id: 'design-image-refined',
        name: 'AI 生成设计图.png',
        targetSize: context.session.canvasTarget,
        transparent: false,
        prompt: question,
      })],
    }, context.providerCallbacks)
    if (!result.artifact) {
      throw createRuntimeError('AGENT_ARTIFACT_MISSING', '自动修正没有返回设计制品。')
    }
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
      .map((upload, index) => `图片 ${index + 1}：${upload.name}，角色=${referenceRoleLabel(upload.role)}`)
      .join('\n')
    const question = [
      '生成一组互相独立、可分别下载的局部设计素材。',
      `任务目标：${context.session.goal}`,
      roleDescription ? `参考图：\n${roleDescription}` : '',
      '每个按钮、背景或装饰必须是单独文件；禁止把多个目标拼在一张图中，禁止输出整页或整个组件截图。',
      '素材画布必须紧贴自身可见内容；按钮使用透明背景，并保留用户要求的准确文字。',
    ].filter(Boolean).join('\n\n')
    const result = await invokeProvider({
      ...context.payload,
      type: 'generate_assets',
      question,
      uploads,
    }, context.providerCallbacks)
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
    const loaded = await loadComponentFromPrompt(componentRequest)
    const contract = await executeSkillTool('component-design-assets.resolve-contract', {
      component: loaded.component,
      source: loaded.source,
    })
    const profile = selectComponentProfile(
      contract,
      `${componentRequest}\n${context.session.goal}`,
    )
    if (!profile) {
      throw createRuntimeError('COMPONENT_PROFILE_MISSING', `${contract.componentName} 没有可用的设计 Profile。`)
    }
    context.session.componentContext = {
      componentName: contract.componentName,
      profile: profile.id,
      sourceHash: contract.sourceHash,
      request: componentRequest,
    }
    return {
      summary: `已解析 ${contract.componentName}，使用 ${profile.id} Profile。`,
      data: { loaded, contract, profile },
    }
  })

  registerTool(tools, 'component.blueprint', async (context) => {
    const resolved = context.memory.get('component.resolve')?.data
    if (!resolved?.contract || !resolved?.profile) {
      throw createRuntimeError('COMPONENT_CONTRACT_MISSING', '缺少组件设计契约。')
    }
    const { contract, profile, loaded } = resolved
    const profileContract = createProfileContract(contract, profile.id)
    const uploads = uniqueUploads([
      loaded.thumbnailUpload,
      ...getPreparedUploads(context),
    ].filter(Boolean))
    const referenceContract = describeComponentReferences(uploads)
    const hasUserVisualReference = uploads.some((upload, index) => (
      index > 0 && upload.role !== 'prototype'
    ))
    const question = [
      `根据 thumbnail 为 ${contract.componentName} 生成结构化组件原型，不要生成最终设计图。`,
      `当前 Profile：${profile.id}。`,
      `任务目标：${context.session.goal}`,
      `当前 Profile 的设计契约：\n${JSON.stringify(profileContract, null, 2)}`,
      referenceContract,
      'thumbnail 只负责组件结构和区域边界，禁止继承 thumbnail 或组件默认值的配色。',
      hasUserVisualReference
        ? '用户 KV/视觉参考图是强制视觉来源：visualTheme 必须从该图提取主色、辅助色、明暗关系、材质和装饰语言；propertyValues 中所有 color 字段必须使用该色板，不得退回深蓝、青色等组件默认主题。'
        : '没有用户视觉参考时，visualTheme 可以根据任务文字或 thumbnail 建立。',
      '每个 generated-asset 区域必须绑定 Contract 中一个 slotId；每个 propBindings 必须是完整属性路径。',
      'text 区域必须提供 content，并使用 thumbnail 中可见文案或任务明确文案；role/content 禁止使用 text、button、background、runtime 等通用占位词。',
      'runtime 区域只描述动态业务内容范围，role 使用明确中文语义，不得绘制静态假数据。',
      'propertyValues 只建议颜色、宽高、位置、间距、圆角和显隐值，不得写图片、业务配置、事件或自定义控制器字段。',
      '画布逻辑宽度优先使用 375px，高度根据 thumbnail 比例和内容自然估算。',
    ].join('\n\n')
    const result = await invokeProvider({
      ...context.payload,
      type: 'generate_component_blueprint',
      question,
      uploads,
    }, context.providerCallbacks)
    const generatedBlueprint = validateComponentBlueprint(
      result.componentBlueprint,
      contract,
      profile.id,
      { requireUserVisualTheme: hasUserVisualReference },
    )
    const sharedTheme = context.session.pageVisualTheme
    const blueprint = sharedTheme
      ? {
          ...generatedBlueprint,
          visualTheme: sharedTheme,
          propertyValues: alignColorPropertiesToTheme(
            generatedBlueprint.propertyValues,
            sharedTheme.colors,
          ),
        }
      : generatedBlueprint
    context.session.componentBlueprint = blueprint
    return {
      summary: `组件原型包含 ${blueprint.regions.length} 个区域。`,
      data: { blueprint },
    }
  })

  registerTool(tools, 'component.plan-assets', async (context) => {
    const resolved = context.memory.get('component.resolve')?.data
    const blueprint = context.memory.get('component.blueprint')?.data?.blueprint
    if (!resolved?.contract || !resolved?.profile || !blueprint) {
      throw createRuntimeError('COMPONENT_BLUEPRINT_MISSING', '缺少组件原型或设计契约。')
    }
    const profileSlots = resolved.contract.slots.filter((slot) => (
      propertyInProfile(slot, resolved.profile.id) && slot.generationPolicy === 'generate'
    ))
    const skippedSlots = profileSlots.filter((slot) => slot.role === 'animation')
    const slots = profileSlots.filter((slot) => slot.role !== 'animation')
    const assetTasks = slots.map((slot, index) => {
      const region = blueprint.regions.find((item) => item.slotId === slot.id)
      if (!region) {
        throw createRuntimeError(
          'COMPONENT_SLOT_UNMAPPED',
          `Component Blueprint 没有映射素材槽位：${slot.id}。`,
        )
      }
      const width = readContractNumber(resolved.contract, slot.bindings.width) ?? region.bounds.width
      const height = readContractNumber(resolved.contract, slot.bindings.height) ?? region.bounds.height
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
        exactText: inferExactSlotText(slot),
      }
    })
    const propertyValues = sanitizeComponentPropertyValues(
      blueprint.propertyValues,
      resolved.contract,
      resolved.profile.id,
    )
    return {
      summary: assetTasks.length
        ? `已规划 ${assetTasks.length} 个独立素材任务。`
        : '当前 Profile 没有图片槽位，只生成 Props Patch 和组件预览。',
      data: { assetTasks, propertyValues, skippedSlots },
    }
  })

  registerTool(tools, 'component.generate-assets', async (context) => {
    const resolved = context.memory.get('component.resolve')?.data
    const blueprint = context.memory.get('component.blueprint')?.data?.blueprint
    const planned = context.memory.get('component.plan-assets')?.data
    if (!resolved || !blueprint || !planned) {
      throw createRuntimeError('COMPONENT_ASSET_PLAN_MISSING', '缺少组件素材计划。')
    }
    if (planned.assetTasks.length > 15) {
      throw createRuntimeError(
        'COMPONENT_ASSET_COUNT_LIMIT',
        '组件视觉外壳和独立素材总数不能超过 16 个。',
      )
    }
    const uploads = uniqueUploads([
      resolved.loaded.thumbnailUpload,
      ...getPreparedUploads(context),
    ].filter(Boolean))
    const referenceContract = describeComponentReferences(uploads)
    const slotTaskDescription = planned.assetTasks.map((task, index) => [
      `${index + 2}. ${task.id}`,
      `slotId=${task.slotId}`,
      `propPath=${task.propPath}`,
      `role=${task.role}`,
      `size=${task.targetSize.width}x${task.targetSize.height}`,
      `transparent=${task.transparent}`,
      task.exactText ? `按钮底图中不要绘制文字，Runtime 会确定性叠加文字“${task.exactText}”。` : '',
    ].filter(Boolean).join('，')).join('\n')
    const taskDescription = [
      `1. component-visual-shell，type=visual-shell，size=${blueprint.width}x${blueprint.height}，不绑定 Props`,
      slotTaskDescription,
    ].filter(Boolean).join('\n')
    const generationPayload = {
      ...context.payload,
      type: 'generate_assets',
      question: [
        `为 ${resolved.contract.componentName} 的 ${resolved.profile.id} Profile 生成独立设计素材。`,
        `任务列表：\n${taskDescription}`,
        referenceContract,
        blueprint.visualTheme
          ? `必须严格执行以下视觉主题契约：\n${JSON.stringify(blueprint.visualTheme, null, 2)}`
          : '',
        '素材顺序必须与任务列表完全一致，每项只生成一张紧贴内容边界的图片。',
        'visual-shell 是设计稿底层视觉外壳：必须覆盖完整组件画布，只绘制背景、容器、边框、光效和静态装饰；不得绘制按钮、准确文字、奖品/任务等运行内容或任何 Slot 素材。',
        'visual-shell 应使用透明或半透明装饰层，让 Props 颜色图层仍可见；独立 Slot 必须保持透明背景并紧贴自身边界。',
        '除 visual-shell 外，禁止把多个 Slot 拼成整组件截图；颜色、尺寸、位置、文字和业务内容不得生成额外图片。',
        'thumbnail 只负责组件语义和结构，禁止使用其默认配色。KV/视觉参考图负责最终配色、材质和装饰语言，并且其优先级高于组件 JSON 默认值。',
      ].join('\n\n'),
      uploads,
      imageTasks: [
        createImageTask({
          id: 'component-visual-shell',
          name: `${resolved.contract.componentName}-visual-shell.png`,
          targetSize: { width: blueprint.width, height: blueprint.height },
          transparent: true,
          prompt: `为 ${resolved.contract.componentName} 生成只包含背景、容器、边框、光效和静态装饰的视觉外壳。`,
        }),
        ...planned.assetTasks.map((task) => createImageTask({
          ...task,
          name: `${task.slotId}.png`,
          prompt: [
            `为 ${resolved.contract.componentName} 单独生成 ${task.label || task.slotId} 素材。`,
            `素材角色：${task.role}，绑定属性：${task.propPath}。`,
            task.exactText ? `不要绘制文字“${task.exactText}”，只生成无文字底图。` : '',
          ].filter(Boolean).join('\n'),
        })),
      ],
    }
    let result = await invokeProvider(generationPayload, context.providerCallbacks)
    let themeRepairCount = 0
    const expectedCount = planned.assetTasks.length + 1
    if (!Array.isArray(result.artifacts) || result.artifacts.length !== expectedCount) {
      throw createRuntimeError(
        'COMPONENT_ASSET_COUNT_MISMATCH',
        `组件需要 1 个视觉外壳和 ${planned.assetTasks.length} 个 Props 素材，但 Provider 返回 ${result.artifacts?.length ?? 0} 个。`,
      )
    }
    if (
      blueprint.visualTheme &&
      ['kv', 'visual'].includes(blueprint.visualTheme.source) &&
      !artifactMatchesVisualTheme(result.artifacts[0], blueprint.visualTheme.colors)
    ) {
      themeRepairCount = 1
      result = await invokeProvider({
        ...generationPayload,
        question: [
          generationPayload.question,
          '上一次 visual-shell 的实际颜色偏离 KV 视觉主题，本次必须修正。',
          `至少 60% 的主要 fill/stroke/stop-color 必须来自或接近以下色板：${blueprint.visualTheme.colors.join('、')}。`,
          '禁止继续使用未在色板中的深蓝、青色或组件默认主题色。',
        ].join('\n\n'),
      }, context.providerCallbacks)
      if (
        !Array.isArray(result.artifacts) ||
        result.artifacts.length !== expectedCount ||
        !artifactMatchesVisualTheme(result.artifacts[0], blueprint.visualTheme.colors)
      ) {
        throw createRuntimeError(
          'COMPONENT_VISUAL_THEME_MISMATCH',
          '组件视觉外壳连续两次偏离 KV 色板，已停止写入画布。',
        )
      }
    }
    const visualShellArtifact = result.artifacts[0]
    const generatedAssets = result.artifacts.slice(1).map((artifact, index) => ({
      task: planned.assetTasks[index],
      artifact: addExactTextToArtifact(artifact, planned.assetTasks[index]),
    }))
    return {
      summary: `已生成组件视觉外壳和 ${generatedAssets.length} 个 Props 独立素材。`,
      data: { visualShellArtifact, generatedAssets, themeRepairCount },
    }
  })

  registerTool(tools, 'component.validate-assets', async (context) => {
    const generated = context.memory.get('component.generate-assets')?.data
    const blueprint = context.memory.get('component.blueprint')?.data?.blueprint
    const generatedAssets = generated?.generatedAssets
    if (!generated?.visualShellArtifact || !blueprint || !Array.isArray(generatedAssets)) {
      throw createRuntimeError('COMPONENT_ASSETS_MISSING', '缺少组件素材生成结果。')
    }
    const shellReview = inspectImageArtifact(generated.visualShellArtifact, {
      placementMode: 'asset-board',
      width: blueprint.width,
    })
    if (!shellReview.passed) {
      const message = shellReview.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join('；')
      throw createRuntimeError('COMPONENT_SHELL_INVALID', `组件视觉外壳验证失败：${message}`)
    }
    for (const item of generatedAssets) {
      const review = inspectImageArtifact(item.artifact, {
        placementMode: 'asset-board',
        width: item.task.targetSize.width,
      })
      if (!review.passed) {
        const message = review.issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join('；')
        throw createRuntimeError(
          'COMPONENT_ASSET_INVALID',
          `${item.task.slotId} 素材验证失败：${message}`,
        )
      }
      item.review = review
    }
    const qualityReview = createComponentQualityReview({
      blueprint,
      generatedAssets,
      shellArtifact: generated.visualShellArtifact,
      repairCount: generated.themeRepairCount,
    })
    if (!qualityReview.passed) {
      const errors = qualityReview.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join('；')
      throw createRuntimeError('COMPONENT_QUALITY_REVIEW_FAILED', errors || '组件质量评分未达到交付门槛。')
    }
    return {
      summary: `组件视觉外壳和 ${generatedAssets.length} 个 Props 素材验证通过。`,
      data: {
        visualShellArtifact: generated.visualShellArtifact,
        visualShellReview: shellReview,
        generatedAssets,
        qualityReview,
      },
    }
  })

  registerTool(tools, 'component.compose', async (context) => {
    const resolved = context.memory.get('component.resolve')?.data
    const blueprint = context.memory.get('component.blueprint')?.data?.blueprint
    const planned = context.memory.get('component.plan-assets')?.data
    const validated = context.memory.get('component.validate-assets')?.data
    const generatedAssets = validated?.generatedAssets
    if (!resolved || !blueprint || !planned || !validated?.visualShellArtifact || !Array.isArray(generatedAssets)) {
      throw createRuntimeError('COMPONENT_COMPOSE_INPUT_MISSING', '组件预览缺少必要输入。')
    }
    const propsPatch = createNestedPatch(planned.propertyValues)
    for (const item of generatedAssets) {
      const dataUri = svgArtifactDataUri(item.artifact)
      setNestedValue(propsPatch, item.task.propPath, dataUri)
      if (item.task.fallbackPath) setNestedValue(propsPatch, item.task.fallbackPath, dataUri)
    }
    const previewArtifact = composeComponentPreview(
      resolved.contract.componentName,
      blueprint,
      generatedAssets,
      planned.propertyValues,
      validated.visualShellArtifact,
    )
    const diagnostics = [
      ...(resolved.contract.diagnostics ?? []),
      ...(blueprint.diagnostics ?? []),
      ...(planned.skippedSlots ?? []).map((slot) => ({
        code: 'ANIMATION_PROVIDER_MISSING',
        path: slot.bindings.image,
        message: `保留 ${slot.bindings.image} 原值；当前 Provider 只生成静态 SVG，不能安全替换动效素材。`,
      })),
    ]
    const runtimeValidation = await validateComponentRuntime({
      componentName: resolved.contract.componentName,
      profile: resolved.profile.id,
      sourceHash: resolved.contract.sourceHash,
      baseProps: resolved.loaded.component?.props ?? {},
      propsPatch,
      assets: Object.fromEntries(generatedAssets.map((item) => [
        item.task.slotId,
        svgArtifactDataUri(item.artifact),
      ])),
      designSnapshot: {
        width: blueprint.width,
        height: blueprint.height,
        regions: blueprint.regions.map((region) => ({ id: region.id, bounds: region.bounds })),
        propPaths: Object.keys(planned.propertyValues),
      },
    })
    const componentDesign = {
      componentName: resolved.contract.componentName,
      profile: resolved.profile.id,
      sourceHash: resolved.contract.sourceHash,
      blueprint,
      assetTasks: planned.assetTasks,
      propsPatch,
      properties: [
        ...resolved.contract.designProperties,
        ...resolved.contract.structuralControls,
      ].filter((property) => (
        propertyInProfile(property, resolved.profile.id) && property.kind !== 'image'
      )).map((property) => ({ path: property.path, kind: property.kind })),
      unresolved: resolved.contract.unresolved ?? [],
      diagnostics,
      visualShell: {
        role: 'component-shell',
        generated: true,
      },
      qualityReview: validated.qualityReview,
      runtimeValidation,
    }
    context.session.componentDesign = componentDesign
    return {
      summary: `已合成 ${resolved.contract.componentName} 组件预览和最小 Props Patch。`,
      data: {
        previewArtifact,
        visualShellArtifact: validated.visualShellArtifact,
        artifacts: generatedAssets.map((item) => item.artifact),
        componentDesign,
      },
    }
  })

  registerTool(tools, 'canvas.present-component', async (context) => {
    const composed = context.memory.get('component.compose')?.data
    if (!composed?.previewArtifact || !composed?.visualShellArtifact || !composed?.componentDesign) {
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
    const loaded = await loadComponentsFromPrompt(request, { allowStructuralComponents: true })
    const resolvedNodes = loaded.map((item, index) => ({
      componentName: String(item.component?.name || item.fileName.replace(/\.json$/i, '')),
      label: String(item.component?.label || item.component?.name || item.fileName),
      fileName: item.fileName,
      index,
      nodeType: classifyPageNode(item.component),
      designPaths: extractDesignPaths(item.component),
    }))
    const pageRoot = resolvedNodes.find((item) => item.nodeType === 'page-root')
    const containers = resolvedNodes.filter((item) => item.nodeType === 'container')
    const components = resolvedNodes.filter((item) => item.nodeType === 'component')
    if (!components.length) {
      throw createRuntimeError('PAGE_COMPONENT_MISSING', '页面至少需要一个可生成的业务组件。')
    }
    return {
      summary: `页面已解析 ${components.length} 个业务组件、${containers.length} 个容器${pageRoot ? '和 1 个页面根节点' : ''}。`,
      data: { components, containers, pageRoot },
    }
  })

  registerTool(tools, 'page.generate-component', async (context) => {
    try {
      return await generatePageComponentTask(tools, context)
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
    const subSession = {
      ...context.session,
      componentRequest: componentName,
      goal: [
        context.session.goal,
        sharedTheme
          ? `本组件必须沿用页面共享 VisualThemeContract：${JSON.stringify(sharedTheme)}`
          : '',
        context.session.repairContext?.targetId === context.input?.pageSectionId
          ? `这是定向修订任务，必须修正：${JSON.stringify(context.session.repairContext.issues)}`
          : '',
      ].filter(Boolean).join('\n'),
    }
    const subContext = {
      ...context,
      session: subSession,
      memory: localMemory,
    }
    const pipeline = [
      'component.resolve',
      'component.blueprint',
      'component.plan-assets',
      'component.generate-assets',
      'component.validate-assets',
      'component.compose',
    ]
    for (const toolName of pipeline) {
      const execute = tools.get(toolName)
      if (!execute) throw createRuntimeError('AGENT_TOOL_NOT_FOUND', `组件子任务工具不存在：${toolName}`)
      const result = await execute(subContext)
      localMemory.set(toolName, result)
    }
    const composed = localMemory.get('component.compose')?.data
    if (!composed?.componentDesign) {
      throw createRuntimeError('PAGE_COMPONENT_RESULT_MISSING', `${componentName} 没有返回组件设计。`)
    }
    context.session.pageVisualTheme ||= composed.componentDesign.blueprint.visualTheme
    return {
      summary: `${componentName} 页面组件生成完成。`,
      data: {
        ...composed,
        componentName,
        index: Number(context.input.index) || 0,
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
        estimatedHeight: 520,
      })),
      context.session.pageVisualTheme,
      {
        padding: 16,
        gap: 24,
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
    return {
      summary: `页面 Blueprint 已规划 ${blueprint.sections.length} 个组件 Section。`,
      data: { blueprint },
    }
  })

  registerTool(tools, 'page.confirm-blueprint', async (context) => {
    const originalBlueprint = context.memory.get('page.blueprint')?.data?.blueprint
    const components = context.memory.get('page.resolve-components')?.data?.components
    if (!originalBlueprint || !components?.length) {
      throw createRuntimeError('PAGE_BLUEPRINT_MISSING', '缺少待确认的页面 Blueprint。')
    }
    const blueprint = context.payload.blueprintOverride ?? originalBlueprint
    const blueprintIssues = validatePageCompositionBlueprint(blueprint)
    if (blueprintIssues.length) {
      throw createRuntimeError('PAGE_BLUEPRINT_INVALID', blueprintIssues.join('；'))
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
          throw createRuntimeError('PAGE_BLUEPRINT_COMPONENT_INVALID', `Blueprint 引用了未解析组件：${componentName}`)
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
        message: `页面结构已规划，共 ${blueprint.sections.length} 个组件模块。确认后再生成组件素材和页面视觉外壳。`,
      },
    }
  })

  registerTool(tools, 'page.extract-theme', async (context) => {
    const visualUploads = getPreparedUploads(context).filter((upload) => (
      upload.role === 'kv' || upload.role === 'visual'
    ))
    if (!visualUploads.length) {
      return {
        summary: '本次没有 KV/视觉参考图，页面将使用任务文字主题。',
        data: { visualTheme: context.session.pageVisualTheme },
      }
    }
    const result = await invokeProvider({
      ...context.payload,
      type: 'extract_visual_theme',
      question: [
        `页面目标：${context.session.goal}`,
        '只从用户指定的 KV/视觉参考图提取一次页面 VisualThemeContract。',
        '该主题将同时约束页面外壳和所有业务组件，必须忠实保留 KV 的主色、背景、文字对比、材质、装饰和图像语言。',
        '禁止使用组件 thumbnail 或组件默认配色覆盖 KV。',
      ].join('\n\n'),
      uploads: visualUploads,
    }, context.providerCallbacks)
    if (!result.visualTheme) {
      throw createRuntimeError('PAGE_VISUAL_THEME_MISSING', 'KV 主题提取没有返回 VisualThemeContract。')
    }
    context.session.pageVisualTheme = result.visualTheme
    return {
      summary: `页面 KV 主题已提取，共 ${result.visualTheme.colors.length} 个主导色。`,
      data: { visualTheme: result.visualTheme },
    }
  })

  registerTool(tools, 'page.generate-shell', async (context) => {
    const page = context.memory.get('page.confirm-blueprint')?.data ?? context.memory.get('page.blueprint')?.data
    if (!page?.blueprint) throw createRuntimeError('PAGE_BLUEPRINT_MISSING', '缺少页面 Blueprint。')
    const blueprint = {
      ...page.blueprint,
      visualTheme: context.session.pageVisualTheme ?? page.blueprint.visualTheme,
    }
    const uploads = getPreparedUploads(context)
    const result = await invokeProvider({
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
        context.session.repairContext?.key === 'page-quality'
          ? `这是第 ${context.session.repairContext.attempt} 次定向修订。必须修正以下评审问题：${JSON.stringify(context.session.repairContext.issues)}`
          : '',
        `输出尺寸必须为 ${blueprint.width}x${blueprint.estimatedHeight}。`,
        '只绘制页面背景、跨模块连接装饰、氛围纹理和页级光效。组件主体、按钮、文字、奖品、任务和动态内容必须保持透明，禁止再次绘制组件截图。',
        'manifest 只能包含一个 page-visual-shell 素材。',
      ].filter(Boolean).join('\n\n'),
      uploads,
      imageTasks: [createImageTask({
        id: 'page-visual-shell',
        name: 'page-visual-shell.png',
        targetSize: { width: blueprint.width, height: blueprint.estimatedHeight },
        transparent: false,
        prompt: '生成完整页面背景、跨模块连接装饰、氛围纹理和页级光效，不绘制组件主体、按钮和文字。',
      })],
    }, context.providerCallbacks)
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
        review.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join('；'),
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
    const page = context.memory.get('page.confirm-blueprint')?.data ?? context.memory.get('page.blueprint')?.data
    const shell = context.memory.get('page.generate-shell')?.data
    const components = collectPageComponents(context)
    const failedComponents = collectPageFailures(context)
    const blueprint = shell?.blueprint ?? page?.blueprint
    if (!blueprint || !shell?.pageShellArtifact) {
      throw createRuntimeError('PAGE_REVIEW_INPUT_MISSING', '页面质量审查缺少 Blueprint、组件或视觉外壳。')
    }
    const componentReviews = components.map((component) => component.componentDesign.qualityReview)
    const blueprintIssues = validatePageCompositionBlueprint(blueprint)
    const structure = blueprintIssues.length ? 0 : 1
    const componentTheme = averageScore(componentReviews.map((review) => review?.scores.theme ?? 0.75))
    const shellTheme = blueprint.visualTheme
      ? calculateThemeAffinity(shell.pageShellArtifact, blueprint.visualTheme.colors)
      : 0.8
    let theme = (componentTheme + shellTheme) / 2
    let readability = averageScore(componentReviews.map((review) => review?.scores.readability ?? 1))
    const completeness = blueprint.sections.length
      ? components.length / blueprint.sections.length
      : 0
    const runtimeStatuses = components.map((component) => (
      component.componentDesign.runtimeValidation?.status ?? 'unsupported'
    ))
    const developmentReadiness = averageScore(runtimeStatuses.map((status) => (
      status === 'passed' ? 1 : status === 'unsupported' ? 0.5 : 0
    )))
    const issues = []
    const visionReview = await reviewPageVision({
      invokeProvider,
      payload: context.payload,
      blueprint,
      shellArtifact: shell.pageShellArtifact,
      components,
      callbacks: context.providerCallbacks,
    })
    if (visionReview.status === 'completed') {
      theme = averageScore([theme, visionReview.scores.theme, visionReview.scores.referenceSimilarity])
      readability = averageScore([readability, visionReview.scores.readability, visionReview.scores.hierarchy])
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
    if (structure < 0.9) issues.push(qualityIssue('PAGE_STRUCTURE_INVALID', 'structure', structure, 0.9, 'page'))
    if (theme < 0.75) issues.push(qualityIssue('PAGE_THEME_LOW_AFFINITY', 'theme', theme, 0.75, 'page'))
    if (readability < 0.85) issues.push(qualityIssue('PAGE_TEXT_UNREADABLE', 'readability', readability, 0.85, 'page'))
    if (completeness < 1) {
      issues.push({
        code: 'PAGE_COMPONENT_INCOMPLETE',
        severity: 'warning',
        scope: 'page',
        message: `页面已交付 ${components.length}/${blueprint.sections.length} 个组件，失败组件：${failedComponents.map((item) => item.componentName).join('、') || '未知'}`,
        repairAction: '只重试失败的页面组件，不要重新生成已完成组件。',
      })
    }
    if (runtimeStatuses.some((status) => status === 'failed')) {
      issues.push(qualityIssue('PAGE_RUNTIME_FAILED', 'developmentReadiness', developmentReadiness, 0.8, 'runtime'))
    } else if (runtimeStatuses.some((status) => status === 'unsupported')) {
      issues.push({
        code: 'PAGE_RUNTIME_UNSUPPORTED',
        severity: 'warning',
        scope: 'runtime',
        message: '页面设计已通过，但尚未配置全部真实组件 Runtime。',
        repairAction: '接入组件 Bundle Adapter 后重新验证。',
      })
    }
    const qualityReview = {
      passed: !issues.some((issue) => issue.severity === 'error'),
      deliveryStatus: runtimeStatuses.length > 0 && runtimeStatuses.every((status) => status === 'passed')
        ? 'runtime-verified'
        : 'design-ready',
      scores: {
        structure: roundScore(structure),
        theme: roundScore(theme),
        readability: roundScore(readability),
        completeness: roundScore(completeness),
        developmentReadiness: roundScore(developmentReadiness),
      },
      issues,
      repairCount: componentReviews.reduce((total, review) => total + (review?.repairCount ?? 0), 0),
    }
    if (!qualityReview.passed) {
      const repairTargetId = qualityReview.issues.find((issue) => issue.severity === 'error')?.targetId ?? 'page-shell'
      const targetIndex = blueprint.sections.findIndex((section) => section.id === repairTargetId)
      return {
        summary: `页面评审未通过，将定向修订 page-shell：${qualityReview.issues.map((issue) => issue.message).join('；')}`,
        data: { blueprint, components, failedComponents, ...shell, qualityReview },
        decision: {
          action: 'repair',
          key: 'page-quality',
          targetId: repairTargetId,
          issues: qualityReview.issues,
          invalidateStepIds: targetIndex >= 0
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
    if (!reviewed?.blueprint || !Array.isArray(reviewed.components) || !reviewed?.pageShellArtifact) {
      throw createRuntimeError('PAGE_PRESENTATION_MISSING', '没有可交付到画布的完整页面结果。')
    }
    return {
      summary: `完整页面和 ${reviewed.components.length} 个组件实例已准备交付画布。`,
      data: {
        pageShellArtifact: reviewed.pageShellArtifact,
        components: reviewed.components,
        failedComponents: reviewed.failedComponents ?? [],
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
    const task = {
      id: 'component-slot-edit',
      slotId: scope.slotId,
      label: scope.regionId,
      propPath: scope.propPath,
      fallbackPath: scope.fallbackPath,
      role: 'component-asset',
      targetSize: scope.targetSize,
      transparent: true,
      exactText: scope.exactText,
    }
    const currentUpload = typeof scope.currentImage === 'string' && scope.currentImage.startsWith('data:image/')
      ? {
          type: 'file',
          name: `${scope.slotId}-current.png`,
          mime: scope.currentImage.match(/^data:([^;]+);/)?.[1] || 'image/png',
          role: 'visual',
          data: scope.currentImage,
        }
      : undefined
    const uploads = uniqueUploads([
      currentUpload,
      ...getPreparedUploads(context),
    ].filter(Boolean))
    const result = await invokeProvider({
      ...context.payload,
      type: 'generate_assets',
      question: [
        `只重新生成 ${scope.componentName} / ${scope.profile} 的一个素材 Slot。`,
        `用户修改要求：${context.session.goal}`,
        `slotId=${scope.slotId}，propPath=${scope.propPath}，目标尺寸=${scope.targetSize.width}x${scope.targetSize.height}。`,
        scope.exactText
          ? `只生成无文字底图，Runtime 会确定性叠加“${scope.exactText}”。`
          : '',
        '只输出一张紧贴边界的图片；禁止生成完整组件、页面、对比图或其他 Slot。',
      ].filter(Boolean).join('\n\n'),
      uploads,
      imageTasks: [createImageTask({
        ...task,
        name: `${scope.slotId}.png`,
        prompt: `只重新生成 ${scope.componentName} 的 ${scope.slotId} 素材，不生成完整组件或页面。`,
      })],
    }, context.providerCallbacks)
    if (!Array.isArray(result.artifacts) || result.artifacts.length !== 1) {
      throw createRuntimeError('COMPONENT_SLOT_ARTIFACT_INVALID', '局部组件编辑必须返回一个素材。')
    }
    return {
      summary: `${scope.slotId} 素材重新生成完成。`,
      data: { artifact: addExactTextToArtifact(result.artifacts[0], task), task, editScope: scope },
    }
  })

  registerTool(tools, 'component.validate-slot', async (context) => {
    const generated = context.memory.get('component.regenerate-slot')?.data
    if (!generated?.artifact || !generated?.task) {
      throw createRuntimeError('COMPONENT_SLOT_ARTIFACT_MISSING', '缺少局部组件素材。')
    }
    const review = inspectImageArtifact(generated.artifact, {
      placementMode: 'asset-board',
      width: generated.task.targetSize.width,
    })
    if (!review.passed) {
      const message = review.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join('；')
      throw createRuntimeError('COMPONENT_SLOT_ARTIFACT_INVALID', `局部素材验证失败：${message}`)
    }
    return {
      summary: `${generated.task.slotId} 素材验证通过。`,
      data: { ...generated, review },
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

  registerTool(tools, 'page.regenerate-shell', async (context) => {
    const scope = context.session.editScope ?? context.payload.editScope
    if (scope?.type !== 'page-shell') {
      throw createRuntimeError('PAGE_SHELL_EDIT_SCOPE_MISSING', '缺少页面视觉外壳编辑范围。')
    }
    const currentUpload = typeof scope.currentImage === 'string' && scope.currentImage.startsWith('data:image/')
      ? {
          type: 'file',
          name: 'current-page-shell.png',
          mime: scope.currentImage.match(/^data:([^;]+);/)?.[1] || 'image/png',
          role: 'visual',
          data: scope.currentImage,
        }
      : undefined
    const result = await invokeProvider({
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
      ].filter(Boolean).join('\n\n'),
      uploads: uniqueUploads([currentUpload, ...getPreparedUploads(context)].filter(Boolean)),
      imageTasks: [createImageTask({
        id: 'page-visual-shell-regenerated',
        name: 'page-visual-shell.png',
        targetSize: scope.targetSize,
        transparent: false,
        prompt: `重新生成页面背景和跨模块视觉外壳。修改要求：${context.session.goal}`,
      })],
    }, context.providerCallbacks)
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
        review.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join('；'),
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
      availableResults: Array.from(context.memory.keys()).filter((key) => (
        typeof key === 'string' && !key.startsWith('inspect-')
      )).slice(-30),
    },
  }))

  return {
    async execute(name, context) {
      const tool = tools.get(name)
      if (tool) return tool(context)
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

function artifactMatchesVisualTheme(artifact, themeColors) {
  if (artifact?.kind === 'raster') return true
  const content = typeof artifact?.content === 'string' ? artifact.content : ''
  const theme = themeColors.map(parseColor).filter(Boolean)
  if (!content || !theme.length) return false
  const paints = Array.from(content.matchAll(
    /(?:fill|stroke|stop-color)=["'](#[0-9a-f]{3,8}|rgba?\([^"']+\))["']/gi,
  )).map((match) => parseColor(match[1])).filter(Boolean)
  if (!paints.length) return false
  const matched = paints.filter((paint) => theme.some((color) => colorDistance(paint, color) <= 92))
  return matched.length >= Math.max(1, Math.ceil(paints.length * 0.35))
}

function createComponentQualityReview({ blueprint, generatedAssets, shellArtifact, repairCount = 0 }) {
  const regionCount = blueprint.regions.length
  const validRegions = blueprint.regions.filter((region) => (
    region.bounds.x >= 0 && region.bounds.y >= 0 &&
    region.bounds.x + region.bounds.width <= blueprint.width + 1 &&
    region.bounds.y + region.bounds.height <= blueprint.height + 1
  )).length
  const structure = regionCount ? validRegions / regionCount : 0
  const theme = blueprint.visualTheme
    ? calculateThemeAffinity(shellArtifact, blueprint.visualTheme.colors)
    : 0.8
  const readableText = blueprint.regions.filter((region) => region.renderMode === 'text')
  const readableTextCount = readableText.filter((region) => (
    typeof region.content === 'string' && region.content.trim() && region.bounds.height >= 18
  )).length
  const readability = readableText.length ? readableTextCount / readableText.length : 1
  const expectedAssets = blueprint.regions.filter((region) => region.renderMode === 'generated-asset').length
  const completeness = expectedAssets ? Math.min(1, generatedAssets.length / expectedAssets) : 1
  const developmentReadiness = blueprint.regions.every((region) => (
    region.renderMode !== 'generated-asset' || (region.slotId && region.propBindings.length)
  )) ? 0.9 : 0.6
  const issues = []
  if (structure < 0.9) issues.push(qualityIssue('COMPONENT_STRUCTURE_OUT_OF_BOUNDS', 'structure', structure, 0.9))
  if (theme < 0.75) issues.push(qualityIssue('COMPONENT_THEME_LOW_AFFINITY', 'theme', theme, 0.75))
  if (readability < 0.85) issues.push(qualityIssue('COMPONENT_TEXT_UNREADABLE', 'readability', readability, 0.85))
  if (completeness < 1) issues.push(qualityIssue('COMPONENT_ASSET_INCOMPLETE', 'completeness', completeness, 1))
  if (developmentReadiness < 0.8) issues.push(qualityIssue('COMPONENT_NOT_DEVELOPMENT_READY', 'developmentReadiness', developmentReadiness, 0.8))
  return {
    passed: !issues.some((issue) => issue.severity === 'error'),
    scores: {
      structure: roundScore(structure),
      theme: roundScore(theme),
      readability: roundScore(readability),
      completeness: roundScore(completeness),
      developmentReadiness: roundScore(developmentReadiness),
    },
    issues,
    repairCount: repairCount ?? 0,
  }
}

function calculateThemeAffinity(artifact, themeColors) {
  if (artifact?.kind === 'raster') return 0.8
  const content = typeof artifact?.content === 'string' ? artifact.content : ''
  const theme = themeColors.map(parseColor).filter(Boolean)
  const paints = Array.from(content.matchAll(
    /(?:fill|stroke|stop-color)=["'](#[0-9a-f]{3,8}|rgba?\([^"']+\))["']/gi,
  )).map((match) => parseColor(match[1])).filter(Boolean)
  if (!theme.length || !paints.length) return 0
  return paints.filter((paint) => theme.some((color) => colorDistance(paint, color) <= 92)).length / paints.length
}

function qualityIssue(code, metric, score, threshold, scope = 'component') {
  return {
    code,
    severity: 'error',
    scope,
    message: `${metric} 评分 ${roundScore(score)}，低于交付门槛 ${threshold}。`,
    repairAction: `重新生成或修正 ${metric} 后再次审查。`,
  }
}

function roundScore(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100
}

function parseColor(value) {
  const hex = String(value || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (hex) {
    const normalized = hex[1].length === 3
      ? hex[1].split('').map((character) => character.repeat(2)).join('')
      : hex[1].slice(0, 6)
    return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16))
  }
  const rgb = String(value || '').match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i)
  return rgb ? rgb.slice(1, 4).map(Number) : undefined
}

function colorDistance(left, right) {
  return Math.sqrt(left.reduce((total, value, index) => total + (value - right[index]) ** 2, 0))
}

function registerTool(tools, name, execute) {
  tools.set(name, execute)
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
    const editorTypes = Object.values(prop?.valueTypeMap ?? {})
      .map((item) => String(item?.name || '').toLowerCase())
    const children = Array.isArray(prop?.objectChildrenShape)
      ? prop.objectChildrenShape.map((child) => `${path}.${child.name}`)
      : []
    const allPaths = children.length ? children : [path]
    allPaths.forEach((itemPath) => {
      const childName = itemPath.split('.').at(-1)
      const child = children.length
        ? prop.objectChildrenShape.find((item) => item.name === childName)
        : prop
      const types = Object.values(child?.valueTypeMap ?? prop?.valueTypeMap ?? {})
        .map((item) => String(item?.name || '').toLowerCase())
      if (editorTypes.some((type) => /color|image|number|edge|select/.test(type)) ||
          types.some((type) => /color|image|number|edge|select/.test(type))) {
        paths.push(itemPath)
      }
    })
  }
  return Array.from(new Set(paths))
}

function collectPageComponents(context) {
  return context.session.plan
    .filter((step) => step.tool === 'page.generate-component' && step.status === 'completed')
    .map((step) => context.memory.get(step.id)?.data)
    .filter((value) => value?.componentDesign && !value.failed)
    .sort((left, right) => left.index - right.index)
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

function alignColorPropertiesToTheme(propertyValues, colors) {
  if (!propertyValues || !Array.isArray(colors) || !colors.length) return propertyValues
  let colorIndex = 0
  return Object.fromEntries(Object.entries(propertyValues).map(([path, value]) => {
    if (!/color/i.test(path) || typeof value !== 'string') return [path, value]
    const color = colors[colorIndex % colors.length]
    colorIndex += 1
    return [path, color]
  }))
}

function referenceRoleLabel(role) {
  if (role === 'prototype') return '原型结构图'
  if (role === 'kv') return 'KV 视觉图'
  if (role === 'visual') return '视觉参考图'
  return '未指定参考图'
}

function getPreparedUploads(context) {
  return context.memory.get('reference.prepare')?.data?.uploads ?? []
}

function isContinuationPrompt(prompt) {
  return /^(?:请)?(?:继续|开始|执行|接着做|继续执行|开始生成|生成吧|就这样|允许|确认|确认执行|重试|再试一次)[吧。！!\s]*$/i.test(String(prompt || '').trim())
}

function describeReferences(uploads) {
  if (!uploads.length) return ''
  return `参考图：\n${uploads
    .map((upload, index) => `图片 ${index + 1}：${upload.name}，角色=${referenceRoleLabel(upload.role)}`)
    .join('\n')}`
}

function describeComponentReferences(uploads) {
  if (!uploads.length) return '没有可用参考图。'
  const lines = uploads.map((upload, index) => {
    const role = index === 0
      ? 'thumbnail（仅结构）'
      : upload.role === 'prototype'
        ? '用户原型（仅结构补充）'
        : upload.role === 'kv'
          ? 'KV（强制视觉来源）'
          : '视觉参考（强制视觉来源）'
    return `图片 ${index + 1}：${upload.name}，角色=${role}`
  })
  return [
    '组件参考图映射（图片序号与实际附件顺序一致）：',
    ...lines,
    '视觉优先级：用户 KV/视觉参考 > 用户文字风格 > thumbnail 配色 > 组件默认配色。',
  ].join('\n')
}

function buildDesignQuestion(context, blueprint) {
  const uploads = getPreparedUploads(context)
  const placementMode = context.session.canvasTarget?.placementMode
  const outputInstruction = placementMode === 'append-section'
    ? '只生成一个可追加到当前画板底部的页面模块，并输出为单张图片；不要重复生成完整页面。'
    : placementMode === 'duplicate-variant'
      ? '生成当前页面的一个完整视觉变体，并输出为单张图片。'
      : '生成一张完整静态页面设计图。'
  return [
    outputInstruction,
    `任务目标：${context.session.goal}`,
    blueprint ? `必须遵循以下 Design Blueprint：\n${JSON.stringify(blueprint, null, 2)}` : '',
    context.session.canvasTarget
      ? [
          `目标画板逻辑宽度：${context.session.canvasTarget.width}px。`,
          `初始参考高度：${context.session.canvasTarget.height}px，但高度必须根据内容自然延展，不要为了适配固定高度压缩或截断内容。`,
          '保持 375px H5 逻辑比例；Runtime 会根据生图模型输出尺寸统一换算到画板。',
        ].join('\n')
      : '',
    describeReferences(uploads),
    '原型图是唯一结构来源；KV 只提供视觉风格。不得增加原型中没有的模块。',
  ].filter(Boolean).join('\n\n')
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
  const visibleNodeCount = (content.match(/<(?:path|rect|circle|ellipse|polygon|polyline|line|image|text|use)\b/gi) ?? []).length
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
    const isExpectedWidth = Math.abs(width - logicalWidth) <= 2 || Math.abs(width - logicalWidth * 2) <= 4
    if (!isExpectedWidth) {
      addIssue(issues, 'svg-page-width', `完整页面宽度应为 ${logicalWidth}px 或 ${logicalWidth * 2}px。`)
    }
  }
  if (placementMode === 'append-section' && width > 0 && height / width > 4) {
    addIssue(issues, 'svg-section-ratio', '追加模块高度异常，疑似错误生成了完整长页面。')
  }
  if (textNodeCount === 0) {
    addIssue(issues, 'svg-no-text', 'SVG 没有可检索文本，请确认文案是否已经转为路径或位图。', 'warning')
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
  if (!content || !/^[a-z0-9+/=\s]+$/i.test(content)) addIssue(issues, 'image-content', '位图 Base64 内容无效。')
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    addIssue(issues, 'image-size', '位图缺少有效宽高。')
  } else if (width > 8192 || height > 8192) {
    addIssue(issues, 'image-size-limit', '位图尺寸超过安全范围。')
  }
  if (!byteLength || byteLength > 30 * 1024 * 1024) addIssue(issues, 'image-bytes', '位图为空或超过 30MB。')
  return {
    passed: !issues.some((issue) => issue.severity === 'error'),
    issues,
    metrics: { width, height, visibleNodeCount: 1, textNodeCount: 0, byteLength },
  }
}

function createImageTask({ id, name, targetSize, transparent, prompt }) {
  return {
    id,
    name,
    targetSize: {
      width: Math.max(1, Math.round(Number(targetSize?.width) || 375)),
      height: Math.max(1, Math.round(Number(targetSize?.height) || 812)),
    },
    transparent: Boolean(transparent),
    prompt,
  }
}

function addIssue(issues, code, message, severity = 'error') {
  issues.push({ code, message, severity })
}

function readNumericAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}=["']([0-9]+(?:\\.[0-9]+)?)(?:px)?["']`, 'i'))
  return match ? Number(match[1]) : undefined
}

function readViewBox(attributes) {
  const match = attributes.match(/\bviewBox=["']\s*[-+]?\d*\.?\d+(?:[\s,]+)[-+]?\d*\.?\d+(?:[\s,]+)(\d*\.?\d+)(?:[\s,]+)(\d*\.?\d+)\s*["']/i)
  if (!match) return undefined
  return { width: Number(match[1]), height: Number(match[2]) }
}

function selectComponentProfile(contract, prompt) {
  const profiles = Array.isArray(contract?.profiles) ? contract.profiles : []
  if (!profiles.length) {
    const hasDesignSurface = contract?.designProperties?.length || contract?.structuralControls?.length
    return hasDesignSurface ? { id: 'default', rootPath: '', confidence: 1 } : undefined
  }
  const normalized = String(prompt || '').toLowerCase()
  const explicit = profiles.find((profile) => (
    normalized.includes(String(profile.id).toLowerCase()) ||
    normalized.includes(String(profile.rootPath).toLowerCase())
  ))
  if (explicit) return explicit
  if (/自由模式|free\s*mode|自由布局/i.test(normalized)) {
    const free = profiles.find((profile) => /free|自由/i.test(`${profile.id} ${profile.rootPath}`))
    if (free) return free
  }
  return profiles.find((profile) => !/free|自由/i.test(`${profile.id} ${profile.rootPath}`)) ?? profiles[0]
}

function createProfileContract(contract, profileId) {
  const designProperties = contract.designProperties.filter((property) => (
    propertyInProfile(property, profileId) && property.kind !== 'image'
  ))
  const structuralControls = contract.structuralControls.filter((property) => (
    propertyInProfile(property, profileId)
  ))
  const slots = contract.slots.filter((slot) => (
    propertyInProfile(slot, profileId) &&
    slot.generationPolicy === 'generate' &&
    slot.role !== 'animation'
  ))
  return {
    componentName: contract.componentName,
    thumbnail: contract.thumbnail,
    profile: profileId,
    designProperties,
    structuralControls,
    slots,
    diagnostics: contract.diagnostics,
  }
}

function validateComponentBlueprint(blueprint, contract, profileId, options = {}) {
  if (!blueprint || blueprint.componentName !== contract.componentName) {
    throw createRuntimeError('COMPONENT_BLUEPRINT_NAME_MISMATCH', 'Component Blueprint 组件名称不匹配。')
  }
  if (blueprint.profile !== profileId) {
    throw createRuntimeError('COMPONENT_BLUEPRINT_PROFILE_MISMATCH', 'Component Blueprint Profile 不匹配。')
  }
  if (
    options.requireUserVisualTheme &&
    (
      !blueprint.visualTheme ||
      !['kv', 'visual'].includes(blueprint.visualTheme.source) ||
      !Array.isArray(blueprint.visualTheme.colors) ||
      blueprint.visualTheme.colors.length < 2
    )
  ) {
    throw createRuntimeError(
      'COMPONENT_VISUAL_THEME_MISSING',
      '存在用户 KV/视觉参考图，但 Component Blueprint 没有提取有效的 visualTheme。',
    )
  }
  const primarySlots = contract.slots.filter((slot) => (
    propertyInProfile(slot, profileId) &&
    slot.generationPolicy === 'generate' &&
    slot.role !== 'animation'
  ))
  const repairedBlueprint = repairComponentRegionSemantics(
    repairComponentSlotMappings(blueprint, contract, primarySlots),
    contract,
    primarySlots,
  )
  const slotIds = new Set(primarySlots.map((slot) => slot.id))
  const allowedPaths = new Set([
    ...contract.designProperties,
    ...contract.structuralControls,
  ].filter((property) => propertyInProfile(property, profileId)).map((property) => property.path))

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
  if (!visualTheme || !['kv', 'visual'].includes(visualTheme.source)) return values
  const colors = visualTheme.colors.filter((color) => typeof color === 'string' && color.trim())
  if (!colors.length) return values
  const colorProperties = [
    ...contract.designProperties,
    ...contract.structuralControls,
  ].filter((property) => propertyInProfile(property, profileId) && property.kind === 'color')
  const next = { ...values }
  for (const property of colorProperties) {
    const semantic = `${property.path} ${property.label ?? ''}`.toLowerCase()
    const color = /(?:text|font|文字|文本)/i.test(semantic)
      ? colors[2] ?? colors.at(-1) ?? colors[0]
      : /(?:bg|background|背景)/i.test(semantic)
        ? colors[1] ?? colors[0]
        : colors[0]
    next[property.path] = color
  }
  return next
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
  const properties = new Map([
    ...contract.designProperties,
    ...contract.structuralControls,
  ].map((property) => [property.path, property]))
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]))
  const genericLabel = /^(?:text|button|background|runtime|content|image|shape|文本|按钮|背景|内容|图片)$/i

  return {
    ...blueprint,
    regions: blueprint.regions.map((region) => {
      const propertyLabel = region.propBindings
        .map((path) => properties.get(path)?.label)
        .find((label) => typeof label === 'string' && label.trim() && !genericLabel.test(label.trim()))
      const slotLabel = region.slotId ? slotsById.get(region.slotId)?.label : undefined
      const role = !region.role || genericLabel.test(region.role.trim())
        ? slotLabel || propertyLabel || componentRegionFallbackLabel(region.renderMode)
        : region.role
      const content = region.renderMode === 'text' && (
        !region.content || genericLabel.test(String(region.content).trim())
      )
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
  const width = readContractNumber(contract, slot.bindings.width) ?? (
    slot.role === 'background' ? blueprint.width : Math.min(150, availableWidth)
  )
  const height = readContractNumber(contract, slot.bindings.height) ?? (
    slot.role === 'background' ? Math.min(240, Math.max(120, blueprint.height * 0.3)) :
      slot.role === 'button' ? 56 : 64
  )
  const configuredX = readContractCoordinate(contract, slot.bindings.x)
  const configuredY = readContractCoordinate(contract, slot.bindings.y)
  const stackedY = Math.max(0, ...regions.map((region) => region.bounds.y + region.bounds.height)) + gap
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
  const properties = new Map([
    ...contract.designProperties,
    ...contract.structuralControls,
  ].filter((property) => (
    propertyInProfile(property, profileId) && property.kind !== 'image'
  )).map((property) => [property.path, property]))
  for (const [path, value] of Object.entries(values ?? {})) {
    const property = properties.get(path)
    if (!property || !isValidDesignValue(property.kind, value)) continue
    result[path] = value
  }
  return result
}

function isValidDesignValue(kind, value) {
  if (kind === 'color') {
    return typeof value === 'string' && /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\(|transparent$)/i.test(value.trim())
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

function inferExactSlotText(slot) {
  const semantic = `${slot.id} ${slot.label} ${slot.bindings.image}`
  if (/draw[-_.]?one|抽\s*1\s*次|抽一次/i.test(semantic)) return '抽一次'
  if (/draw[-_.]?ten|抽\s*10\s*次|十连抽/i.test(semantic)) return '抽10次'
  return undefined
}

function uniqueUploads(uploads) {
  const seen = new Set()
  return uploads.filter((upload) => {
    if (!upload?.data || seen.has(upload.data)) return false
    seen.add(upload.data)
    return true
  })
}

function addExactTextToArtifact(artifact, task) {
  if (!task.exactText || artifact?.kind !== 'svg' || typeof artifact.content !== 'string') {
    return artifact
  }
  const review = inspectSvgArtifact(artifact, {
    placementMode: 'asset-board',
    width: task.targetSize.width,
  })
  const width = review.metrics.width || task.targetSize.width
  const height = review.metrics.height || task.targetSize.height
  const fontSize = Math.max(12, Math.round(height * 0.28))
  const text = `<text x="${width / 2}" y="${height / 2}" fill="#ffffff" font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="central">${escapeXml(task.exactText)}</text>`
  return {
    ...artifact,
    content: artifact.content.replace(/<\/svg>\s*$/i, `${text}</svg>`),
  }
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
    if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) {
      current[segment] = {}
    }
    current = current[segment]
  }
  current[segments.at(-1)] = value
}

function svgArtifactDataUri(artifact) {
  return `data:image/svg+xml;base64,${Buffer.from(artifact.content).toString('base64')}`
}

function composeComponentPreview(
  componentName,
  blueprint,
  generatedAssets,
  propertyValues,
  visualShellArtifact,
) {
  const assetsBySlot = new Map(generatedAssets.map((item) => [item.task.slotId, item.artifact]))
  const background = Object.entries(propertyValues ?? {})
    .find(([path, value]) => /(?:bg|background).*color/i.test(path) && typeof value === 'string')?.[1] ?? '#f3f4f6'
  const regions = blueprint.regions.map((region) => {
    const { x, y, width, height } = region.bounds
    const asset = region.slotId ? assetsBySlot.get(region.slotId) : undefined
    if (asset) {
      return `<image x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="none" href="${svgArtifactDataUri(asset)}"/>`
    }
    const colorValue = region.propBindings
      .map((path) => propertyValues?.[path])
      .find((value) => typeof value === 'string' && /^(?:#|rgb|hsl|transparent)/i.test(value))
    const fill = colorValue || (region.renderMode === 'text' ? '#ffffff' : '#e5e7eb')
    const dash = region.renderMode === 'runtime' ? ' stroke="#94a3b8" stroke-dasharray="6 4"' : ''
    const label = region.renderMode === 'color' ? '' : `<text x="${x + width / 2}" y="${y + height / 2}" fill="#475569" font-size="${Math.max(10, Math.min(16, height * 0.16))}" text-anchor="middle" dominant-baseline="central">${escapeXml(region.role)}</text>`
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="${escapeXml(fill)}"${dash}/>${label}`
  }).join('')
  const content = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${blueprint.width}" height="${blueprint.height}" viewBox="0 0 ${blueprint.width} ${blueprint.height}">`,
    `<title>${escapeXml(componentName)} 组件设计预览</title>`,
    `<rect width="${blueprint.width}" height="${blueprint.height}" fill="${escapeXml(background)}"/>`,
    `<image width="${blueprint.width}" height="${blueprint.height}" preserveAspectRatio="none" href="${svgArtifactDataUri(visualShellArtifact)}"/>`,
    regions,
    '</svg>',
  ].join('')
  return { kind: 'svg', content, name: `${componentName}-组件预览.png` }
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
