import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  composeComponentFacts,
  extractComponentFacts,
  resolveDesignContract,
} from '../scripts/lib/component-design.mjs'
import { adaptComponentInput } from '../scripts/lib/json-schema-adapter.mjs'

export async function extractFacts(input) {
  const { component, source } = normalizeComponentInput(input)
  return extractComponentFacts(component, source, {
    valueSource: input?.valueSource || 'component-default',
    sourceName: input?.sourceName || component.name,
  })
}

export async function resolveContract(input, context = {}) {
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
  const contract = resolveDesignContract(current.component, facts)
  const prototypeLayout = await loadPrototypeLayout(
    context.skillRoot,
    current.component.name,
    current.component.thumbnail,
  )
  return prototypeLayout ? {
    ...contract,
    sourceHash: crypto.createHash('sha256')
      .update(`${contract.sourceHash}:${prototypeLayout.sourceHash}`)
      .digest('hex'),
    prototypeLayout: prototypeLayout.layout,
  } : contract
}

async function loadPrototypeLayout(skillRoot, componentName, thumbnail) {
  if (!skillRoot || !/^[a-z0-9_-]+$/i.test(String(componentName || ''))) return undefined
  const filePath = path.join(skillRoot, 'runtime', 'layout-specs', `${componentName}.json`)
  let source
  try {
    source = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
  const layout = JSON.parse(source)
  if (
    layout?.version !== 1 ||
    layout.componentName !== componentName ||
    !layout.profiles ||
    typeof layout.profiles !== 'object'
  ) {
    throw new Error(`${componentName} 的 thumbnail 布局契约无效。`)
  }
  if (layout.thumbnail && thumbnail && layout.thumbnail !== thumbnail) {
    throw new Error(`${componentName} 的 thumbnail 已变化，需要重新校准布局契约。`)
  }
  return {
    layout,
    sourceHash: crypto.createHash('sha256').update(source).digest('hex'),
  }
}

function normalizeComponentInput(input) {
  const raw = input?.component && typeof input.component === 'object'
    ? input.component
    : typeof input?.json === 'string' ? JSON.parse(input.json) : undefined
  if (!raw) throw new Error('Skill Tool 需要 component 对象或 json 字符串。')
  return {
    component: adaptComponentInput(raw),
    source: input.source || input.json || JSON.stringify(raw),
  }
}
