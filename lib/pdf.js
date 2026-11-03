/**
 * PDF engine client.
 *
 * pdf.js and the native Skia canvas run in a SEPARATE Node process. A malformed
 * PDF or a native fault in that stack must never take the Harness host down, so
 * every render is a request to that worker; if it dies, the call fails with an
 * error and the host keeps running.
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORKER_FILE = path.join(HERE, 'worker.js')
const ANALYZE_TIMEOUT = 240000
const PAGE_TIMEOUT = 120000
const IDLE_KILL_MS = 8 * 60 * 1000

/** Runtime facts useful when diagnosing a render failure. */
export function environment() {
  return {
    node: typeof process !== 'undefined' ? process.versions.node : null,
    electron: typeof process !== 'undefined' ? process.versions.electron || null : null,
    processType: typeof process !== 'undefined' ? process.type || null : null,
    dom: typeof document !== 'undefined',
  }
}

class PdfWorker {
  constructor() {
    this.child = null
    this.pending = new Map()
    this.seq = 0
    this.buffer = ''
    this.stderr = ''
    this.lastUsed = 0
    this.timer = null
    this.dead = false
  }

  #spawn() {
    if (this.child) return this.child
    if (this.dead) throw new Error('PDF 引擎已停止')
    const child = spawn(process.execPath, [WORKER_FILE], {
      cwd: HERE,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    this.child = child
    this.buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.#onStdout(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-4000)
    })
    child.on('error', (error) => this.#failAll('PDF 引擎启动失败: ' + String(error?.message || error)))
    child.on('exit', (code, signal) => {
      const detail = this.stderr.trim().split('\n').filter(Boolean).slice(-3).join(' | ')
      this.child = null
      this.#failAll(
        `PDF 引擎进程退出（code=${code}${signal ? `, signal=${signal}` : ''}）` + (detail ? `: ${detail}` : ''),
        true,
      )
    })
    this.#startIdleTimer()
    return child
  }

  #startIdleTimer() {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => {
      if (!this.child) return
      if (Date.now() - this.lastUsed > IDLE_KILL_MS && this.pending.size === 0) this.#kill()
    }, 60000)
    this.timer.unref?.()
  }

  #onStdout(chunk) {
    this.buffer += chunk
    for (;;) {
      const index = this.buffer.indexOf('\n')
      if (index < 0) break
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      if (!line.trim()) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      const entry = this.pending.get(message.id)
      if (!entry) continue
      if (message.progress) {
        try {
          entry.onProgress?.(message.progress)
        } catch {}
        continue
      }
      this.pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.ok) entry.resolve(message.result)
      else entry.reject(new Error(String(message.error || 'PDF 引擎返回错误')))
    }
  }

  #failAll(message, crashed = false) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      const error = new Error(message)
      if (crashed) error.workerCrashed = true
      entry.reject(error)
    }
    this.pending.clear()
  }

  request(payload, timeoutMs, onProgress) {
    const child = this.#spawn()
    const id = ++this.seq
    this.lastUsed = Date.now()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('PDF 处理超时'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer, onProgress })
      try {
        child.stdin.write(JSON.stringify({ id, ...payload }) + '\n')
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error('无法向 PDF 引擎发送请求: ' + String(error?.message || error)))
      }
    })
  }

  #kill() {
    if (!this.child) return
    const child = this.child
    this.child = null
    try {
      child.stdin.end()
    } catch {}
    try {
      child.kill()
    } catch {}
  }

  dispose() {
    this.dead = true
    if (this.timer) clearInterval(this.timer)
    this.#failAll('PDF 引擎已停止')
    this.#kill()
  }
}

export class PdfEngine {
  constructor(options = {}) {
    this.options = {
      pageScale: options.pageScale || 1.7,
      figureScale: options.figureScale || 2,
      maxPages: options.maxAnalyzePages || options.maxPages || 80,
      maxFigures: options.maxFigures || 16,
    }
    this.worker = new PdfWorker()
  }

  async analyze(file, options = {}) {
    const skipPages = []
    const skipFigurePages = []
    let skipCover = false
    let lastProgress = null
    let lastError = null

    for (let attempt = 0; attempt < 8; attempt++) {
      const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paper-harness-'))
      try {
        const result = await this.worker.request(
          {
            op: 'analyze',
            file,
            outDir,
            options: {
              maxPages: options.maxPages || this.options.maxPages,
              pageScale: this.options.pageScale,
              figureScale: this.options.figureScale,
              maxFigures: this.options.maxFigures,
              skipPages,
              skipFigurePages,
              skipCover,
            },
          },
          ANALYZE_TIMEOUT,
          (progress) => {
            lastProgress = progress
          },
        )
        const figures = []
        for (const figure of result.figures || []) {
          figures.push({
            page: figure.page,
            caption: figure.caption,
            label: figure.label,
            width: figure.width,
            height: figure.height,
            png: await fsp.readFile(path.join(outDir, figure.file)),
          })
        }
        const cover = result.cover ? await fsp.readFile(path.join(outDir, result.cover.file)) : null
        return {
          ...result,
          figures,
          cover,
          coverWidth: result.cover?.width || 0,
          coverHeight: result.cover?.height || 0,
          failedPages: [...new Set([...(result.failedPages || []), ...skipPages])].sort((a, b) => a - b),
          failedFigurePages: [...new Set(skipFigurePages)].sort((a, b) => a - b),
        }
      } catch (error) {
        lastError = error
        if (!error || !error.workerCrashed) throw error
        // The renderer died on a specific page: remember it, skip that piece and
        // try the rest of the document with a fresh worker.
        if (lastProgress?.kind === 'cover') {
          skipCover = true
        } else if (lastProgress?.kind === 'figures' && Number.isFinite(lastProgress.page)) {
          skipFigurePages.push(lastProgress.page)
        } else if (lastProgress?.kind === 'page' && Number.isFinite(lastProgress.page)) {
          skipPages.push(lastProgress.page)
        } else {
          throw error
        }
        lastProgress = null
      } finally {
        await fsp.rm(outDir, { recursive: true, force: true }).catch(() => {})
      }
    }
    throw lastError || new Error('PDF 解析多次失败')
  }

  async renderPageToPng(file, pageNumber, scale) {
    const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paper-harness-'))
    const outFile = path.join(outDir, 'page.png')
    try {
      const result = await this.worker.request(
        { op: 'page', file, page: pageNumber, scale: Number(scale) || this.options.pageScale, outFile },
        PAGE_TIMEOUT,
      )
      const png = await fsp.readFile(outFile)
      return { png, width: result.width, height: result.height }
    } finally {
      await fsp.rm(outDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async dispose() {
    this.worker.dispose()
  }
}
