import { Worker } from 'node:worker_threads'
import { normalizeRasterForTarget } from './raster-analysis.mjs'

const DEFAULT_TIMEOUT_MS = 20_000

export async function normalizeRasterForTargetAsync(buffer, mime, target, options = {}) {
  if (options.signal?.aborted) throw createAbortError()
  const workerOptions = {
    transparent: options.transparent === true,
    chromaKey: typeof options.chromaKey === 'string' ? options.chromaKey : undefined,
    fitMode: options.fitMode === 'fill-content' ? 'fill-content' : undefined,
  }
  try {
    return await runRasterWorker(buffer, mime, target, workerOptions, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    })
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'RasterWorkerTimeoutError') throw error
    console.warn('[runtime] raster worker unavailable, using synchronous fallback:', error)
    return normalizeRasterForTarget(buffer, mime, target, workerOptions)
  }
}

function runRasterWorker(buffer, mime, target, options, control) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./raster-worker.mjs', import.meta.url))
    const timeoutMs = positiveTimeout(control.timeoutMs)
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      control.signal?.removeEventListener('abort', abort)
      void worker.terminate()
      callback(value)
    }
    const abort = () => finish(reject, createAbortError())
    const timer = setTimeout(() => {
      const error = new Error(`Raster Worker 处理超过 ${timeoutMs}ms。`)
      error.name = 'RasterWorkerTimeoutError'
      finish(reject, error)
    }, timeoutMs)

    control.signal?.addEventListener('abort', abort, { once: true })
    if (control.signal?.aborted) {
      abort()
      return
    }
    worker.once('message', (message) => {
      if (!message?.ok) {
        const error = new Error(message?.error?.message || 'Raster Worker 处理失败。')
        error.name = message?.error?.name || 'Error'
        if (message?.error?.stack) error.stack = message.error.stack
        finish(reject, error)
        return
      }
      finish(resolve, {
        buffer: Buffer.from(message.buffer),
        mime: message.mime,
        analysis: message.analysis,
      })
    })
    worker.once('error', (error) => finish(reject, error))
    worker.once('exit', (code) => {
      if (!settled) finish(reject, new Error(`Raster Worker 未返回结果即退出：${code}。`))
    })

    const input = Uint8Array.from(buffer)
    worker.postMessage({ buffer: input, mime, target, options }, [input.buffer])
  })
}

function positiveTimeout(value) {
  const timeout = Number(value)
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS
}

function createAbortError() {
  const error = new Error('Raster 处理已取消。')
  error.name = 'AbortError'
  return error
}
