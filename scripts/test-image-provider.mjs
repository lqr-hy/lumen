import assert from 'node:assert/strict'
import http from 'node:http'
import { getPublicRuntimeState } from '../electron/runtime/env.mjs'
import { requestProvider } from '../electron/runtime/request.mjs'

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+Xw7JAAAAAElFTkSuQmCC'
const requests = []
const server = http.createServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    const body = Buffer.concat(chunks)
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      contentType: request.headers['content-type'],
      body,
    })
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ data: [{ b64_json: pngBase64 }] }))
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const previousBaseUrl = process.env.BILI_IMAGE_BASE_URL
const previousApiKey = process.env.BILI_IMAGE_API_KEY
process.env.BILI_IMAGE_BASE_URL = `http://127.0.0.1:${address.port}/v1`
process.env.BILI_IMAGE_API_KEY = 'test-image-key'

try {
  const generated = await requestProvider({
    type: 'generate_image',
    provider: 'codex',
    model: 'gpt-5.6-sol',
    imageProvider: 'biliImage',
    imageModel: 'gpt-image-2',
    question: '生成黄色活动 KV',
    imageTasks: [{
      id: 'kv',
      name: 'kv.png',
      targetSize: { width: 375, height: 812 },
      transparent: false,
      prompt: '黄色活动 KV',
    }],
  })
  assert.equal(generated.artifact.kind, 'raster')
  assert.equal(generated.artifact.mime, 'image/png')
  assert.equal(requests[0].url, '/v1/images/generations')
  assert.equal(requests[0].authorization, 'Bearer test-image-key')
  assert.equal(JSON.parse(requests[0].body.toString()).model, 'gpt-image-2')

  await requestProvider({
    type: 'generate_image',
    imageProvider: 'biliImage',
    imageModel: 'nano-banana-pro',
    question: '生成另一个 KV 版本',
    imageTasks: [{
      id: 'kv-nano',
      name: 'kv-nano.png',
      targetSize: { width: 375, height: 812 },
      transparent: false,
    }],
  })
  assert.equal(requests[1].url, '/v1/images/generations')
  assert.equal(JSON.parse(requests[1].body.toString()).model, 'nano-banana-pro')

  const assets = await requestProvider({
    type: 'generate_assets',
    provider: 'codex',
    model: 'gpt-5.6-sol',
    imageProvider: 'biliImage',
    imageModel: 'gpt-image-2',
    question: '生成两个独立按钮底图',
    imageTasks: [
      { id: 'one', name: 'one.png', targetSize: { width: 180, height: 64 }, transparent: true },
      { id: 'ten', name: 'ten.png', targetSize: { width: 180, height: 64 }, transparent: true },
    ],
  })
  assert.equal(assets.artifacts.length, 2)
  assert.deepEqual(assets.artifacts.map((artifact) => artifact.name), ['one.png', 'ten.png'])

  await requestProvider({
    type: 'generate_assets',
    imageProvider: 'biliImage',
    imageModel: 'gpt-image-2',
    question: '参考 KV 生成按钮',
    uploads: [{
      name: 'kv.png',
      mime: 'image/png',
      data: `data:image/png;base64,${pngBase64}`,
    }],
    imageTasks: [{ id: 'edit', name: 'edit.png', targetSize: { width: 180, height: 64 }, transparent: true }],
  })
  assert.equal(requests.at(-1).url, '/v1/images/edits')
  assert.match(requests.at(-1).contentType, /^multipart\/form-data;/)

  const publicState = getPublicRuntimeState()
  const imageProvider = publicState.providers.find((provider) => provider.id === 'biliImage')
  assert.equal(imageProvider?.hasApiKey, true)
  assert.deepEqual(imageProvider?.models, ['gpt-image-2', 'nano-banana-pro'])
  assert.equal(JSON.stringify(publicState).includes('test-image-key'), false)
  console.log(JSON.stringify({
    generations: true,
    sharedImageModels: true,
    edits: true,
    multiAssetTasks: true,
    rasterArtifact: true,
    rendererKeyIsolation: true,
  }, null, 2))
} finally {
  await new Promise((resolve) => server.close(resolve))
  if (previousBaseUrl === undefined) delete process.env.BILI_IMAGE_BASE_URL
  else process.env.BILI_IMAGE_BASE_URL = previousBaseUrl
  if (previousApiKey === undefined) delete process.env.BILI_IMAGE_API_KEY
  else process.env.BILI_IMAGE_API_KEY = previousApiKey
}
