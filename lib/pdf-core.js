/**
 * PDF analysis core: text, metadata, figure crops and page rendering.
 *
 * Runs ONLY inside the isolated worker process (see worker.js / pdf.js): pdf.js
 * and the native Skia canvas live here, so a native fault kills the worker
 * instead of the Harness host.
 *
 * pdf.js ships its own `@napi-rs/canvas`; this module unifies every require of
 * that package onto one instance, because mixing two native Skia modules in one
 * process crashes hard (not an exception).
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import Module, { createRequire } from 'node:module'

const requireFromHere = createRequire(import.meta.url)

/** Runtime facts that decide which canvas backend pdf.js ends up using. */
export function environment() {
  return {
    node: typeof process !== 'undefined' ? process.versions.node : null,
    electron: typeof process !== 'undefined' ? process.versions.electron || null : null,
    processType: typeof process !== 'undefined' ? process.type || null : null,
    dom: typeof document !== 'undefined',
    window: typeof window !== 'undefined',
    path2d: typeof globalThis.Path2D !== 'undefined',
    canvas2d: typeof globalThis.CanvasRenderingContext2D !== 'undefined',
  }
}

let pdfjsPromise = null
let canvasPromise = null
let pdfjsDir = null

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // Seed the native canvas classes first: pdf.js polyfills them only when its
      // own `require("@napi-rs/canvas")` fails, and its JS shims then hand plain
      // objects to the native 2D context, where every fill() throws.
      await loadCanvas()
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      try {
        pdfjsDir = path.dirname(requireFromHere.resolve('pdfjs-dist/package.json'))
      } catch {
        pdfjsDir = null
      }
      return pdfjs
    })()
  }
  return pdfjsPromise
}

let canvasHookInstalled = false

/**
 * pdf.js ships its own `@napi-rs/canvas` (0.1.x) while this plugin declares
 * 1.1.x, so a naive import loads TWO native Skia modules. Handing a canvas or a
 * Path2D from one to the other is a hard process crash, not an exception.
 *
 * Forcing every `require("@napi-rs/canvas")` in this process to resolve to the
 * single instance imported here keeps a document's objects inside one Skia.
 */
function unifyCanvasModule(mod) {
  if (canvasHookInstalled) return
  canvasHookInstalled = true
  try {
    const original = Module._load
    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === '@napi-rs/canvas') return mod
      return original.apply(this, arguments)
    }
  } catch {}
}

async function loadCanvas() {
  if (!canvasPromise) {
    canvasPromise = (async () => {
      const mod = await import('@napi-rs/canvas')
      unifyCanvasModule(mod)
      // pdf.js polyfills these globals from whatever canvas module it loads;
      // seeding them with the very same instances keeps glyph paths and image
      // drawing inside one native module.
      for (const key of ['Path2D', 'DOMMatrix', 'ImageData']) {
        if (mod[key] && globalThis[key] !== mod[key]) {
          try {
            globalThis[key] = mod[key]
          } catch {}
        }
      }
      return mod
    })()
  }
  return canvasPromise
}

const CAPTION_RE = /^\s*(fig(?:ure)?s?\.?|table|图|表)\s*\.?\s*(\d+[a-zA-Z]?)(?=[\s.:|)、）\-–—]|$)/i
const MIN_CAPTION_LEN = 10
const DEBUG = !!process.env.PH_DEBUG

function docParams() {
  const params = {
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }
  if (pdfjsDir) {
    params.standardFontDataUrl = path.join(pdfjsDir, 'standard_fonts') + path.sep
    params.cMapUrl = path.join(pdfjsDir, 'cmaps') + path.sep
    params.cMapPacked = true
  }
  return params
}

function pageItems(pdfjs, page, viewport) {
  return page.getTextContent({ includeMarkedContent: false }).then((tc) => {
    const items = []
    for (const raw of tc.items) {
      if (!raw || typeof raw.str !== 'string') continue
      const str = raw.str
      if (!str.trim()) continue
      const tr = pdfjs.Util.transform(viewport.transform, raw.transform)
      const h = Math.abs(raw.height || raw.transform?.[3] || 9) || 9
      // tr[5] is the top-down device y of the baseline in the viewport's units.
      const top = tr[5] - h
      items.push({
        str,
        x: tr[4],
        top,
        bottom: tr[5] + h * 0.22,
        w: Math.max(raw.width || 0, 1),
        h,
      })
    }
    return items
  })
}

