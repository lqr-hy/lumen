import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { inspectRuntimeDomToScene } from '../electron/runtime/runtime-dom-adapter.mjs'

const componentName = process.argv[2] || 'EraTasklist'
const outputPath = path.resolve(process.argv[3] || `tmp/runtime-captures/${componentName}.png`)
const reportPath = outputPath.replace(/\.png$/i, '') + '.json'
let exitCode = 0

try {
  await Promise.race([
    app.whenReady(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Electron app.whenReady 超过 15 秒。')), 15_000),
    ),
  ])
  const component = JSON.parse(
    await fs.readFile(
      path.resolve(import.meta.dirname, `../componentsJson/${componentName}.json`),
      'utf8',
    ),
  )
  const result = await inspectRuntimeDomToScene(
    { component, width: 375, height: 812 },
    { surfaceKind: 'mobile', capturePath: outputPath, timeoutMs: 30_000 },
  )
  const report = {
    componentName,
    outputPath,
    status: result.status,
    nodes: result.designTree?.nodes?.length || 0,
    sceneNodes: result.sceneGraph?.nodes?.length || 0,
    consoleErrors: result.consoleErrors || [],
    diagnostics: result.diagnostics || [],
  }
  await fs.mkdir(path.dirname(reportPath), { recursive: true })
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!['passed', 'partial'].includes(result.status)) exitCode = 1
} catch (error) {
  exitCode = 1
  const message = error instanceof Error ? error.stack || error.message : String(error)
  await fs.mkdir(path.dirname(reportPath), { recursive: true })
  await fs.writeFile(
    reportPath,
    `${JSON.stringify({ componentName, outputPath, status: 'failed', diagnostics: [{ code: 'CAPTURE_FAILED', message }] }, null, 2)}\n`,
  )
  process.stderr.write(`${message}\n`)
} finally {
  app.exit(exitCode)
}
