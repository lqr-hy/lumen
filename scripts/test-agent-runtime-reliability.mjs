import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { cancelAgentRun, runAgent } from '../electron/runtime/agent.mjs'
import {
  configureAgentSessionStore,
  loadAgentSession,
} from '../electron/runtime/agent-session-store.mjs'
import {
  configureProjectRepository,
  deleteProject,
  listProjects,
  listProjectVersions,
  loadProjectVersion,
  loadProjectSnapshot,
  saveProjectSnapshot,
} from '../electron/projects/project-repository.mjs'
import {
  configureArtifactRepository,
  readArtifact,
  writeArtifact,
} from '../electron/artifacts/artifact-repository.mjs'

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-campaign-reliability-'))
configureAgentSessionStore(testRoot)
configureProjectRepository(testRoot)
configureArtifactRepository(testRoot)

const blueprint = {
  version: 1,
  mode: 'new-artboard',
  canvas: { width: 375, estimatedHeight: 812 },
  theme: { colors: ['#ffffff'], visualStyle: 'clean' },
  sections: [{
    id: 'main',
    type: 'content',
    purpose: '主要内容',
    estimatedHeight: 812,
    source: 'prompt',
  }],
  constraints: { prototypeIsStructureSource: false, forbiddenAdditions: [] },
}
const validSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="375" height="812" viewBox="0 0 375 812">',
  '<rect width="375" height="812" fill="#fff"/>',
  '<rect x="20" y="40" width="335" height="220" fill="#111827"/>',
  '<text x="32" y="100" font-size="28">活动标题</text>',
  '<path d="M20 300h335v400H20z" fill="#eee"/>',
  '</svg>',
].join('')
const canvasTarget = {
  artboardId: 'board-reliability',
  createdForThread: true,
  width: 375,
  height: 812,
  placementMode: 'new-artboard',
  placementSource: 'prompt',
}

try {
  await testProjectRepository()
  await testCheckpointResume()
  await testCancellation()
  console.log(JSON.stringify({
    projectPersistence: true,
    artifactPersistence: true,
    checkpointResume: true,
    cancellation: true,
  }, null, 2))
} finally {
  await fs.rm(testRoot, { recursive: true, force: true })
}

async function testProjectRepository() {
  const now = new Date().toISOString()
  const document = {
    id: 'project-reliability',
    title: '可靠性测试',
    version: 1,
    artboards: [],
    elements: [],
    assets: [{
      id: 'asset-content-addressed',
      type: 'image',
      name: 'pixel.png',
      src: 'data:image/png;base64,iVBORw0KGgo=',
    }],
    createdAt: now,
    updatedAt: now,
  }
  await saveProjectSnapshot({
    projectId: document.id,
    document,
    chatThreads: [],
    activeChatThreadId: 'panel-thread-default',
  })
  const loaded = await loadProjectSnapshot(document.id)
  assert.equal(loaded?.document.title, document.title)
  assert.equal(loaded?.document.assets[0].src, document.assets[0].src)
  const projectDirectories = await fs.readdir(path.join(testRoot, 'projects'))
  const persistedProject = await fs.readFile(
    path.join(testRoot, 'projects', projectDirectories[0], 'project.json'),
    'utf8',
  )
  assert.equal(persistedProject.includes('data:image'), false, '项目 JSON 不应内嵌 Data URI')
  assert.equal(persistedProject.includes('sha256:'), true, '项目 JSON 应使用内容寻址素材引用')
  assert.equal((await listProjects()).some((project) => project.projectId === document.id), true)
  const versions = await listProjectVersions(document.id)
  assert.equal(versions.length, 1)
  assert.equal((await loadProjectVersion(document.id, versions[0].id))?.document.title, document.title)

  const artifact = await writeArtifact({
    projectId: document.id,
    runId: 'run-reliability',
    kind: 'svg',
    name: 'test.svg',
    content: validSvg,
  })
  assert.equal((await readArtifact(artifact.id))?.content, validSvg)
  const duplicateArtifact = await writeArtifact({
    projectId: document.id,
    runId: 'run-reliability-duplicate',
    kind: 'svg',
    name: 'duplicate.svg',
    content: validSvg,
  })
  assert.equal(duplicateArtifact.id, artifact.id, '相同 Artifact 内容应复用 SHA-256 ID')
  const rasterArtifact = await writeArtifact({
    projectId: document.id,
    runId: 'run-raster',
    kind: 'raster',
    name: 'generated.png',
    content: 'iVBORw0KGgo=',
    mime: 'image/png',
    width: 1024,
    height: 1536,
  })
  const loadedRaster = await readArtifact(rasterArtifact.id)
  assert.equal(loadedRaster?.kind, 'raster')
  assert.equal(loadedRaster?.mime, 'image/png')
  assert.equal(loadedRaster?.width, 1024)
  assert.equal(loadedRaster?.height, 1536)
  assert.equal(loadedRaster?.content, 'iVBORw0KGgo=')
  await deleteProject(document.id)
  assert.equal(await loadProjectSnapshot(document.id), undefined)
}

async function testCheckpointResume() {
  const sessionId = 'checkpoint-resume-session'
  let blueprintCalls = 0
  let imageCalls = 0
  const invokeProvider = async (payload) => {
    if (payload.type === 'generate_blueprint') {
      blueprintCalls += 1
      return { blueprint }
    }
    if (payload.type === 'generate_image') {
      imageCalls += 1
      if (imageCalls <= 2) throw new Error('模拟图片 Provider 失败')
      return { artifact: { kind: 'svg', name: 'resume.svg', content: validSvg } }
    }
    throw new Error(`未预期请求：${payload.type}`)
  }
  await assert.rejects(() => runAgent({
    type: 'agent_run',
    sessionId,
    projectId: 'project-reliability',
    provider: 'codex',
    model: 'test',
    question: '生成一张页面设计图',
    uploads: [],
    canvasTarget,
  }, {}, { invokeProvider }))

  const result = await runAgent({
    type: 'agent_run',
    sessionId,
    projectId: 'project-reliability',
    provider: 'codex',
    model: 'test',
    question: '重试',
    uploads: [],
    canvasTarget,
  }, {}, { invokeProvider })
  assert.equal(result.agent.status, 'completed')
  assert.equal(result.agent.plan.every((step) => step.inputHash && step.outputHash), true)
  assert.equal(blueprintCalls, 1, '重试不应重新生成已有 Blueprint')
  assert.equal(imageCalls, 3, '重试应从失败的图片生成 Step 继续')
}

async function testCancellation() {
  const sessionId = 'cancel-session'
  let notifyStarted
  const started = new Promise((resolve) => {
    notifyStarted = resolve
  })
  const running = runAgent({
    type: 'agent_run',
    sessionId,
    projectId: 'project-reliability',
    provider: 'codex',
    model: 'test',
    question: '生成一张页面设计图',
    uploads: [],
    canvasTarget,
  }, {}, {
    invokeProvider: async (payload) => {
      if (payload.type !== 'generate_blueprint') throw new Error(`未预期请求：${payload.type}`)
      notifyStarted()
      return new Promise((resolve, reject) => {
        payload.signal.addEventListener('abort', () => reject(payload.signal.reason), { once: true })
      })
    },
  })
  await started
  assert.equal(cancelAgentRun(sessionId), true)
  await assert.rejects(running, (error) => error?.code === 'AGENT_CANCELLED')
  assert.equal((await loadAgentSession(sessionId)).status, 'cancelled')
}
