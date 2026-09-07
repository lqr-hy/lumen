import { Fragment, useEffect, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  LoaderCircle,
  LocateFixed,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import type { ChatRun, ChatRunDeliverable, ChatRunStep } from '../../ai/agent-run'
import { getRunStatusLabel, isRunActive, isSelectionConflict } from '../../ai/agent-run'
import type { SelectionScope } from '../../ai/types'
import { useEditorStore } from '../store/editor-store'
import { getSelectionScopeElementIds, getSelectionScopeLabel } from '../utils/selection-scope'

interface AgentRunTimelineProps {
  run: ChatRun
  selectionScope?: SelectionScope
  onRetry?: () => void
  onLocate?: (target: { artboardId?: string; elementId?: string }) => void
  onResolveConflict?: (
    deliverable: ChatRunDeliverable,
    choices: Record<string, 'current' | 'incoming'>,
  ) => boolean
}

export function AgentRunTimeline({
  run,
  selectionScope,
  onRetry,
  onLocate,
  onResolveConflict,
}: AgentRunTimelineProps) {
  const active = isRunActive(run)
  const document = useEditorStore((state) => state.document)
  const [expanded, setExpanded] = useState(active)
  const [, setClock] = useState(0)

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setClock((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [active])

  useEffect(() => {
    if (!active) setExpanded(false)
  }, [active])

  const visibleSteps = run.steps
  const scopeConflict = isSelectionConflict(run)
  return (
    <div className={`agent-run-timeline ${run.status}`}>
      <button
        type="button"
        className="agent-run-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="agent-run-state-icon">
          {renderStepIcon(run.status === 'completed' ? 'completed' : active ? 'running' : 'failed')}
        </span>
        <strong>{getUserRunLabel(run, visibleSteps)}</strong>
        <span>{getRunStatusLabel(run)}</span>
        <time>{formatDuration(run.startedAt, run.finishedAt)}</time>
      </button>

      {run.status === 'failed' && onRetry && !scopeConflict ? (
        <div className="agent-run-quick-actions">
          <button type="button" onClick={onRetry}>
            <RotateCcw size={14} />
            重试失败任务
          </button>
        </div>
      ) : null}

      {run.status === 'failed' && scopeConflict && selectionScope ? (
        <div className="agent-run-quick-actions conflict">
          <button
            type="button"
            onClick={() =>
              onLocate?.({
                artboardId: selectionScope.artboardId,
                elementId: getSelectionScopeElementIds(selectionScope)[0],
              })
            }
          >
            <LocateFixed size={14} />
            重新选择修改范围
          </button>
        </div>
      ) : null}

      {expanded ? (
        <div className="agent-run-details">
          {selectionScope ? <SelectionScopeDiagnostics scope={selectionScope} /> : null}
          {visibleSteps.length ? (
            <ol className="agent-run-steps">
              {visibleSteps.map((step) => (
                <AgentRunStepRow
                  key={step.id}
                  step={normalizeDisplayedStep(step, run)}
                  runFinishedAt={run.finishedAt}
                />
              ))}
            </ol>
          ) : active ? (
            <div className="agent-run-empty">
              <LoaderCircle size={14} /> 正在等待模型响应
            </div>
          ) : null}
          {run.deliverables.length ? (
            <div className="agent-run-deliverables">
              {run.deliverables.map((deliverable) => (
                <Fragment key={deliverable.id}>
                  {deliverable.conflictResolution ? (
                    <DesignSpecConflictEditor
                      deliverable={deliverable}
                      onResolve={onResolveConflict}
                    />
                  ) : isCanvasRevisionConflict(deliverable) ? (
                    <CanvasConflictDiagnostics
                      deliverable={deliverable}
                      onLocate={onLocate}
                      onRetry={onRetry}
                    />
                  ) : deliverable.patchOperations?.length ? (
                    <DesignPatchDiagnostics
                      deliverable={deliverable}
                      scope={selectionScope}
                      document={document}
                      onLocate={onLocate}
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={!deliverable.artboardId && !deliverable.elementId}
                      onClick={() => onLocate?.(deliverable)}
                    >
                      <LocateFixed size={14} />
                      <span>
                        <strong>{deliverable.title}</strong>
                        <small>{deliverable.summary}</small>
                      </span>
                    </button>
                  )}
                  {deliverable.qualityReport ? (
                    <QualityGateStatus report={deliverable.qualityReport} />
                  ) : null}
                </Fragment>
              ))}
            </div>
          ) : null}
          {run.error ? <RunError error={run.error} /> : null}
        </div>
      ) : null}
    </div>
  )
}

function QualityGateStatus({
  report,
}: {
  report: NonNullable<ChatRunDeliverable['qualityReport']>
}) {
  const errors = report.issues.filter((issue) => issue.severity === 'error')
  const warnings = report.issues.filter((issue) => issue.severity === 'warning')
  const status = report.passed ? (warnings.length ? 'warning' : 'passed') : 'blocked'
  const label = status === 'passed' ? '门禁通过' : status === 'warning' ? '有警告' : '门禁阻断'
  return (
    <section className={`agent-run-quality-gate ${status}`} aria-label={`设计门禁：${label}`}>
      <header>
        {status === 'passed' ? (
          <CheckCircle2 size={14} />
        ) : status === 'warning' ? (
          <Circle size={14} />
        ) : (
          <XCircle size={14} />
        )}
        <strong>设计门禁</strong>
        <b>{label}</b>
        <span>
          {report.scope} · {Math.round(report.score * 100)} 分
        </span>
      </header>
      <div>
        <span>{report.targetIds.length} 个目标</span>
        {errors.length ? <span>{errors.length} 个错误</span> : null}
        {warnings.length ? <span>{warnings.length} 个警告</span> : null}
        {report.repairCount ? <span>自动修复 {report.repairCount}/2 轮</span> : null}
      </div>
      {errors.length || warnings.length ? (
        <ul>
          {[...errors, ...warnings].slice(0, 4).map((issue, index) => (
            <li key={`${issue.code}-${index}`} className={issue.severity}>
              <span>{issue.severity === 'error' ? '错误' : '警告'}</span>
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function CanvasConflictDiagnostics({
  deliverable,
  onLocate,
  onRetry,
}: {
  deliverable: ChatRunDeliverable
  onLocate?: AgentRunTimelineProps['onLocate']
  onRetry?: AgentRunTimelineProps['onRetry']
}) {
  const ids = deliverable.affectedElementIds ?? []
  return (
    <section className="agent-run-canvas-conflict">
      <div className="agent-run-canvas-conflict-header">
        <strong>画布发生并发修改</strong>
        <span>{ids.length ? `${ids.length} 个冲突节点` : '整页目标冲突'}</span>
      </div>
      <small>{deliverable.summary}</small>
      <div className="agent-run-canvas-conflict-actions">
        {ids.slice(0, 8).map((elementId) => (
          <button
            key={elementId}
            type="button"
            onClick={() => onLocate?.({ artboardId: deliverable.artboardId, elementId })}
          >
            <LocateFixed size={13} />
            定位 {elementId}
          </button>
        ))}
        {onLocate && deliverable.artboardId ? (
          <button type="button" onClick={() => onLocate({ artboardId: deliverable.artboardId })}>
            <LocateFixed size={13} />
            查看目标画板
          </button>
        ) : null}
        {onRetry ? (
          <button className="primary" type="button" onClick={onRetry}>
            <RotateCcw size={13} />
            确认后重新执行
          </button>
        ) : null}
      </div>
      <em>确认当前画布内容后重新执行，系统会使用最新版本重新握手。</em>
    </section>
  )
}

function isCanvasRevisionConflict(deliverable: ChatRunDeliverable) {
  return (
    deliverable.status === 'failed' &&
    Boolean(
      deliverable.errorCode &&
      /DOCUMENT_REVISION_CONFLICT|CANVAS_DOCUMENT_REVISION_CONFLICT/.test(deliverable.errorCode),
    )
  )
}

function SelectionScopeDiagnostics({ scope }: { scope: SelectionScope }) {
  return (
    <section className="agent-run-scope-diagnostics">
      <span>
        <strong>执行范围</strong>
        <code>{scope.type}</code>
      </span>
      <b>{getSelectionScopeLabel(scope)}</b>
      <small>
        Revision {scope.documentRevision} · {scope.targetElementIds.length} 个允许写入节点
      </small>
      {scope.type === 'text-range' ? (
        <small>
          字符 {scope.start}-{scope.end} · “{scope.selectedText}”
        </small>
      ) : null}
      {scope.type === 'image-region' ? (
        <small>
          区域 {formatRect(scope.normalizedRect)} · {scope.targetSize.width} ×{' '}
          {scope.targetSize.height}px
        </small>
      ) : null}
    </section>
  )
}

function DesignPatchDiagnostics({
  deliverable,
  scope,
  document,
  onLocate,
}: {
  deliverable: ChatRunDeliverable
  scope?: SelectionScope
  document: ReturnType<typeof useEditorStore.getState>['document']
  onLocate?: AgentRunTimelineProps['onLocate']
}) {
  const currentElement =
    scope && 'elementId' in scope
      ? document?.elements.find((element) => element.id === scope.elementId)
      : undefined
  return (
    <section className="agent-run-patch-diagnostics">
      <button type="button" onClick={() => onLocate?.(deliverable)}>
        <LocateFixed size={14} />
        <span>
          <strong>{deliverable.title}</strong>
          <small>{deliverable.summary}</small>
        </span>
      </button>
      <div className="agent-run-patch-meta">
        <span>{deliverable.patchOperations?.length ?? 0} 个 Operation</span>
        <span>{deliverable.affectedElementIds?.length ?? 0} 个写入节点</span>
        {deliverable.documentRevision !== undefined ? (
          <span>Revision {deliverable.documentRevision}</span>
        ) : null}
      </div>
      <ol>
        {deliverable.patchOperations?.map((operation) => (
          <li key={operation.id}>
            <code>{operation.kind}</code>
            <span>
              <b>{operation.elementId || operation.id}</b>
              <small>{operation.summary}</small>
            </span>
            {operation.before !== undefined || operation.after !== undefined ? (
              <div className="agent-run-text-diff">
                <del>{operation.before || '空文本'}</del>
                <ins>{operation.after || '空文本'}</ins>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {scope?.type === 'image-region' && currentElement?.type === 'image' ? (
        <div className="agent-run-image-diff">
          <figure>
            <img src={scope.currentImage} alt="局部修改前" />
            <figcaption>修改前</figcaption>
          </figure>
          <figure>
            <img src={currentElement.src} alt="局部修改后" />
            <figcaption>修改后</figcaption>
          </figure>
        </div>
      ) : null}
    </section>
  )
}

function formatRect(rect: { x: number; y: number; width: number; height: number }) {
  return `${Math.round(rect.x * 100)}%, ${Math.round(rect.y * 100)}% · ${Math.round(rect.width * 100)}% × ${Math.round(rect.height * 100)}%`
}

function normalizeDisplayedStep(step: ChatRunStep, run: ChatRun): ChatRunStep {
  if (!['running', 'retrying'].includes(step.status)) return step
  if (run.finishedAt) {
    const status: ChatRunStep['status'] =
      run.status === 'completed' ? 'completed' : run.status === 'cancelled' ? 'cancelled' : 'failed'
    return { ...step, status, completedAt: step.completedAt ?? run.finishedAt }
  }
  if (run.currentStepId && step.id !== run.currentStepId) {
    return {
      ...step,
      status: 'completed',
      completedAt: step.completedAt ?? new Date().toISOString(),
    }
  }
  return step
}

function DesignSpecConflictEditor({
  deliverable,
  onResolve,
}: {
  deliverable: ChatRunDeliverable
  onResolve?: AgentRunTimelineProps['onResolveConflict']
}) {
  const conflicts = deliverable.conflictResolution?.conflicts ?? []
  const blockIds = [...new Set(conflicts.map((item) => item.blockId))]
  const [choices, setChoices] = useState<Record<string, 'current' | 'incoming'>>(() =>
    Object.fromEntries(blockIds.map((id) => [id, 'current'])),
  )
  const [submitFailed, setSubmitFailed] = useState(false)
  return (
    <div className="design-spec-conflict-editor">
      <strong>页面结构存在并发修改</strong>
      <small>逐个节点选择保留当前内容或采用 AI 修改。</small>
      <div className="design-spec-conflict-list">
        {blockIds.map((blockId) => {
          const reasons = conflicts
            .filter((item) => item.blockId === blockId)
            .map((item) => conflictReasonLabel(item.reason))
          return (
            <div key={blockId}>
              <span>
                <b>{blockId}</b>
                <small>{[...new Set(reasons)].join('、')}</small>
              </span>
              <div role="group" aria-label={`${blockId} 冲突选择`}>
                <button
                  type="button"
                  className={choices[blockId] === 'current' ? 'active' : undefined}
                  onClick={() => setChoices((value) => ({ ...value, [blockId]: 'current' }))}
                >
                  保留当前
                </button>
                <button
                  type="button"
                  className={choices[blockId] === 'incoming' ? 'active' : undefined}
                  onClick={() => setChoices((value) => ({ ...value, [blockId]: 'incoming' }))}
                >
                  采用 AI
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className="design-spec-conflict-submit"
        onClick={() => {
          setSubmitFailed(!(onResolve?.(deliverable, choices) ?? false))
        }}
      >
        应用解决方案
      </button>
      {submitFailed ? <em>文档已再次变化，请重新发起结构修改。</em> : null}
    </div>
  )
}

function conflictReasonLabel(reason: string) {
  return (
    {
      'block-changed': '节点内容已变化',
      'block-deleted': '节点已删除',
      'block-id-collision': '节点 ID 已存在',
      'anchor-changed': '定位节点已变化',
      'anchor-deleted': '定位节点已删除',
      'relative-order-changed': '节点顺序已变化',
      'invalid-result': '合并结果无效',
    }[reason] ?? reason
  )
}

function AgentRunStepRow({ step, runFinishedAt }: { step: ChatRunStep; runFinishedAt?: string }) {
  const terminal = ['completed', 'failed', 'cancelled'].includes(step.status)
  const duration = step.startedAt
    ? formatDuration(step.startedAt, step.completedAt ?? (terminal ? runFinishedAt : undefined))
    : undefined
  return (
    <li className={step.status}>
      {renderStepIcon(step.status)}
      <span>
        <strong>{step.title}</strong>
        <code>{step.tool}</code>
        {step.summary ? <small>{step.summary}</small> : null}
        {step.partialFailure ? (
          <small>{step.partialSummary || '该步骤部分交付失败，已继续执行后续步骤。'}</small>
        ) : null}
        {step.error ? (
          <em>
            {step.errorCode ? `[${step.errorCode}] ` : ''}
            {step.error}
          </em>
        ) : null}
        {step.traces?.length ? (
          <ol className="agent-run-traces">
            {step.traces.map((trace) => (
              <li key={trace.id} className={trace.status}>
                {renderStepIcon(trace.status === 'started' ? 'running' : trace.status)}
                <span>
                  <b>{trace.label}</b>
                  <small>
                    {trace.tool}
                    {trace.targetSize
                      ? ` · ${trace.targetSize.width}x${trace.targetSize.height}`
                      : ''}
                    {trace.attempt
                      ? ` · 第 ${trace.attempt}/${trace.maxAttempts ?? trace.attempt} 次`
                      : ''}
                  </small>
                  {trace.status === 'failed' || trace.status === 'fallback' ? (
                    <em>
                      {trace.errorCode ? `[${trace.errorCode}] ` : ''}
                      {trace.message}
                    </em>
                  ) : null}
                </span>
                <time>
                  {typeof trace.elapsedMs === 'number' ? formatMilliseconds(trace.elapsedMs) : ''}
                </time>
              </li>
            ))}
          </ol>
        ) : null}
      </span>
      <time>
        {step.attempt && step.attempt > 1 ? `第 ${step.attempt} 次 · ` : ''}
        {duration}
      </time>
    </li>
  )
}

function formatMilliseconds(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

// 交付物类型决定这次到底产出了什么，避免整页生成也只显示“设计稿已生成”。
const RUN_COMPLETION_LABELS: Partial<Record<ChatRunDeliverable['kind'], string>> = {
  'page-finalize': '整页已生成',
  'page-shell-edit': '页面视觉外壳已更新',
  component: '组件设计已生成',
  'component-slot': '组件素材已替换',
  'component-slot-batch': '组件素材已批量替换',
  'design-patch': '局部修改已应用',
  'design-spec-patch': '页面结构已修改',
  'generic-ui-finalize': '界面设计稿已生成',
  'generic-ui-runtime': '界面设计稿已生成',
}

function getUserRunLabel(run: ChatRun, steps: ChatRunStep[]) {
  if (run.status === 'completed') {
    const delivered = run.deliverables.filter((item) => item.status === 'success')
    const label = delivered
      .map((item) => RUN_COMPLETION_LABELS[item.kind])
      .find((item): item is string => Boolean(item))
    return label ?? '设计稿已生成'
  }
  if (run.status === 'failed') return '设计生成未完成'
  if (run.status === 'cancelled') return '设计生成已停止'
  const running =
    steps.find((step) => step.id === run.currentStepId) ??
    steps.find((step) => step.status === 'running' || step.status === 'retrying')
  return running ? `正在${running.title}` : run.phaseLabel
}

function RunError({ error }: { error: string }) {
  const summary = normalizeUserError(error)
  return (
    <div className="agent-run-error">
      <XCircle size={14} />
      <span>
        <strong>{summary}</strong>
        {summary !== error ? <small>{error}</small> : null}
      </span>
    </div>
  )
}

function normalizeUserError(error: string) {
  if (/blueprint|version|regions?\[|bounds\.|component.*invalid|json/i.test(error)) {
    return '设计结构解析失败'
  }
  if (/timeout|超时|network|fetch|provider|gateway|空响应/i.test(error)) {
    return '连接生成服务失败'
  }
  return error.length > 96 ? '设计生成未完成' : error
}

function renderStepIcon(status: string) {
  if (status === 'completed') return <CheckCircle2 size={14} />
  if (status === 'running') return <LoaderCircle className="spin" size={14} />
  if (status === 'retrying') return <RotateCcw className="spin" size={14} />
  if (status === 'failed' || status === 'cancelled') return <XCircle size={14} />
  return <Circle size={12} />
}

function formatDuration(start: string, end?: string) {
  const seconds = Math.max(
    0,
    Math.round((new Date(end || Date.now()).getTime() - new Date(start).getTime()) / 1000),
  )
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
