#!/usr/bin/env node

import { composeComponentFacts, extractComponentFacts, resolveDesignContract } from './lib/component-design.mjs'
import { loadAdapters, parseCliArguments, readComponent, writeJson } from './lib/cli.mjs'

const { sourcePath, adapterPaths, basePaths } = parseCliArguments(
  process.argv.slice(2),
  '用法：node resolve_design_contract.mjs <component.json> [--base <base.json>] [--adapter <adapter.mjs>]',
)
const { component, source } = await readComponent(sourcePath)
const baseFactLayers = []
for (const basePath of basePaths) {
  const base = await readComponent(basePath)
  baseFactLayers.push(extractComponentFacts(base.component, base.source, {
    valueSource: 'base-component',
    sourceName: base.component.name,
  }))
}
const currentFacts = extractComponentFacts(component, source, {
  valueSource: 'component-default',
  sourceName: component.name,
})
const facts = baseFactLayers.length ? composeComponentFacts([...baseFactLayers, currentFacts]) : currentFacts
const adapters = await loadAdapters(adapterPaths)
writeJson(resolveDesignContract(component, facts, { adapters }))
