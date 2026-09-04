import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

let artifactsRoot

export function configureArtifactRepository(userDataRoot) {
  artifactsRoot = path.join(userDataRoot, 'artifacts')
}

export async function writeArtifact(input) {
  assertConfigured()
  if (!input || typeof input.content !== 'string') throw new Error('Artifact 内容无效。')
  const contentHash = crypto.createHash('sha256').update(input.content).digest('hex')
  const artifactId = input.id || `artifact-${input.kind || 'text'}-${contentHash}`
  const directory = getArtifactDirectory(artifactId)
  const extension = extensionForKind(input.kind)
  const contentPath = path.join(directory, `content.${extension}`)
  const metadata = {
    id: artifactId,
    projectId: input.projectId,
    runId: input.runId,
    kind: input.kind || 'text',
    name: input.name || `artifact.${extension}`,
    contentHash,
    byteLength: Buffer.byteLength(input.content),
    ...(typeof input.mime === 'string' ? { mime: input.mime } : {}),
    ...(Number.isFinite(input.width) ? { width: input.width } : {}),
    ...(Number.isFinite(input.height) ? { height: input.height } : {}),
    ...(input.analysis && typeof input.analysis === 'object' ? { analysis: input.analysis } : {}),
    createdAt: new Date().toISOString(),
  }
  await fs.mkdir(directory, { recursive: true })
  await writeAtomic(contentPath, input.content)
  await writeAtomic(path.join(directory, 'metadata.json'), JSON.stringify(metadata))
  return metadata
}

export async function readArtifact(artifactId) {
  assertConfigured()
  const directory = getArtifactDirectory(artifactId)
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'metadata.json'), 'utf8'))
    const content = await fs.readFile(
      path.join(directory, `content.${extensionForKind(metadata.kind)}`),
      'utf8',
    )
    return { ...metadata, content }
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

function getArtifactDirectory(artifactId) {
  const digest = crypto.createHash('sha256').update(String(artifactId)).digest('hex')
  return path.join(artifactsRoot, digest)
}

function extensionForKind(kind) {
  if (kind === 'svg') return 'svg'
  if (kind === 'json') return 'json'
  if (kind === 'raster') return 'b64'
  return 'txt'
}

async function writeAtomic(filePath, content) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temporaryPath, content, 'utf8')
  await fs.rename(temporaryPath, filePath)
}

function assertConfigured() {
  if (!artifactsRoot) throw new Error('Artifact Repository 尚未配置。')
}
