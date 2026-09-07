/**
 * 组装提供给 Pi Agent 的最小 RuntimeContext。
 * 只暴露决策所需的画布摘要、选区、引用和扩展信息，避免传入完整文档和图片 Base64。
 */
export function assembleRuntimeContext(payload, domainSession, selectedSkills = []) {
  const continuation = isContinuationTurn(payload.question)
  const currentReferences = (payload.uploads ?? []).map((upload) => ({
    name: String(upload.name || '未命名引用'),
    role: String(upload.role || 'auto'),
    requestedRole: String(upload.requestedRole || upload.role || 'auto'),
    roleConfidence: Number(upload.roleConfidence) || undefined,
    roleReason: String(upload.roleReason || ''),
    mime: String(upload.mime || ''),
    source: 'current-turn',
  }))
  const currentReferenceKeys = new Set(
    currentReferences.map((reference) => `${reference.name}\u0000${reference.role}`),
  )
  const persistedReferences = (domainSession?.references ?? [])
    .map((reference) => ({
      name: String(reference.name || '未命名引用'),
      role: String(reference.role || 'auto'),
      requestedRole: String(reference.requestedRole || reference.role || 'auto'),
      roleConfidence: Number(reference.roleConfidence) || undefined,
      roleReason: String(reference.roleReason || ''),
      mime: String(reference.mime || ''),
      source: 'session',
    }))
    .filter(
      (reference) => !currentReferenceKeys.has(`${reference.name}\u0000${reference.role}`),
    )
  const currentComponentReferences = (payload.componentReferences ?? []).map((reference) => ({
    packId: reference.packId,
    componentName: reference.componentName,
    label: reference.label,
  }))
  return {
    session: {
      id: payload.sessionId,
      projectId: payload.projectId,
      status: domainSession?.status,
      ...(continuation
        ? {
            resumableTaskKind: domainSession?.pendingTask?.kind ?? domainSession?.taskKind,
            resumableGoal: domainSession?.pendingTask?.goal ?? domainSession?.goal,
          }
        : {}),
    },
    canvas: payload.canvasTarget
      ? {
          artboardId: payload.canvasTarget.artboardId,
          width: payload.canvasTarget.width,
          height: payload.canvasTarget.height,
          placementMode: payload.canvasTarget.placementMode,
        }
      : undefined,
    canvasContext: payload.canvasContext
      ? {
          documentRevision: payload.canvasContext.documentRevision,
          activeArtboardId: payload.canvasContext.activeArtboardId,
          selectedArtboardId: payload.canvasContext.selectedArtboardId,
          selectedElementIds: payload.canvasContext.selectedElementIds ?? [],
          lastCommittedTargetId: domainSession?.canvasTarget?.artboardId,
          artboards: (payload.canvasContext.artboards ?? []).slice(0, 40),
        }
      : undefined,
    canvasSnapshot: payload.canvasSnapshot
      ? {
          artboardId: payload.canvasSnapshot.artboardId,
          width: payload.canvasSnapshot.width,
          height: payload.canvasSnapshot.height,
          elementCount: payload.canvasSnapshot.elementCount,
          componentCount: payload.canvasSnapshot.componentCount,
          hasPageShell: payload.canvasSnapshot.hasPageShell === true,
          hasDesignSpec: Boolean(payload.canvasSnapshot.designSpec),
          designBlocks:
            payload.canvasSnapshot.designSpec?.blocks?.map((block) => ({
              id: block.id,
              kind: block.kind,
              label: block.label,
            })) ?? [],
          selectedElementIds: payload.canvasSnapshot.selectedElementIds,
          truncated: payload.canvasSnapshot.truncated === true,
        }
      : undefined,
    selection: payload.editScope
      ? {
          scopeId: payload.editScope.scopeId,
          type: payload.editScope.type,
          artboardId: payload.editScope.artboardId,
          documentRevision: payload.editScope.documentRevision,
          targetHash: payload.editScope.targetHash,
          targetElementIds: payload.editScope.targetElementIds,
          elementIds: payload.editScope.elementIds,
          componentName: payload.editScope.componentName,
          instanceId: payload.editScope.instanceId,
          slotId: payload.editScope.slotId,
          elementId: payload.editScope.elementId,
          blockId: payload.editScope.blockId,
          imageElementIds: payload.editScope.imageElementIds,
          start: payload.editScope.start,
          end: payload.editScope.end,
          selectedText: payload.editScope.selectedText,
          prefix: payload.editScope.prefix,
          suffix: payload.editScope.suffix,
          normalizedRect: payload.editScope.normalizedRect,
          pixelRect: payload.editScope.pixelRect,
          targetSize: payload.editScope.targetSize,
        }
      : undefined,
    references: [...currentReferences, ...persistedReferences],
    componentReferences: currentComponentReferences,
    stylePack: payload.stylePack
      ? {
          id: payload.stylePack.id,
          name: payload.stylePack.name,
          colors: payload.stylePack.colors,
          constraints: payload.stylePack.constraints,
        }
      : undefined,
    selectedSkills,
  }
}

/** 识别仅表示“继续已有任务”的控制型消息，防止历史任务被普通聊天误触发。 */
function isContinuationTurn(question) {
  return /^(?:请)?(?:继续|开始|执行|接着做|继续执行|开始生成|生成吧|就这样|允许|确认|确认执行|重试|再试一次)[吧。！!\s]*$/iu.test(
    String(question || '').trim(),
  )
}