function columnSplit(items, pageW) {
  if (items.length < 24) return null
  let best = null
  for (let x = pageW * 0.36; x <= pageW * 0.64; x += 3) {
    let left = 0
    let right = 0
    let crossing = 0
    for (const it of items) {
      if (it.x + it.w <= x) left++
      else if (it.x >= x) right++
      else crossing++
    }
    if (left > 6 && right > 6 && crossing <= 1) {
      const balance = Math.min(left, right) / items.length
      if (!best || balance > best.balance) best = { x, balance, left, right }
    }
  }
  if (best && best.balance >= 0.3) return best.x
  return null
}

function groupLines(items, splitX) {
  const buckets = splitX ? [[], []] : [[]]
  for (const it of items) {
    if (!splitX) buckets[0].push(it)
    else if (it.x + it.w <= splitX + 1) buckets[0].push(it)
    else buckets[1].push(it)
  }
  const lines = []
  for (const bucket of buckets) {
    if (!bucket.length) continue
    bucket.sort((a, b) => a.top - b.top || a.x - b.x)
    let line = null
    for (const it of bucket) {
      const mid = (it.top + it.bottom) / 2
      if (line && Math.abs(mid - line.mid) <= Math.max(2.5, Math.min(line.h, it.h) * 0.45)) {
        line.items.push(it)
        line.mid = (line.mid * (line.items.length - 1) + mid) / line.items.length
        line.h = Math.max(line.h, it.h)
      } else {
        line = { mid, h: it.h, items: [it], top: it.top }
        lines.push(line)
      }
    }
  }
  const sorted = lines
    .map((line) => {
      line.items.sort((a, b) => a.x - b.x)
      return {
        text: line.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim(),
        top: Math.min(...line.items.map((i) => i.top)),
        bottom: Math.max(...line.items.map((i) => i.bottom)),
        x: Math.min(...line.items.map((i) => i.x)),
        x1: Math.max(...line.items.map((i) => i.x + i.w)),
        h: line.h,
      }
    })
    .filter((l) => l.text)
  sorted.sort((a, b) => a.top - b.top || a.x - b.x)
  return sorted
}

/**
 * Per-row "graphic ink" profile.
 *
 * Text glyphs live inside the text layer's own bounding boxes, so ink that falls
 * OUTSIDE every text line is figure material: photos, vector art, plot curves,
 * table rules, flow-chart boxes. Body paragraphs score ~0, which makes this a far
 * more reliable separator than whitespace gaps or font sizes.
 */
function graphicProfile(imageData, width, height, lines, scale) {
  const counts = new Int32Array(height)
  const minX = new Int32Array(height).fill(width)
  const maxX = new Int32Array(height).fill(-1)
  const spans = new Array(height)
  for (const line of lines) {
    const y0 = Math.max(0, Math.floor(line.top * scale))
    const y1 = Math.min(height - 1, Math.ceil(line.bottom * scale))
    const x0 = Math.max(0, Math.floor(line.x * scale) - 2)
    const x1 = Math.min(width - 1, Math.ceil(line.x1 * scale) + 2)
    for (let y = y0; y <= y1; y++) {
      if (!spans[y]) spans[y] = []
      spans[y].push(x0, x1)
    }
  }
  for (let y = 0; y < height; y++) {
    const sp = spans[y]
    let n = 0
    let lx = width
    let rx = -1
    const base = y * width * 4
    for (let x = 0; x < width; x += 2) {
      const i = base + x * 4
      if (!(imageData[i] < 246 || imageData[i + 1] < 246 || imageData[i + 2] < 246)) continue
      let inside = false
      if (sp) {
        for (let k = 0; k < sp.length; k += 2) {
          if (x >= sp[k] && x <= sp[k + 1]) {
            inside = true
            break
          }
        }
      }
      if (inside) continue
      n++
      if (x < lx) lx = x
      if (x > rx) rx = x
    }
    counts[y] = n
    if (rx >= 0) {
      minX[y] = lx
      maxX[y] = rx
    }
  }
  return { counts, minX, maxX }
}

/**
 * Locate the figure that belongs to one caption: walk up from the caption over
 * rows that carry graphic ink, bridging sub-panel gaps, and stop at the first
 * paragraph of pure text.
 */
