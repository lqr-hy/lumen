export function assembleRuntimeContext(payload, domainSession, selectedSkills = []) {
  const continuation = isContinuationTurn(payload.question)
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
    references: (payload.uploads ?? []).map((upload) => ({
      name: String(upload.name || '未命名引用'),
      role: String(upload.role || 'visual'),
      mime: String(upload.mime || ''),
    })),
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

function isContinuationTurn(question) {
  return /^(?:请)?(?:继续|开始|执行|接着做|继续执行|开始生成|生成吧|就这样|允许|确认|确认执行|重试|再试一次)[吧。！!\s]*$/iu.test(
    String(question || '').trim(),
  )
}
