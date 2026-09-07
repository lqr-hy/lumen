import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-campaign-inspector-schema-'))
const bundle = path.join(root, 'inspector-schema.mjs')

try {
  await build({
    stdin: {
      contents:
        "export { resolveElementInspectorSchema } from './src/features/editor/inspector/inspector-schema.ts'",
      resolveDir: process.cwd(),
      sourcefile: 'inspector-schema-test-entry.ts',
    },
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
  })
  const { resolveElementInspectorSchema } = await import(
    `${pathToFileURL(bundle).href}?t=${Date.now()}`
  )
  const button = {
    id: 'button',
    type: 'button',
    name: '查询',
    content: '查询',
    x: 20,
    y: 20,
    width: 80,
    height: 36,
    zIndex: 2,
    style: { background: '#2563eb', color: '#fff', fontSize: 14 },
  }
  const parent = {
    id: 'parent',
    type: 'section',
    name: '容器',
    label: '容器',
    x: 0,
    y: 0,
    width: 400,
    height: 200,
    zIndex: 1,
  }
  const context = { update() {}, setAutoLayout() {} }

  let uploadedImage
  const imageSchema = resolveElementInspectorSchema(
    {
      id: 'image',
      type: 'image',
      name: '主图',
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      zIndex: 2,
      src: 'https://example.com/old.png',
    },
    {
      ...context,
      replaceImage(image) {
        uploadedImage = image
      },
    },
  )
  const imageUploadField = imageSchema
    .find((section) => section.id === 'image')
    .fields.find((field) => field.id === 'preview')
  imageUploadField.onImageUpload({
    name: 'new.png',
    src: 'data:image/png;base64,AA==',
    mimeType: 'image/png',
    bytes: 1,
  })
  assert.equal(uploadedImage.name, 'new.png')
  assert.equal(uploadedImage.src, 'data:image/png;base64,AA==')

  const standalone = resolveElementInspectorSchema(button, context)
  const standaloneLayout = standalone.find((section) => section.id === 'layout').fields
  assert.equal(
    standaloneLayout.some((field) => field.label.includes('锚点')),
    false,
  )
  assert.equal(
    standaloneLayout
      .find((field) => field.id === 'widthMode')
      .options.find((item) => item.value === 'fill').disabled,
    true,
  )

  const responsiveAbsolute = resolveElementInspectorSchema(
    { ...button, parentId: parent.id },
    { ...context, parent, responsive: true },
  )
  const responsiveLayout = responsiveAbsolute.find((section) => section.id === 'layout').fields
  assert.equal(responsiveLayout.filter((field) => field.label.includes('锚点')).length, 2)
  assert.equal(
    responsiveLayout.find((field) => field.id === 'constraints').options.at(-1).label,
    '左右固定',
  )
  assert.equal(
    responsiveLayout.find((field) => field.id === 'verticalConstraints').options.at(-1).label,
    '上下固定',
  )

  const autoParent = {
    ...parent,
    autoLayout: {
      direction: 'horizontal',
      gap: 8,
      padding: { top: 8, right: 8, bottom: 8, left: 8 },
      align: 'center',
      justify: 'start',
    },
  }
  const autoChild = resolveElementInspectorSchema(
    { ...button, parentId: autoParent.id },
    { ...context, parent: autoParent, responsive: true },
  )
  const autoLayoutFields = autoChild.find((section) => section.id === 'layout').fields
  assert.equal(
    autoLayoutFields.some((field) => field.id === 'x' || field.id === 'y'),
    false,
  )
  assert.equal(
    autoLayoutFields.some((field) => field.label.includes('锚点')),
    false,
  )
  assert.equal(
    autoLayoutFields
      .find((field) => field.id === 'widthMode')
      .options.find((item) => item.value === 'fill').disabled,
    false,
  )

  const hugButton = {
    ...button,
    layoutSizing: { widthMode: 'hug', heightMode: 'fixed', minWidth: 64 },
  }
  const ordinaryHug = resolveElementInspectorSchema(hugButton, context)
  assert.equal(
    ordinaryHug.some((section) => section.id === 'size-constraints'),
    false,
  )
  const responsiveHug = resolveElementInspectorSchema(hugButton, { ...context, responsive: true })
  const advanced = responsiveHug.find((section) => section.id === 'size-constraints')
  assert.equal(advanced.title, '高级尺寸')
  assert.equal(advanced.defaultOpen, true)
  let sizingPatch
  const fixedSchema = resolveElementInspectorSchema(hugButton, {
    ...context,
    responsive: true,
    update(patch) {
      sizingPatch = patch
    },
  })
  fixedSchema
    .find((section) => section.id === 'layout')
    .fields.find((field) => field.id === 'widthMode')
    .onChange('fixed')
  assert.equal(sizingPatch.layoutSizing.widthMode, 'fixed')
  assert.equal(sizingPatch.layoutSizing.minWidth, undefined)
  assert.equal(sizingPatch.layoutSizing.maxWidth, undefined)

  console.log(
    JSON.stringify(
      {
        contextualAnchors: true,
        clearConstraintLabels: true,
        contextualFill: true,
        autoLayoutCoordinatesHidden: true,
        responsiveSizeLimitsOnly: true,
        fixedModeClearsLimits: true,
        imageUploadWired: true,
      },
      null,
      2,
    ),
  )
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
