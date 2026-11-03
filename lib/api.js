/** HTTP API for the browser half. Mounted by index.js on the Harness web server. */
import fsp from 'node:fs/promises'

const PREFIX = '/api/paper-harness'

function sendJson(res, body, status = 200) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

function sendBuffer(res, buffer, type, status = 200, cache = 'no-cache') {
  res.statusCode = status
  res.setHeader('content-type', type)
  res.setHeader('content-length', String(buffer.length))
  res.setHeader('cache-control', cache)
  res.end(buffer)
}

async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

export function createApiHandler({ ops, llm, log = () => {} }) {
  function openStream(res) {
    res.statusCode = 200
    res.setHeader('content-type', 'text/event-stream; charset=utf-8')
    res.setHeader('cache-control', 'no-cache, no-transform')
    res.setHeader('connection', 'keep-alive')
    res.setHeader('x-accel-buffering', 'no')
    res.flushHeaders?.()
    let closed = false
    res.on?.('close', () => {
      closed = true
    })
    return {
      send(payload) {
        if (closed || res.writableEnded) return false
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
        return true
      },
      close() {
        if (closed || res.writableEnded) return
        closed = true
        res.write('data: [DONE]\n\n')
        res.end()
      },
      get closed() {
        return closed
      },
    }
  }

  async function streamChat(req, res, body) {
    const paper = ops.detail(String(body.paperId || ''))
    const question = String(body.question || '').trim()
    if (!question) {
      sendJson(res, { error: '问题不能为空' }, 400)
      return
    }
    const controller = new AbortController()
    req.on?.('close', () => controller.abort())
    const stream = openStream(res)
    try {
      for await (const delta of llm.chat({
        paper,
        history: Array.isArray(body.history) ? body.history : [],
        question,
        focus: body.focus || null,
        signal: controller.signal,
      })) {
        if (!stream.send({ delta })) break
      }
    } catch (error) {
      if (!error?.aborted) stream.send({ error: String(error?.message || error) })
    } finally {
      stream.close()
    }
  }

  async function streamTranslate(req, res, body) {
    const text = String(body.text || '').trim()
    if (!text) {
      sendJson(res, { error: '没有要翻译的内容' }, 400)
      return
    }
    const controller = new AbortController()
    req.on?.('close', () => controller.abort())
    const stream = openStream(res)
    try {
      for await (const delta of llm.translate(text.slice(0, 12000), { signal: controller.signal })) {
        if (!stream.send({ delta })) break
      }
    } catch (error) {
      if (!error?.aborted) stream.send({ error: String(error?.message || error) })
    } finally {
      stream.close()
    }
  }

  async function streamTranslatePaper(req, res, body) {
    const id = String(body.paperId || '')
    const controller = new AbortController()
    req.on?.('close', () => controller.abort())
    const stream = openStream(res)
    try {
      for await (const event of ops.translatePaper(id, {
        signal: controller.signal,
        from: body.from,
        to: body.to,
      })) {
        if (!stream.send(event)) break
      }
    } catch (error) {
      if (!error?.aborted) stream.send({ error: String(error?.message || error) })
    } finally {
      stream.close()
    }
  }

  return async function handle(req, res) {
    let url
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1')
    } catch {
      sendJson(res, { error: 'bad url' }, 400)
      return
    }
    const pathname = url.pathname
    if (!pathname.startsWith(PREFIX)) {
      sendJson(res, { error: 'not found' }, 404)
      return
    }
    const rest = pathname.slice(PREFIX.length) || '/'
    const parts = rest.split('/').filter(Boolean)
    const query = Object.fromEntries(url.searchParams.entries())
    const method = (req.method || 'GET').toUpperCase()

    try {
      if (method === 'POST' && parts[0] === 'chat') {
        await streamChat(req, res, await readBody(req))
        return
      }
      if (method === 'POST' && parts[0] === 'translate' && parts[1] === 'paper') {
        await streamTranslatePaper(req, res, await readBody(req))
        return
      }
      if (method === 'POST' && parts[0] === 'translate') {
        await streamTranslate(req, res, await readBody(req))
        return
      }
      if (method === 'GET' && parts[0] === 'translation' && parts[1]) {
        sendJson(res, await ops.translation(decodeURIComponent(parts[1])))
        return
      }
      if (method === 'POST' && parts[0] === 'translation' && parts[1] && parts[2] === 'clear') {
        sendJson(res, await ops.clearTranslation(decodeURIComponent(parts[1])))
        return
      }
      if (method === 'GET' && (rest === '/' || rest === '/state')) {
        sendJson(res, ops.state())
        return
      }
      if (method === 'GET' && parts[0] === 'papers') {
        sendJson(res, {
          items: ops.list({
            q: query.q || '',
            category: query.category || 'all',
            status: query.status || 'all',
            tag: query.tag || '',
            year: query.year || '',
            hasFigures: query.hasFigures === '1',
            limit: query.limit ? Number(query.limit) : undefined,
          }),
        })
        return
      }
      if (method === 'GET' && parts[0] === 'paper' && parts[1]) {
        sendJson(res, ops.detail(decodeURIComponent(parts[1])))
        return
      }
      if (method === 'POST' && parts[0] === 'paper' && parts[1] && !parts[2]) {
        const id = decodeURIComponent(parts[1])
        const body = await readBody(req)
        const updated = await ops.update(id, body.patch || body)
        sendJson(res, updated)
        return
      }
      if (method === 'POST' && parts[0] === 'paper' && parts[1] && parts[2] === 'reparse') {
        sendJson(res, await ops.reparse(decodeURIComponent(parts[1])))
        return
      }
      if (method === 'POST' && parts[0] === 'reindex') {
        sendJson(res, await ops.reindex())
        return
      }
      if (method === 'GET' && parts[0] === 'sources') {
        sendJson(res, await ops.online(query.q || '', query.source || 'all', query.limit ? Number(query.limit) : 12))
        return
      }
      if (method === 'POST' && parts[0] === 'import') {
        const body = await readBody(req)
        if (body.url && !body.item) {
          sendJson(res, await ops.importUrl(body.url, body.category || ''))
        } else {
          sendJson(res, await ops.importItem(body.item || {}, body.category || ''))
        }
        return
      }
      if (method === 'POST' && parts[0] === 'reveal') {
        const body = await readBody(req)
        sendJson(res, { ok: await ops.reveal(body.id) })
        return
      }
      if (method === 'POST' && parts[0] === 'category') {
        const body = await readBody(req)
        sendJson(res, await ops.setCategory(body.id, body.category || ''))
        return
      }
      if (method === 'GET' && parts[0] === 'file' && parts[1]) {
        const file = ops.filePathOf(decodeURIComponent(parts[1]))
        if (!file) {
          sendJson(res, { error: 'not found' }, 404)
          return
        }
        const buffer = await fsp.readFile(file)
        sendBuffer(res, buffer, 'application/pdf', 200, 'private, max-age=60')
        return
      }
      if (method === 'GET' && parts[0] === 'cover' && parts[1]) {
        const file = ops.coverPathOf(decodeURIComponent(parts[1]))
        if (!file) {
          sendJson(res, { error: 'no cover' }, 404)
          return
        }
        const buffer = await fsp.readFile(file)
        sendBuffer(res, buffer, 'image/png', 200, 'private, max-age=300')
        return
      }
      if (method === 'GET' && parts[0] === 'fig' && parts[1] && parts[2]) {
        const file = ops.figurePathOf(decodeURIComponent(parts[1]), parts[2])
        if (!file) {
          sendJson(res, { error: 'no figure' }, 404)
          return
        }
        const buffer = await fsp.readFile(file)
        sendBuffer(res, buffer, 'image/png', 200, 'private, max-age=300')
        return
      }
      if (method === 'GET' && parts[0] === 'page' && parts[1] && parts[2]) {
        const id = decodeURIComponent(parts[1])
        const page = Number(parts[2])
        if (!Number.isFinite(page) || page < 1) {
          sendJson(res, { error: 'bad page' }, 400)
          return
        }
        const buffer = await ops.pageImage(id, Math.floor(page), query.scale ? Number(query.scale) : undefined)
        sendBuffer(res, buffer, 'image/png', 200, 'private, max-age=600')
        return
      }
      sendJson(res, { error: 'not found', path: pathname }, 404)
    } catch (error) {
      const message = String(error?.message || error)
      log(`api error ${method} ${pathname}: ${message}`)
      sendJson(res, { error: message }, 500)
    }
  }
}

export { PREFIX }
