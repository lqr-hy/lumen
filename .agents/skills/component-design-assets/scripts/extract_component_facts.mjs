#!/usr/bin/env node

import { extractComponentFacts } from './lib/component-design.mjs'
import { parseCliArguments, readComponent, writeJson } from './lib/cli.mjs'

const { sourcePath } = parseCliArguments(
  process.argv.slice(2),
  '用法：node extract_component_facts.mjs <component.json>',
)
const { component, source } = await readComponent(sourcePath)
writeJson(extractComponentFacts(component, source))
