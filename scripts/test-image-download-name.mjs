import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

// 直接编译 TS 源码取出被测函数，避免为一个纯函数引入前端测试运行器。
const sourcePath = path.resolve(
  import.meta.dirname,
  '../src/features/editor/utils/image-file.ts',
)
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`
const { buildImageDownloadName } = await import(moduleUrl)

// AI 素材的元素名本身就带 .png（request.mjs 的 artifact name），
// 追加扩展名会产出 "AI 生成素材.png.jpg" 这种双扩展名，且与真实编码格式矛盾。
assert.equal(buildImageDownloadName('AI 生成素材.png', 'jpg'), 'AI 生成素材.jpg')
assert.equal(buildImageDownloadName('AI 生成素材.png', 'png'), 'AI 生成素材.png')
assert.equal(buildImageDownloadName('独立素材.png', 'png'), '独立素材.png')

// 大小写和其他图片扩展名同样要剥掉。
assert.equal(buildImageDownloadName('封面.PNG', 'jpg'), '封面.jpg')
assert.equal(buildImageDownloadName('照片.jpeg', 'png'), '照片.png')
assert.equal(buildImageDownloadName('图标.webp', 'png'), '图标.png')
assert.equal(buildImageDownloadName('矢量.svg', 'png'), '矢量.png')

// 没有扩展名时直接补。
assert.equal(buildImageDownloadName('页面视觉外壳', 'png'), '页面视觉外壳.png')

// @2x 后缀必须在扩展名之前。
assert.equal(buildImageDownloadName('AI 生成素材.png', 'png', '@2x'), 'AI 生成素材@2x.png')

// 只有结尾的扩展名被剥离，名字中间的点要保留。
assert.equal(buildImageDownloadName('v1.2 主视觉.png', 'png'), 'v1.2 主视觉.png')

// 文件系统非法字符要替换，避免下载失败。
assert.equal(buildImageDownloadName('a/b:c*d?.png', 'png'), 'a-b-c-d-.png')

// 空名字和纯扩展名要回退到默认名，不能产出 ".png" 这种隐藏文件。
assert.equal(buildImageDownloadName('', 'png'), 'canvas-image.png')
assert.equal(buildImageDownloadName('   ', 'jpg'), 'canvas-image.jpg')
assert.equal(buildImageDownloadName('.png', 'png'), 'canvas-image.png')

const results = {
  stripsExistingExtension: true,
  matchesActualFormat: true,
  caseInsensitive: true,
  scaleSuffixBeforeExtension: true,
  preservesInnerDots: true,
  sanitizesIllegalChars: true,
  emptyNameFallback: true,
}
fs.writeFileSync('/tmp/download-name-results.json', JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
