import fs from 'node:fs/promises'
import path from 'node:path'
import { createRemoteComponentInspectorDocument } from '../electron/runtime/component-runtime-inspector.mjs'

const componentName = process.argv[2] || 'EraTasklist'
const outputPath = path.resolve(process.argv[3] || `tmp/runtime-captures/${componentName}.html`)
const component = JSON.parse(
  await fs.readFile(
    path.resolve(import.meta.dirname, `../componentsJson/${componentName}.json`),
    'utf8',
  ),
)
const source = await createRemoteComponentInspectorDocument(component, {
  width: 375,
  timeoutMs: 30_000,
})
const probe = `<script>setTimeout(()=>{const element=document.querySelector('.singletask-wrapper,.multitask-wrapper');const style=element&&getComputedStyle(element);document.documentElement.dataset.runtimeDebug=JSON.stringify({className:element&&element.className,inlineStyle:element&&element.getAttribute('style'),backgroundColor:style&&style.backgroundColor,color:style&&style.color,width:style&&style.width,height:style&&style.height,children:element&&element.querySelectorAll('*').length})},1000)</script>`
const html = source.replace('</body>', `${probe}</body>`)
await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, html)
process.stdout.write(`${outputPath}\n`)
