import assert from 'node:assert/strict'
import http from 'node:http'
import { PNG } from 'pngjs'
import { getPublicRuntimeState } from '../electron/runtime/env.mjs'
import { requestProvider } from '../electron/runtime/request.mjs'

const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+Xw7JAAAAAElFTkSuQmCC'
const jpegBase64 = '/9j/2Q=='
const transparentMask = new PNG({ width: 1, height: 1 })
transparentMask.data.set([0, 0, 0, 0])
const maskBase64 = PNG.sync.write(transparentMask).toString('base64')
const validBase = new PNG({ width: 1, height: 1 })
validBase.data.set([255, 0, 0, 255])
const validBase64 = PNG.sync.write(validBase).toString('base64')
const mismatchedMask = new PNG({ width: 2, height: 1 })
const mismatchedMaskBase64 = PNG.sync.write(mismatchedMask).toString('base64')
const requests = []
let nextImageBase64 = pngBase64
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
    response.end(JSON.stringify({ data: [{ b64_json: nextImageBase64 }] }))
    nextImageBase64 = pngBase64
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const previousBaseUrl = process.env.IMAGE_BASE_URL
const previousApiKey = process.env.IMAGE_API_KEY
process.env.IMAGE_BASE_URL = `http://127.0.0.1:${address.port}/v1`
process.env.IMAGE_API_KEY = 'test-image-key'

