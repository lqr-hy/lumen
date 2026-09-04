import { parentPort } from 'node:worker_threads'
import { normalizeRasterForTarget } from './raster-analysis.mjs'

if (!parentPort) throw new Error('Raster Worker 缺少 parentPort。')

parentPort.once('message', (message) => {
  try {
    const result = normalizeRasterForTarget(
      Buffer.from(message.buffer),
      message.mime,
      message.target,
      message.options,
    )
    const output = Uint8Array.from(result.buffer)
    parentPort.postMessage(
      {
        ok: true,
        buffer: output,
        mime: result.mime,
        analysis: result.analysis,
      },
      [output.buffer],
    )
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    })
  }
})
