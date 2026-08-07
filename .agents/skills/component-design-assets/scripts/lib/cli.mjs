import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export function parseCliArguments(argv, usage) {
  const args = [...argv]
  const sourcePath = args.shift()
  if (!sourcePath || sourcePath === '--help' || sourcePath === '-h') {
    console.error(usage)
    process.exit(sourcePath ? 0 : 1)
  }
  const adapterPaths = []
  const basePaths = []
  while (args.length) {
    const flag = args.shift()
    if (flag === '--adapter' && args[0]) adapterPaths.push(args.shift())
    else if (flag === '--base' && args[0]) basePaths.push(args.shift())
    else throw new Error(`未知参数：${flag}`)
  }
  return {
    sourcePath: path.resolve(sourcePath),
    adapterPaths,
    basePaths: basePaths.map((basePath) => path.resolve(basePath)),
  }
}

export async function readComponent(sourcePath) {
  const source = await fs.readFile(sourcePath, 'utf8')
  return { source, component: JSON.parse(source) }
}

export async function loadAdapters(adapterPaths) {
  const adapters = []
  for (const adapterPath of adapterPaths) {
    const module = await import(pathToFileURL(path.resolve(adapterPath)).href)
    const adapter = module.default ?? module.adapter
    if (!adapter || typeof adapter !== 'object') throw new Error(`Adapter 无效：${adapterPath}`)
    adapters.push(adapter)
  }
  return adapters
}

export function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}
