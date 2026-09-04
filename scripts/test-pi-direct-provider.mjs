import assert from 'node:assert/strict'
import http from 'node:http'
import { requestProvider } from '../electron/runtime/request.mjs'

const requests = []
const server = http.createServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    requests.push({
      url: request.url,
      headers: request.headers,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    })
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const events = requests.length === 1 ? createResponseEvents() : []
    for (const event of events) {
      response.write(`event: ${event.type}\n`)
      response.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    if (events.length) response.write('data: [DONE]\n\n')
    response.end()
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const previousBaseUrl = process.env.AICODING_BASE_URL
const previousApiKey = process.env.AICODING_API_KEY
process.env.AICODING_BASE_URL = `http://127.0.0.1:${address.port}/api/v1/codex`
process.env.AICODING_API_KEY = 'pi-direct-test-key'

try {
  const tokens = []
  const result = await requestProvider(
    {
      type: 'chat',
      provider: 'codex',
      model: 'gpt-5.6-sol',
      sessionId: 'pi-direct-session',
      question: '测试 Pi Provider 直连',
    },
    {
      onToken: (token) => tokens.push(token),
    },
  )

  assert.equal(result.text, 'Pi Direct 正常回复。')
  assert.equal(tokens.join(''), result.text)
  assert.equal(requests.length, 1)
  const [captured] = requests
  assert.equal(captured.url, '/api/v1/codex/responses')
  assert.equal(captured.headers.authorization, 'Bearer pi-direct-test-key')
  assert.equal(captured.headers['session-id'], 'pi-direct-session')
  assert.equal(captured.headers['x-client-request-id'], 'pi-direct-session')
  assert.equal(captured.headers['openai-beta'], 'responses=experimental')
  assert.equal(captured.headers.originator, 'pi')
  assert.equal(captured.body.model, 'gpt-5.6-sol')
  assert.equal(captured.body.stream, true)
  assert.equal(captured.body.store, false)
  assert.equal(captured.body.text.verbosity, 'low')
  assert.equal(captured.body.tool_choice, 'auto')
  assert.equal(captured.body.parallel_tool_calls, true)
  assert(captured.body.include.includes('reasoning.encrypted_content'))
  assert.match(captured.body.instructions, /Studio 助手/)
  assert(!captured.body.input.some((item) => ['system', 'developer'].includes(item.role)))
  assert(captured.body.input.some((item) => item.role === 'user'))

  await assert.rejects(
    () =>
      requestProvider({
        type: 'chat',
        provider: 'codex',
        model: 'gpt-5.6-sol',
        sessionId: 'pi-empty-session',
        question: '测试空 SSE 不得伪造成功',
      }),
    /推理网关没有返回有效内容|gateway_empty_response/,
  )

  console.log(
    JSON.stringify(
      {
        piDirectUrl: true,
        piDirectApiKey: true,
        piDirectSessionHeaders: true,
        piDirectCodexPayload: true,
        piDirectSse: true,
        terminalEventRequired: true,
        emptyStreamRejected: true,
      },
      null,
      2,
    ),
  )
} finally {
  await new Promise((resolve) => server.close(resolve))
  if (previousBaseUrl === undefined) delete process.env.AICODING_BASE_URL
  else process.env.AICODING_BASE_URL = previousBaseUrl
  if (previousApiKey === undefined) delete process.env.AICODING_API_KEY
  else process.env.AICODING_API_KEY = previousApiKey
}

function createResponseEvents() {
  const message = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'Pi Direct 正常回复。', annotations: [] }],
  }
  return [
    {
      type: 'response.created',
      response: { id: 'resp_1', status: 'in_progress', output: [] },
    },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...message, status: 'in_progress', content: [] },
    },
    {
      type: 'response.output_text.delta',
      output_index: 0,
      content_index: 0,
      delta: 'Pi Direct 正常回复。',
    },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: message,
    },
    {
      type: 'response.completed',
      response: {
        id: 'resp_1',
        status: 'completed',
        output: [message],
        usage: {
          input_tokens: 12,
          output_tokens: 6,
          total_tokens: 18,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    },
  ]
}
