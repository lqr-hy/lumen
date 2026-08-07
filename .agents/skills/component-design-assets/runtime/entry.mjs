import {
  composeComponentFacts,
  extractComponentFacts,
  resolveDesignContract,
} from '../scripts/lib/component-design.mjs'

export async function extractFacts(input) {
  const { component, source } = normalizeComponentInput(input)
  return extractComponentFacts(component, source, {
    valueSource: input?.valueSource || 'component-default',
    sourceName: input?.sourceName || component.name,
  })
}

export async function resolveContract(input) {
  const current = normalizeComponentInput(input)
  const layers = []
  for (const baseInput of input?.bases ?? []) {
    const base = normalizeComponentInput(baseInput)
    layers.push(extractComponentFacts(base.component, base.source, {
      valueSource: baseInput.valueSource || 'base-component',
      sourceName: baseInput.sourceName || base.component.name,
    }))
  }
  const currentFacts = extractComponentFacts(current.component, current.source, {
    valueSource: input?.valueSource || 'component-default',
    sourceName: input?.sourceName || current.component.name,
  })
  const facts = layers.length ? composeComponentFacts([...layers, currentFacts]) : currentFacts
  return resolveDesignContract(current.component, facts)
}

function normalizeComponentInput(input) {
  if (input?.component && typeof input.component === 'object') {
    return { component: input.component, source: input.source || JSON.stringify(input.component) }
  }
  if (typeof input?.json === 'string') {
    return { component: JSON.parse(input.json), source: input.json }
  }
  throw new Error('Skill Tool 需要 component 对象或 json 字符串。')
}