function pickRegion(profile, cap, pageW, pageH, scale) {
  const capTopPx = Math.max(0, Math.min(pageH - 1, Math.floor(cap.top * scale)))
  const threshold = Math.max(8, Math.floor(pageW * 0.006))
  const isFigureRow = (y) => y >= 0 && y < pageH && profile.counts[y] >= threshold
  const bridge = 34 * scale
  let start = -1
  for (let y = capTopPx - 1, k = 0; y >= 0 && k < 90 * scale; y--, k++) {
    if (isFigureRow(y)) {
      start = y
      break
    }
  }
  if (start < 0) return null
  let top = start
  let gap = 0
  for (let y = start; y >= 0; y--) {
    if (isFigureRow(y)) {
      top = y
      gap = 0
    } else {
      gap++
      if (gap > bridge) break
    }
  }
  const bottom = capTopPx - 2 * scale
  if (bottom - top < 45 * scale) return null
  if (bottom - top > pageH * 0.85) return null
  let x0 = pageW
  let x1 = 0
  for (let y = top; y < bottom; y++) {
    if (profile.counts[y] > 0 && profile.maxX[y] >= 0) {
      if (profile.minX[y] < x0) x0 = profile.minX[y]
      if (profile.maxX[y] > x1) x1 = profile.maxX[y]
    }
  }
  if (x1 <= x0) return null
  const pad = 10 * scale
  if (x1 - x0 < pageW * 0.82) {
    x0 = Math.max(0, x0 - pad)
    x1 = Math.min(pageW, x1 + pad)
  } else {
    x0 = Math.max(0, x0 - 3 * scale)
    x1 = Math.min(pageW, x1 + 3 * scale)
  }
  if (x1 - x0 < 100) return null
  return { top: Math.max(0, top - 2 * scale), bottom, x0, x1 }
}

/**
 * Per-item text geometry for the selectable text layer drawn over the page
 * image. Coordinates stay in PDF points; the client turns them into
 * percentages, so the layer scales with whatever size the page is shown at.
 */
function buildLayout(items, viewport, splitX) {
  const round = (value) => Math.round(value * 10) / 10
  const usable = items.filter((item) => item.str && item.str.trim() && item.w > 0.2 && item.h > 0.2)
  const sorted = usable.slice().sort((a, b) => {
    const columnA = splitX && a.x >= splitX ? 1 : 0
    const columnB = splitX && b.x >= splitX ? 1 : 0
    if (columnA !== columnB) return columnA - columnB
    return a.top - b.top || a.x - b.x
  })
  const out = []
  for (const item of sorted.slice(0, 4000)) {
    out.push({
      s: String(item.str).replace(/[\u0000-\u001f]/g, ' '),
      x: round(item.x),
      y: round(item.top),
      w: round(item.w),
      h: round(item.h),
    })
  }
  return { w: round(viewport.width), h: round(viewport.height), items: out }
}

function guessTitle(lines, info) {
  const metaTitle = String(info?.Title || '')
    .replace(/\s+/g, ' ')
    .trim()
  const metaOk =
    metaTitle.length > 8 &&
    !/^(untitled|microsoft word|document|pdf|slide|powerpoint)/i.test(metaTitle) &&
    !/\.(docx?|tex|pdf|dvi|pptx?)$/i.test(metaTitle)
  const top = lines
    .slice(0, 30)
    .filter(
      (l) =>
        l.text.length >= 8 &&
        l.text.length <= 300 &&
        !/^arxiv:|^https?:|^doi[:\s]|^\d+$|©|all rights reserved/i.test(l.text),
    )
  const meta = metaOk ? { title: metaTitle, source: 'meta' } : null
  if (!top.length) return meta || { title: '', source: 'none' }
  const maxH = Math.max(...top.map((l) => l.h))
  if (maxH < 11) return meta || { title: top[0].text, source: 'layout' }
  const titleLines = top.filter((l) => l.h >= maxH * 0.88).sort((a, b) => a.top - b.top)
  let layout = ''
  let prev = null
  for (const line of titleLines) {
    if (prev && line.top - prev.bottom > maxH * 1.1) break
    layout = layout ? layout + ' ' + line.text : line.text
    prev = line
    if (layout.length > 260) break
  }
  layout = layout.replace(/\s+/g, ' ').trim()
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '')
  if (meta) {
    const a = norm(metaTitle).slice(0, 22)
    const b = norm(layout).slice(0, 22)
    if (!a || !b || a.includes(b) || b.includes(a)) return meta
  }
  return layout ? { title: layout, source: 'layout' } : meta || { title: '', source: 'none' }
}

function findDoi(text) {
  const m = String(text || '').match(/\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/)
  if (!m) return null
  return m[0].replace(/[.,;]+$/, '')
}

function findArxiv(text) {
  const m = String(text || '').match(/arxiv[:\s]*(\d{4}\.\d{4,5})(v\d+)?/i)
  return m ? m[1] : null
}

