import type { CodeDependency, CodeDiagnostic, CodeNode } from './types'
export function collectComponentDependencies(nodes: CodeNode[]) {
  const dependencies: CodeDependency[] = []
  const diagnostics: CodeDiagnostic[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    const runtime = node.meta.runtime
    if (!runtime) continue
    if (!seen.has(runtime.componentName)) {
      seen.add(runtime.componentName)
      dependencies.push({
        name: runtime.componentName,
        kind: 'runtime-component',
        source: runtime.componentPackId,
        required: true,
      })
    }
    if (!runtime.componentPackId)
      diagnostics.push({
        code: 'RUNTIME_REQUIRED',
        severity: 'warning',
        message: `组件 ${runtime.componentName} 需要 Runtime Component Adapter。`,
        nodeId: node.meta.elementId ?? node.key,
      })
  }
  return { dependencies, diagnostics }
}
