#!/usr/bin/env node

// 兼容旧命令；新代码应优先使用 extract_component_facts + resolve_design_contract 两阶段流程。
await import('./resolve_design_contract.mjs')