function guessAuthors(lines, titleTop) {
  const after = lines
    .filter((l) => l.top > (titleTop || 0) + 4)
    .sort((a, b) => a.top - b.top)
    .slice(0, 6)
  const nameLike = (p) => /^[A-Z][\w.'’-]*(\s+[A-Z][\w.'’-]*){0,3}\d?$/.test(p.trim())
  for (const line of after) {
    const text = line.text.replace(/\s*\d+(,\d+)*\s*$/g, '').trim()
    if (text.length < 5 || text.length > 260) continue
    if (/@|universit|institut|department|laborator|school of|college|academy|doi|received|correspond/i.test(text)) break
    const parts = text.split(/\s*(?:,|;|\band\b|&)\s*/).filter(Boolean)
    if (parts.length >= 2 && parts.filter(nameLike).length >= Math.ceil(parts.length * 0.6)) {
      return parts.map((p) => p.trim()).filter(Boolean).slice(0, 12)
    }
    if (parts.length === 1 && nameLike(text) && !/\d{2,}/.test(text)) return [text]
  }
  return []
}

function abstractGuess(lines, pageH) {
  const body = lines.filter((l) => l.top > 36 && l.bottom < pageH - 26)
  const absIdx = body.findIndex((l) => /^\s*(abstract|摘\s*要)\b/i.test(l.text) && l.text.length < 40)
  const skip = (t) =>
    /university|institute|department|laborator|school of|college|academy|@|doi\.org|arxiv:|©|all rights reserved|correspondence|received|accepted|published/i.test(
      t,
    )
  if (absIdx >= 0) {
    const out = []
    for (let i = absIdx + 1; i < body.length && out.length < 9; i++) {
      const t = body[i].text
      if (/^\s*(introduction|keywords|key words)\b/i.test(t)) break
      out.push(t)
      if (out.join(' ').length > 1300) break
    }
    const joined = out.join(' ').replace(/\s+/g, ' ').trim()
    if (joined.length > 120) return joined.slice(0, 1500)
  }
  return ''
}

export class PdfEngine {
  constructor(options = {}) {
    this.pageScale = options.pageScale || 1.7
    this.figureScale = options.figureScale || 2
    this.maxAnalyzePages = options.maxAnalyzePages || 60
    this.maxFigures = options.maxFigures || 14
    this.cache = new Map()
    this.cacheLimit = 3
  }

