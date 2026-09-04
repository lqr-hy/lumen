import * as prettier from 'prettier/standalone'
import * as babelPlugin from 'prettier/plugins/babel'
import * as estreePlugin from 'prettier/plugins/estree'
import * as htmlPlugin from 'prettier/plugins/html'
import * as postcssPlugin from 'prettier/plugins/postcss'
import * as typescriptPlugin from 'prettier/plugins/typescript'
import type { CodeDocument, CodeFile } from './types'

const plugins = [babelPlugin, estreePlugin, htmlPlugin, postcssPlugin, typescriptPlugin]

export async function formatCodeDocument(document: CodeDocument): Promise<CodeDocument> {
  const diagnostics = [...document.diagnostics]
  const files: CodeFile[] = []
  for (const file of document.files) {
    try {
      files.push({ ...file, content: await formatCodeFile(file) })
    } catch (error) {
      diagnostics.push({
        code: 'CODE_FORMAT_FALLBACK',
        severity: 'warning',
        message: `文件 ${file.path} 格式化失败，已保留原始输出：${formatErrorMessage(error)}`,
        path: file.path,
      })
      files.push(file)
    }
  }
  return { ...document, files, diagnostics }
}

function formatErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '未知错误'
  return message.replace(/\s+/g, ' ').slice(0, 240)
}

async function formatCodeFile(file: CodeFile) {
  const parser = file.language === 'html' ? 'html'
    : file.language === 'vue' ? 'vue'
      : file.language === 'css' ? 'css'
        : file.language === 'tsx' ? 'typescript'
          : file.language === 'json' ? 'json-stringify'
            : file.language === 'ts' ? 'typescript' : undefined
  if (!parser) return file.content
  return prettier.format(file.content, {
    parser,
    plugins,
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 100,
  })
}
