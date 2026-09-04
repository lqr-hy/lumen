import assert from 'node:assert/strict'
import {
  calculateComponentEditableCoverage,
  calculatePageEditableCoverage,
  createDesignEvalReport,
  selectAutomaticRepair,
} from '../electron/runtime/design-eval.mjs'

const editableCoverage = calculateComponentEditableCoverage({
  regions: [
    { renderMode: 'text' },
    { renderMode: 'color' },
    { renderMode: 'generated-asset', slotId: 'button', propBindings: ['style.button'] },
    { renderMode: 'generated-asset', propBindings: [] },
  ],
})
assert.equal(editableCoverage, 0.75)

const themeFailure = createDesignEvalReport({
  scope: 'page',
  scores: {
    structure: 1,
    theme: 0.4,
    readability: 1,
    completeness: 1,
    developmentReadiness: 0.9,
  },
  editableCoverage: 0.9,
})
assert.equal(themeFailure.passed, false)
assert.equal(selectAutomaticRepair(themeFailure)?.kind, 'page-shell')
assert(themeFailure.overall < 1)

const componentFailure = createDesignEvalReport({
  scope: 'page',
  scores: {
    structure: 1,
    theme: 1,
    readability: 1,
    completeness: 1,
    developmentReadiness: 1,
  },
  editableCoverage: 1,
  issues: [
    {
      code: 'VISION_REVIEW_ISSUE',
      severity: 'error',
      scope: 'component',
      targetId: 'section-lottery',
      message: '抽奖组件层级不清晰。',
      repairAction: '只调整抽奖组件。',
    },
  ],
})
assert.equal(selectAutomaticRepair(componentFailure)?.kind, 'page-component')
assert.equal(selectAutomaticRepair(componentFailure)?.targetId, 'section-lottery')

const runtimeFailure = createDesignEvalReport({
  scope: 'page',
  scores: {
    structure: 1,
    theme: 1,
    readability: 1,
    completeness: 1,
    developmentReadiness: 0,
  },
  editableCoverage: 1,
  issues: [
    {
      code: 'PAGE_RUNTIME_FAILED',
      severity: 'error',
      scope: 'runtime',
      metric: 'developmentReadiness',
      message: '真实组件运行失败。',
    },
  ],
})
assert.equal(runtimeFailure.repairPlan[0].automatic, false)
assert.equal(selectAutomaticRepair(runtimeFailure), undefined)

const pageEditableCoverage = calculatePageEditableCoverage(
  [
    { componentDesign: { qualityReview: { dimensions: { editableCoverage: 0.8 } } } },
    { componentDesign: { qualityReview: { scores: { developmentReadiness: 0.6 } } } },
  ],
  true,
)
assert.equal(pageEditableCoverage, 0.8)

console.log(
  JSON.stringify(
    {
      standardizedDimensions: true,
      weightedOverall: true,
      componentEditableCoverage: true,
      pageEditableCoverage: true,
      pageShellRepairTarget: true,
      componentRepairTarget: true,
      runtimeRepairBlocked: true,
    },
    null,
    2,
  ),
)
