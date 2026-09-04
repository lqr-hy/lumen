const apiKey = process.env.AICODING_API_KEY
const baseUrl = process.env.AICODING_BASE_URL || 'http://api-ai-coding.bilibili.co/api/v1/codex'
const model = process.env.AICODING_MODEL || 'gpt-5.5'
const prompt = process.env.AICODING_PROBE_PROMPT || '你好，请回复一句话。'

if (!apiKey) {
  console.error('Missing AICODING_API_KEY')
  process.exit(1)
}

const sessionId = crypto.randomUUID()
const url = appendPath(baseUrl, 'responses')

const variants = [
  {
    name: 'responses-string-stream',
    body: {
      model,
      stream: true,
      store: false,
      input: prompt,
    },
  },
  {
    name: 'responses-string-non-stream',
    body: {
      model,
      stream: false,
      store: false,
      input: prompt,
    },
  },
  {
    name: 'responses-message-string',
    body: {
      model,
      stream: true,
      store: false,
      input: [{ role: 'user', content: prompt }],
    },
  },
  {
    name: 'responses-input-text',
    body: {
      model,
      stream: true,
      store: false,
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: prompt }],
        },
      ],
    },
  },
  {
    name: 'codex-question',
    body: {
      model,
      stream: true,
      streaming: true,
      question: prompt,
      session_id: sessionId,
    },
  },
]

for (const variant of variants) {
  const requestUrl = `${url}?session_id=${encodeURIComponent(sessionId)}`
  const startedAt = Date.now()
  try {
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json, text/plain',
        Authorization: `Bearer ${apiKey}`,
        session_id: sessionId,
        'x-session-id': sessionId,
      },
      body: JSON.stringify({
        session_id: sessionId,
        sessionId,
        ...variant.body,
      }),
    })
    const text = await response.text()
    console.log(
      JSON.stringify(
        {
          name: variant.name,
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get('content-type') || '',
          elapsedMs: Date.now() - startedAt,
          bodyLength: text.length,
          bodyPreview: text.slice(0, 1200),
        },
        null,
        2,
      ),
    )
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          name: variant.name,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    )
  }
}

function appendPath(value, path) {
  const cleanPath = path.replace(/^\/+/, '')
  if (value.endsWith(`/${cleanPath}`)) return value
  return `${value.replace(/\/+$/, '')}/${cleanPath}`
}
