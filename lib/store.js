/**
 * The library store: folder scan, incremental ingest, per-paper records and
 * user-owned reading state (status / rating / tags / notes).
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { ensureDir, nowIso, readJson, safeName, sha1File, shortHash, walkPdfs, writeJson } from './util.js'

const STATE_VERSION = 3
const LAYOUT_VERSION = 1
const USER_FIELDS = ['status', 'rating', 'tags', 'note', 'readAt']

export const STATUSES = ['unread', 'reading', 'read', 'mastered']

export class PaperStore {
  constructor({ libraryRoot, engine, options = {}, log = () => {} }) {
    this.libraryRoot = libraryRoot
    this.engine = engine
    this.log = log
    this.options = options
    this.dataRoot = path.join(libraryRoot, '.paper-harness')
    this.papersDir = path.join(this.dataRoot, 'papers')
    this.figuresDir = path.join(this.dataRoot, 'figures')
    this.coversDir = path.join(this.dataRoot, 'covers')
    this.indexFile = path.join(this.dataRoot, 'index.json')
    this.papers = new Map()
    this.files = new Map()
    this.rev = 0
    this.scanning = false
    this.progress = { done: 0, total: 0, current: '' }
    this.lastError = null
    this.lastScanAt = null
    this.#queue = Promise.resolve()
  }

  #queue

  async init() {
    await ensureDir(this.libraryRoot)
    await ensureDir(this.dataRoot)
    await ensureDir(this.papersDir)
    await ensureDir(this.figuresDir)
    await ensureDir(this.coversDir)
    const index = await readJson(this.indexFile, null)
    if (index && index.version === STATE_VERSION) {
      this.files = new Map(Object.entries(index.files || {}))
      for (const [id, entry] of Object.entries(index.papers || {})) {
        this.papers.set(id, entry)
      }
    }
    // Per-paper records are authoritative (they carry the extracted text).
    const entries = await fsp.readdir(this.papersDir).catch(() => [])
    for (const name of entries) {
      if (!name.endsWith('.json')) continue
      const record = await readJson(path.join(this.papersDir, name), null)
      if (record && record.id) this.papers.set(record.id, { ...record, missing: false })
    }
    await this.#persistIndex()
  }

  snapshot() {
    let total = 0
    for (const paper of this.papers.values()) if (!paper.missing) total++
    return {
      rev: this.rev,
      libraryRoot: this.libraryRoot,
      scanning: this.scanning,
      progress: this.progress,
      total,
      lastError: this.lastError,
      lastScanAt: this.lastScanAt,
    }
  }

  list() {
    const out = []
    for (const paper of this.papers.values()) {
      out.push(publicPaper(paper))
    }
    out.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)))
    return out
  }

  get(id) {
    return this.papers.get(id)
  }

  full(id) {
    const paper = this.papers.get(id)
    if (!paper) return null
    return { ...publicPaper(paper), text: paper.text || '', pages: paper.pages || [], layouts: paper.layouts || [] }
  }

  categories() {
    const map = new Map()
    for (const paper of this.papers.values()) {
      if (paper.missing) continue
      const key = paper.category || '未分类'
      map.set(key, (map.get(key) || 0) + 1)
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  tagCloud() {
    const map = new Map()
    for (const paper of this.papers.values()) {
      if (paper.missing) continue
      for (const tag of paper.tags || []) map.set(tag, (map.get(tag) || 0) + 1)
    }
    return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }

  statusCounts() {
    const counts = { unread: 0, reading: 0, read: 0, mastered: 0 }
    for (const paper of this.papers.values()) {
      if (paper.missing) continue
      const status = STATUSES.includes(paper.status) ? paper.status : 'unread'
      counts[status]++
    }
    return counts
  }

  async update(id, patch) {
    const paper = this.papers.get(id)
    if (!paper) throw new Error('paper not found: ' + id)
    const next = { ...paper }
    if (typeof patch.status === 'string' && STATUSES.includes(patch.status)) {
      next.status = patch.status
      if (patch.status !== 'unread' && !next.readAt) next.readAt = nowIso()
    }
    if (patch.rating === null || (typeof patch.rating === 'number' && patch.rating >= 0 && patch.rating <= 5)) {
      next.rating = patch.rating
    }
    if (Array.isArray(patch.tags)) {
      next.tags = [...new Set(patch.tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 24)
    }
    if (typeof patch.note === 'string') next.note = patch.note.slice(0, 20000)
    if (typeof patch.title === 'string' && patch.title.trim()) next.title = patch.title.trim().slice(0, 300)
    if (Array.isArray(patch.authors)) next.authors = patch.authors.map(String).slice(0, 20)
    if (typeof patch.year === 'string' || typeof patch.year === 'number') next.year = String(patch.year).slice(0, 8)
    if (typeof patch.venue === 'string') next.venue = patch.venue.slice(0, 200)
    next.updatedAt = nowIso()
    this.papers.set(id, next)
    await this.#persistPaper(next)
    this.rev++
    return publicPaper(next)
  }

  /** Re-parse one paper from disk (used after a manual re-index request). */
  async reparse(id) {
    const paper = this.papers.get(id)
    if (!paper) throw new Error('paper not found: ' + id)
    const file = path.join(this.libraryRoot, paper.relPath)
    const stat = await fsp.stat(file)
    const kept = {}
    for (const key of USER_FIELDS) if (paper[key] !== undefined) kept[key] = paper[key]
    await this.#ingest(file, paper.relPath, stat, { id, kept })
    return publicPaper(this.papers.get(id))
  }

  kick(reason = 'manual') {
    this.log(`scan queued (${reason})`)
    this.#queue = this.#queue
      .then(() => this.scan(reason))
      .catch((error) => {
        this.lastError = String(error?.message || error)
        this.log('scan failed: ' + this.lastError)
      })
    return this.#queue
  }

  async scan(reason = 'manual') {
    if (this.scanning) return
    this.scanning = true
    this.lastError = null
    try {
      const files = await walkPdfs(this.libraryRoot)
      this.progress = { done: 0, total: files.length, current: '' }
      this.rev++
      const seen = new Set()
      for (const file of files) {
        const rel = path.relative(this.libraryRoot, file)
        seen.add(normalizeRel(rel))
        let stat
        try {
          stat = await fsp.stat(file)
        } catch {
          continue
        }
        const knownId = this.#idFor(rel)
        const known = knownId ? this.papers.get(knownId) : null
        this.progress.current = rel
        if (known && !known.missing && known.size === stat.size && known.mtimeMs === stat.mtimeMs) {
          this.files.set(normalizeRel(rel), { id: known.id, mtimeMs: stat.mtimeMs, size: stat.size })
          this.progress.done++
          continue
        }
        try {
          await this.#ingest(file, rel, stat, { kept: known ? pickUser(known) : null })
        } catch (error) {
          this.lastError = `${rel}: ${String(error?.message || error)}`
          this.log(this.lastError)
        }
        this.progress.done++
        await new Promise((resolve) => setImmediate(resolve))
      }
      // Anything previously indexed but no longer on disk is kept as `missing` so
      // notes survive a moved or temporarily removed file.
      for (const [rel, rec] of [...this.files.entries()]) {
        if (seen.has(rel)) continue
        this.files.delete(rel)
        // A move re-indexes the same content under a new path: the id stays
        // referenced, so this is not a deletion.
        let stillReferenced = false
        for (const entry of this.files.values()) {
          if (entry.id === rec.id) {
            stillReferenced = true
            break
          }
        }
        if (stillReferenced) continue
        const paper = this.papers.get(rec.id)
        if (paper) {
          paper.missing = true
          paper.relPath = paper.relPath || rel
          await this.#persistPaper(paper)
        }
      }
      this.rev++
      this.lastScanAt = nowIso()
      await this.#persistIndex()
      await this.migrateLayouts()
    } finally {
      this.scanning = false
      this.progress = { done: 0, total: 0, current: '' }
    }
  }

  /**
   * Papers indexed before the selectable text layer existed need one re-parse
   * to gain layout geometry. Runs inside the scan queue, one paper at a time.
   */
  async migrateLayouts() {
    for (const paper of [...this.papers.values()]) {
      if (paper.missing) continue
      if (paper.layoutVersion === LAYOUT_VERSION) continue
      if (!paper.relPath) continue
      this.progress = { done: 0, total: 1, current: paper.relPath }
      try {
        await this.reparse(paper.id)
        this.rev++
      } catch (error) {
        this.log('layout migration failed: ' + String(error?.message || error))
      }
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  #idFor(rel) {
    return this.files.get(normalizeRel(rel))?.id
  }

  async #ingest(file, rel, stat, options = {}) {
    const hash = await sha1File(file)
    const id = options.id || hash.slice(0, 12)
    const existing = this.papers.get(id)
    const category = path.dirname(rel) === '.' ? '未分类' : path.dirname(rel).split(/[\\/]/)[0]
    if (existing && !options.id) {
      // Same content already known: the file moved.
      existing.relPath = rel
      existing.category = category
      existing.missing = false
      existing.updatedAt = nowIso()
      this.papers.set(id, existing)
      this.files.set(normalizeRel(rel), { id, mtimeMs: stat.mtimeMs, size: stat.size })
      await this.#persistPaper(existing)
      this.rev++
      return existing
    }
    const result = await this.engine.analyze(file, { maxPages: this.options.maxPages })
    const figDir = path.join(this.figuresDir, id)
    await ensureDir(figDir)
    const figures = []
    for (let i = 0; i < result.figures.length; i++) {
      const fig = result.figures[i]
      const name = `f${i + 1}.png`
      await fsp.writeFile(path.join(figDir, name), fig.png)
      figures.push({
        i: i + 1,
        page: fig.page,
        label: fig.label,
        caption: fig.caption,
        width: fig.width,
        height: fig.height,
        file: `figures/${id}/${name}`,
      })
    }
    let cover = null
    if (result.cover) {
      cover = `covers/${id}.png`
      await fsp.writeFile(path.join(this.coversDir, `${id}.png`), result.cover)
    }
    const kept = options.kept || (existing ? pickUser(existing) : null)
    const record = {
      version: STATE_VERSION,
      id,
      relPath: rel,
      fileName: path.basename(rel),
      category,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      title: result.title || guessTitleFromName(rel),
      authors: result.authors || [],
      year: result.year || '',
      venue: '',
      doi: result.doi || null,
      arxivId: result.arxivId || null,
      abstract: result.abstract || '',
      pageCount: result.pageCount,
      analyzedPages: result.analyzedPages,
      cover,
      coverWidth: result.coverWidth,
      coverHeight: result.coverHeight,
      figures,
      text: result.text || '',
      pages: result.textPages || [],
      layouts: result.layouts || [],
      layoutVersion: LAYOUT_VERSION,
      info: result.info || {},
      addedAt: existing?.addedAt || nowIso(),
      indexedAt: nowIso(),
      updatedAt: nowIso(),
      status: kept?.status || 'unread',
      rating: kept?.rating ?? null,
      tags: kept?.tags || [],
      note: kept?.note || '',
      readAt: kept?.readAt || null,
      missing: false,
    }
    this.papers.set(id, record)
    this.files.set(normalizeRel(rel), { id, mtimeMs: stat.mtimeMs, size: stat.size })
    await this.#persistPaper(record)
    await this.#persistIndex()
    this.rev++
    return record
  }

  async importPdf(buffer, fileName, category = '') {
    const dir = category ? path.join(this.libraryRoot, category) : this.libraryRoot
    await ensureDir(dir)
    let base = safeName(fileName.replace(/\.pdf$/i, ''), 'paper')
    let target = path.join(dir, `${base}.pdf`)
    let n = 1
    while (await exists(target)) {
      target = path.join(dir, `${base} (${n++}).pdf`)
    }
    await fsp.writeFile(target, buffer)
    const stat = await fsp.stat(target)
    const rel = path.relative(this.libraryRoot, target)
    const record = await this.#ingest(target, rel, stat, {})
    this.rev++
    return publicPaper(record)
  }

  async #persistPaper(record) {
    const { missing, ...rest } = record
    await writeJson(path.join(this.papersDir, `${record.id}.json`), rest)
  }

  async #persistIndex() {
    const papers = {}
    for (const [id, paper] of this.papers) {
      papers[id] = { ...publicPaper(paper), missing: !!paper.missing }
    }
    await writeJson(this.indexFile, {
      version: STATE_VERSION,
      updatedAt: nowIso(),
      libraryRoot: this.libraryRoot,
      files: Object.fromEntries(this.files),
      papers,
    })
  }
}

function pickUser(paper) {
  const out = {}
  for (const key of USER_FIELDS) if (paper[key] !== undefined) out[key] = paper[key]
  return out
}

function normalizeRel(rel) {
  return rel.split(path.sep).join('/')
}

function publicPaper(paper) {
  const { text, pages, layouts, ...rest } = paper
  return { ...rest, textLength: (text || '').length }
}

function guessTitleFromName(rel) {
  return path
    .basename(rel)
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .trim()
}

async function exists(file) {
  try {
    await fsp.access(file)
    return true
  } catch {
    return false
  }
}

export { shortHash }