  async open(file) {
    const stat = await fsp.stat(file)
    const cached = this.cache.get(file)
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      this.cache.delete(file)
      this.cache.set(file, cached)
      return cached
    }
    const pdfjs = await loadPdfjs()
    const data = new Uint8Array(await fsp.readFile(file))
    const doc = await pdfjs.getDocument({ data, ...docParams() }).promise
    const entry = { doc, mtimeMs: stat.mtimeMs, pdfjs, file }
    this.cache.set(file, entry)
    while (this.cache.size > this.cacheLimit) {
      const [oldKey, oldEntry] = this.cache.entries().next().value || []
      if (!oldKey) break
      this.cache.delete(oldKey)
      try {
        await oldEntry.doc.destroy()
      } catch {}
    }
    return entry
  }

  async analyze(file, options = {}) {
    const { doc, pdfjs } = await this.open(file)
    const pageCount = doc.numPages
    const limit = Math.min(pageCount, options.maxPages || this.maxAnalyzePages)
    const skipPages = new Set((options.skipPages || []).map(Number))
    const skipFigures = new Set((options.skipFigurePages || []).map(Number))
    const report = typeof options.onProgress === 'function' ? options.onProgress : () => {}
    let info = {}
    try {
      const meta = await doc.getMetadata()
      info = meta?.info || {}
    } catch {}
    const { createCanvas } = await loadCanvas()

    const pageTexts = []
    const pageLines = []
    const pageHeights = []
    const pageLayouts = []
    const figures = []
    const failedPages = []
    let cover = null

    for (let n = 1; n <= limit; n++) {
      if (skipPages.has(n)) {
        pageTexts.push('')
        pageLines.push([])
        pageHeights.push(0)
        pageLayouts.push(null)
        failedPages.push(n)
        continue
      }
      report({ kind: 'page', page: n })
      const page = await doc.getPage(n)
      const viewport = page.getViewport({ scale: 1 })
      pageHeights.push(viewport.height)
      const items = await pageItems(pdfjs, page, viewport)
      const splitX = columnSplit(items, viewport.width)
      const lines = groupLines(items, splitX)
      pageLines.push(lines)
      pageTexts.push(lines.map((l) => l.text).join('\n'))
      pageLayouts.push(buildLayout(items, viewport, splitX))

      const pageW = viewport.width

      if (n === 1 && !options.skipCover) {
        report({ kind: 'cover' })
        const scale = Math.min(1.35, 460 / pageW)
        const rendered = await this.#render(page, viewport, scale, createCanvas)
        cover = {
          png: rendered.canvas.encodeSync('png'),
          width: rendered.canvas.width,
          height: rendered.canvas.height,
        }
      }

      if (figures.length < this.maxFigures && n <= 40 && !skipFigures.has(n)) {
        const captions = lines
          .filter((l) => {
            if (l.text.length < MIN_CAPTION_LEN) return false
            if (!CAPTION_RE.test(l.text)) return false
            if (l.x > pageW * 0.62) return false
            if (/^(figure|fig\.?)\s*\d+[a-z]?\s*(shows?|is|are|illustrat)/i.test(l.text) && !/[.:|]/.test(l.text.slice(0, 40))) return false
            return true
          })
          .map((l) => ({ line: l, label: (l.text.match(CAPTION_RE)?.[1] || 'fig').toLowerCase() }))

        if (captions.length) {
          report({ kind: 'figures', page: n })
          try {
            const scale = this.figureScale
            const rendered = await this.#render(page, viewport, scale, createCanvas)
            const profile = graphicProfile(rendered.data, rendered.canvas.width, rendered.canvas.height, lines, scale)
            for (const cap of captions) {
              if (figures.length >= this.maxFigures) break
              const region = pickRegion(profile, cap.line, rendered.canvas.width, rendered.canvas.height, scale)
              if (!region) continue
              const S = rendered.canvas
              const x0 = Math.max(0, Math.floor(region.x0))
              const x1 = Math.min(S.width, Math.ceil(region.x1))
              const y0 = Math.max(0, Math.floor(region.top))
              const y1 = Math.min(S.height, Math.ceil(region.bottom))
              const w = x1 - x0
              const h = y1 - y0
              if (w < 120 || h < 90) continue
              if (w * h > 18e6) continue
              const crop = createCanvas(w, h)
              crop.getContext('2d').drawImage(S, x0, y0, w, h, 0, 0, w, h)
              figures.push({
                page: n,
                caption: cap.line.text.slice(0, 600),
                label: cap.label,
                width: w,
                height: h,
                png: crop.encodeSync('png'),
              })
            }
          } catch {
            // A page that fails to render must not abort the whole paper.
          }
        }
      }
      page.cleanup?.()
    }

    const titleGuess = guessTitle(pageLines[0] || [], info)
    const headingLine = (pageLines[0] || []).find((l) => l.text === titleGuess.title) || (pageLines[0] || [])[0]
    const authors = guessAuthors(pageLines[0] || [], headingLine?.top || 0)
    const firstText = pageTexts.slice(0, 2).join('\n')
    const year = String(info?.CreationDate || '').match(/D:(\d{4})/)?.[1] || null

    return {
      pageCount,
      analyzedPages: limit,
      failedPages,
      textPages: pageTexts,
      text: pageTexts.join('\n\n'),
      layouts: pageLayouts,
      title: titleGuess.title,
      titleSource: titleGuess.source,
      authors,
      year,
      doi: findDoi(firstText),
      arxivId: findArxiv(firstText),
      abstract: abstractGuess(pageLines[0] || [], (pageLines[0] && pageHeights[0]) || 0),
      info: {
        title: info?.Title || '',
        author: info?.Author || '',
        creator: info?.Creator || '',
        producer: info?.Producer || '',
        creationDate: info?.CreationDate || '',
      },
      cover: cover?.png || null,
      coverWidth: cover?.width || 0,
      coverHeight: cover?.height || 0,
      figures,
    }
  }

  async #render(page, viewport, scale, createCanvas) {
    const scaled = page.getViewport({ scale })
    let px = scaled.width * scaled.height
    let finalScale = scale
    if (px > 14e6) {
      finalScale = scale * Math.sqrt(14e6 / px)
      px = 14e6
    }
    const vp = finalScale === scale ? scaled : page.getViewport({ scale: finalScale })
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport: vp }).promise
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    return { canvas, data, scale: finalScale }
  }

  async renderPageToPng(file, pageNumber, scale) {
    const { doc } = await this.open(file)
    const { createCanvas } = await loadCanvas()
    const page = await doc.getPage(Math.max(1, Math.min(pageNumber, doc.numPages)))
    const viewport = page.getViewport({ scale: 1 })
    const target = scale || this.pageScale
    const rendered = await this.#render(page, viewport, target, createCanvas)
    page.cleanup?.()
    return { png: rendered.canvas.encodeSync('png'), width: rendered.canvas.width, height: rendered.canvas.height }
  }

  async dispose() {
    for (const entry of this.cache.values()) {
      try {
        await entry.doc.destroy()
      } catch {}
    }
    this.cache.clear()
  }
}
