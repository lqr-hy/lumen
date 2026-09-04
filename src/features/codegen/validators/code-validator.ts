import type { CodeDocument } from '../types'
export interface CodeValidation {
  valid: boolean
  diagnostics: CodeDocument['diagnostics']
}
export function validateCodeDocument(document: CodeDocument): CodeValidation {
  const diagnostics = [...document.diagnostics]
  if (!document.files.length)
    diagnostics.push({ code: 'CODE_FILES_EMPTY', severity: 'error', message: '代码输出为空。' })
  if (!document.files.some((file) => file.path === document.entryFile))
    diagnostics.push({
      code: 'CODE_ENTRY_MISSING',
      severity: 'error',
      message: `入口文件不存在：${document.entryFile}`,
    })
  const paths = new Set<string>()
  for (const file of document.files) {
    if (paths.has(file.path))
      diagnostics.push({
        code: 'CODE_PATH_DUPLICATE',
        severity: 'error',
        message: `文件路径重复：${file.path}`,
        path: file.path,
      })
    paths.add(file.path)
  }
  for (const file of document.files)
    if (!file.path || file.path.startsWith('/') || file.path.includes('..'))
      diagnostics.push({
        code: 'CODE_PATH_UNSAFE',
        severity: 'error',
        message: `文件路径不安全：${file.path}`,
        path: file.path,
      })
  for (const asset of document.assets)
    if (asset.kind === 'data-uri' && !asset.source)
      diagnostics.push({
        code: 'ASSET_EMPTY',
        severity: 'error',
        message: `资源内容为空：${asset.id}`,
      })
  for (const dependency of document.dependencies)
    if (dependency.required && dependency.kind === 'runtime-component' && !dependency.source)
      diagnostics.push({
        code: 'RUNTIME_REQUIRED',
        severity: 'warning',
        message: `组件 ${dependency.name} 没有可安装的 Component Pack。`,
      })
  return { valid: !diagnostics.some((item) => item.severity === 'error'), diagnostics }
}