try {
  const generated = await requestProvider({
    type: 'generate_image',
    provider: 'codex',
    model: 'gpt-5.6-sol',
    imageProvider: 'image',
    imageModel: 'gpt-image-2',
    question: '生成黄色活动 KV',
    imageTasks: [
      {
        id: 'kv',
        name: 'kv.png',
        targetSize: { width: 375, height: 812 },
        transparent: false,
        prompt: '黄色活动 KV',
      },
    ],
  })
  assert.equal(generated.artifact.kind, 'raster')
  assert.equal(generated.artifact.mime, 'image/png')
  assert.equal(requests[0].url, '/v1/images/generations')
  assert.equal(requests[0].authorization, 'Bearer test-image-key')
  assert.equal(JSON.parse(requests[0].body.toString()).model, 'gpt-image-2')

  await requestProvider({
    type: 'generate_image',
    imageProvider: 'image',
    imageModel: 'nano-banana-pro',
    question: '生成另一个 KV 版本',
    imageTasks: [
      {
        id: 'kv-nano',
        name: 'kv-nano.png',
        targetSize: { width: 375, height: 812 },
        transparent: false,
      },
    ],
  })
  assert.equal(requests[1].url, '/v1/images/generations')
  assert.equal(JSON.parse(requests[1].body.toString()).model, 'nano-banana-pro')

  const assets = await requestProvider({
    type: 'generate_assets',
    provider: 'codex',
    model: 'gpt-5.6-sol',
    imageProvider: 'image',
    imageModel: 'gpt-image-2',
    question: '生成两个独立按钮底图',
    imageTasks: [
      { id: 'one', name: 'one.png', targetSize: { width: 180, height: 64 }, transparent: true },
      { id: 'ten', name: 'ten.png', targetSize: { width: 180, height: 64 }, transparent: true },
    ],
  })
  assert.equal(assets.artifacts.length, 2)
  assert.deepEqual(
    assets.artifacts.map((artifact) => artifact.name),
    ['one.png', 'ten.png'],
  )
  const firstAssetBody = JSON.parse(requests[2].body.toString())
  assert.equal(firstAssetBody.background, undefined)
  assert.equal(firstAssetBody.output_format, 'png')
  assert.match(firstAssetBody.prompt, /#00ff00 色键背景/)
  assert.match(firstAssetBody.prompt, /转换成真实透明 Alpha/)

  await requestProvider({
    type: 'generate_assets',
    imageProvider: 'image',
    imageModel: 'gpt-image-2',
    question: '参考 KV 生成按钮',
    uploads: [
      {
        name: 'kv.png',
        mime: 'image/png',
        data: `data:image/png;base64,${pngBase64}`,
      },
    ],
    imageTasks: [
      { id: 'edit', name: 'edit.png', targetSize: { width: 180, height: 64 }, transparent: true },
    ],
  })
  assert.equal(requests.at(-1).url, '/v1/images/edits')
  assert.match(requests.at(-1).contentType, /^multipart\/form-data;/)
  assert.doesNotMatch(requests.at(-1).body.toString(), /name="background"/)
  assert.match(requests.at(-1).body.toString(), /#00ff00/)

  await requestProvider({
    type: 'generate_image',
    imageProvider: 'image',
    imageModel: 'gpt-image-2',
    question: '全局主题：黄色 KV，thumbnail 只负责结构。',
    uploads: [
      { name: 'kv.png', mime: 'image/png', role: 'kv', data: `data:image/png;base64,${pngBase64}` },
      {
        name: 'prototype.png',
        mime: 'image/png',
        role: 'prototype',
        data: `data:image/png;base64,${pngBase64}`,
      },
    ],
    imageTasks: [
      {
        id: 'policy',
        name: 'policy.png',
        targetSize: { width: 180, height: 64 },
        transparent: true,
        prompt: '只生成抽一次按钮。',
        referencePolicy: {
          roles: ['kv'],
          maxImages: 1,
          transparentFallback: 'theme-only-generation',
        },
      },
    ],
  })
  assert.equal(requests.at(-1).url, '/v1/images/generations')
  const policyBody = requests.at(-1).body.toString()
  assert.match(policyBody, /全局主题：黄色 KV/)
  assert.match(policyBody, /只生成抽一次按钮/)
  assert.equal(JSON.parse(policyBody).background, undefined)
  assert.match(policyBody, /#00ff00 色键背景/)
  assert.doesNotMatch(policyBody, /filename="kv.png"/)
  assert.doesNotMatch(policyBody, /filename="prototype.png"/)

  nextImageBase64 = validBase64
  await requestProvider({
    type: 'generate_image',
    imageProvider: 'image',
    imageModel: 'gpt-image-2',
    question: '只修改透明 Mask 区域。',
    uploads: [
      {
        name: 'base.png',
        mime: 'image/png',
        role: 'edit-base',
        data: `data:image/png;base64,${validBase64}`,
      },
      {
        name: 'mask.png',
        mime: 'image/png',
        role: 'mask',
        data: `data:image/png;base64,${maskBase64}`,
      },
    ],
    imageTasks: [
      {
        id: 'masked-edit',
        name: 'masked-edit.png',
        targetSize: { width: 1, height: 1 },
        transparent: false,
        maskedEdit: true,
        referencePolicy: { roles: ['edit-base', 'mask'], maxImages: 2 },
      },
    ],
  })
  const maskRequestBody = requests.at(-1).body.toString()
  assert.match(maskRequestBody, /name="mask"; filename="mask.png"/)
  assert.match(maskRequestBody, /name="image\[\]"; filename="base.png"/)

  await assert.rejects(
    requestProvider({
      type: 'generate_image',
      imageProvider: 'image',
      imageModel: 'gpt-image-2',
      question: '缺少 Mask 时禁止降级。',
      uploads: [
        {
          name: 'base.png',
          mime: 'image/png',
          role: 'edit-base',
          data: `data:image/png;base64,${pngBase64}`,
        },
      ],
      imageTasks: [{ id: 'missing-mask', targetSize: { width: 1, height: 1 }, maskedEdit: true }],
    }),
    (error) => error?.code === 'IMAGE_MASK_INPUT_MISSING',
  )
  await assert.rejects(
    requestProvider({
      type: 'generate_image',
      imageProvider: 'image',
      imageModel: 'gpt-image-2',
      question: '尺寸不一致时禁止请求。',
      uploads: [
        {
          name: 'base.png',
          mime: 'image/png',
          role: 'edit-base',
          data: `data:image/png;base64,${validBase64}`,
        },
        {
          name: 'mask.png',
          mime: 'image/png',
          role: 'mask',
          data: `data:image/png;base64,${mismatchedMaskBase64}`,
        },
      ],
      imageTasks: [
        { id: 'mismatched-mask', targetSize: { width: 1, height: 1 }, maskedEdit: true },
      ],
    }),
    (error) => error?.code === 'IMAGE_MASK_SIZE_MISMATCH',
  )

  nextImageBase64 = jpegBase64
  await assert.rejects(
    requestProvider({
      type: 'generate_image',
      imageProvider: 'image',
      imageModel: 'gpt-image-2',
      question: '模拟 Provider 违约返回 JPEG',
      imageTasks: [
        { id: 'jpeg-output', name: 'jpeg-output.png', targetSize: { width: 375, height: 812 } },
      ],
    }),
    (error) => error?.code === 'IMAGE_OUTPUT_FORMAT_INVALID',
  )

  const publicState = getPublicRuntimeState()
  const imageProvider = publicState.providers.find((provider) => provider.id === 'image')
  assert.equal(imageProvider?.hasApiKey, true)
  assert.deepEqual(imageProvider?.models, ['gpt-image-2', 'nano-banana-pro'])
  assert.equal(JSON.stringify(publicState).includes('test-image-key'), false)
  console.log(
    JSON.stringify(
      {
        generations: true,
        sharedImageModels: true,
        edits: true,
        multiAssetTasks: true,
        rasterArtifact: true,
        rendererKeyIsolation: true,
        mergedPrompt: true,
        taskReferencePolicy: true,
        nonPngOutputRejected: true,
        maskedEditMultipart: true,
        missingMaskCannotDowngrade: true,
        mismatchedMaskRejected: true,
      },
      null,
      2,
    ),
  )
} finally {
  await new Promise((resolve) => server.close(resolve))
  if (previousBaseUrl === undefined) delete process.env.IMAGE_BASE_URL
  else process.env.IMAGE_BASE_URL = previousBaseUrl
  if (previousApiKey === undefined) delete process.env.IMAGE_API_KEY
  else process.env.IMAGE_API_KEY = previousApiKey
}
