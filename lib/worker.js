/**
 * PDF worker process.
 *
 * This is the ONLY place pdf.js and the native canvas run. The host talks to it
 * over stdin/stdout with newline-delimited JSON, so a native fault in the PDF
 * stack kills this process instead of the Harness host.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { PdfEngine } from './pdf-core.js'

// pdf.js prints warnings through console; stdout is reserved for the protocol.
const toStderr = (...args) => {
  try {
    process.stderr.write(args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' ') + '\n')
  } catch {}
}
console.log = toStderr
console.info = toStderr
console.warn = toStderr
console.debug = toStderr

const engine = new PdfEngine({})

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

async function handle(req) {
  const options = req.options || {}
  if (options.pageScale) engine.pageScale = Number(options.pageScale)
  if (options.figureScale) engine.figureScale = Number(options.figureScale)
  if (options.maxFigures) engine.maxFigures = Number(options.maxFigures)
  if (options.maxPages) engine.maxAnalyzePages = Number(options.maxPages)

  if (req.op === 'ping') return { pong: true, pid: process.pid, node: process.versions.node }
  if (req.op === 'exit') {
    setTimeout(() => process.exit(0), 10)
    return { bye: true }
  }

  if (req.op === 'analyze') {
    const result = await engine.analyze(req.file, {
      maxPages: options.maxPages,
      skipPages: options.skipPages,
      skipFigurePages: options.skipFigurePages,
      skipCover: options.skipCover,
      onProgress: (progress) => send({ id: req.id, progress }),
    })
    const outDir = req.outDir
    await fsp.mkdir(outDir, { recursive: true })
    const figures = []
    for (let index = 0; index < result.figures.length; index++) {
      const figure = result.figures[index]
      const name = `f${index + 1}.png`
      await fsp.writeFile(path.join(outDir, name), figure.png)
      figures.push({
        page: figure.page,
        caption: figure.caption,
        label: figure.label,
        width: figure.width,
        height: figure.height,
        file: name,
      })
    }
    let cover = null
    if (result.cover) {
      await fsp.writeFile(path.join(outDir, 'cover.png'), result.cover)
      cover = { file: 'cover.png', width: result.coverWidth, height: result.coverHeight }
    }
    const rest = { ...result }
    delete rest.figures
    delete rest.cover
    return { ...rest, figures, cover }
  }

  if (req.op === 'page') {
    const rendered = await engine.renderPageToPng(req.file, req.page, req.scale)
    await fsp.mkdir(path.dirname(req.outFile), { recursive: true })
    await fsp.writeFile(req.outFile, rendered.png)
    return { width: rendered.width, height: rendered.height }
  }

  throw new Error('未知操作: ' + String(req.op))
}

let queue = Promise.resolve()

function onLine(line) {
  const text = line.trim()
  if (!text) return
  let req
  try {
    req = JSON.parse(text)
  } catch {
    return
  }
  queue = queue.then(async () => {
    try {
      const result = await handle(req)
      send({ id: req.id, ok: true, result })
    } catch (error) {
      send({ id: req.id, ok: false, error: String(error?.message || error) })
    }
  })
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (;;) {
    const index = buffer.indexOf('\n')
    if (index < 0) break
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    onLine(line)
  }
})
process.stdin.on('end', () => {
  process.exit(0)
})

process.on('uncaughtException', (error) => {
  toStderr('[paper-harness worker] uncaught: ' + String(error?.stack || error))
  process.exit(1)
})
process.on('unhandledRejection', (error) => {
  toStderr('[paper-harness worker] unhandled: ' + String(error?.stack || error))
  process.exit(1)
})

send({ id: 0, ok: true, result: { ready: true, pid: process.pid, node: process.versions.node } })
