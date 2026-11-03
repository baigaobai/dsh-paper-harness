/**
 * Shared operations: the browser API and the agent tool both call these, so the
 * two callers can never drift apart.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { searchPapers } from './search.js'
import { downloadPdf, pdfUrlFor, searchSources } from './sources.js'
import { environment } from './pdf.js'
import { splitForTranslation } from './llm.js'

export function createOps({ store, engine, llm, log = () => {} }) {
  const translationsDir = () => path.join(store.dataRoot, 'translations')
  const translationFile = (id) => path.join(translationsDir(), `${id}.json`)

  async function readTranslation(id) {
    try {
      return JSON.parse(await fsp.readFile(translationFile(id), 'utf8'))
    } catch {
      return null
    }
  }

  async function writeTranslation(record) {
    await fsp.mkdir(translationsDir(), { recursive: true })
    const file = translationFile(record.id)
    await fsp.writeFile(file + '.tmp', JSON.stringify(record), 'utf8')
    await fsp.rename(file + '.tmp', file)
  }

  const ops = {
    state() {
      return {
        ...store.snapshot(),
        categories: store.categories(),
        tags: store.tagCloud(),
        statusCounts: store.statusCounts(),
        env: environment(),
        llm: llm ? llm.resolveModel() : { available: false, provider: '', model: '' },
      }
    },

    llmInfo() {
      return llm ? llm.resolveModel() : { available: false, provider: '', model: '' }
    },

    async translation(id) {
      const record = await readTranslation(id)
      return record || { id, pages: {}, done: false }
    },

    async clearTranslation(id) {
      try {
        await fsp.unlink(translationFile(id))
      } catch {}
      return { ok: true }
    },

    /** Stream a page range of a translation, persisting as it goes. */
    async *translatePaper(id, { signal, from, to } = {}) {
      if (!llm) throw new Error('没有可用的模型服务')
      const paper = ops.detail(id)
      const pages = Array.isArray(paper.pages) && paper.pages.length ? paper.pages : [paper.text || '']
      const total = pages.length
      const start = Math.max(1, Math.min(Number(from) || 1, total))
      const end = Math.max(start, Math.min(Number(to) || total, total))
      const existing = (await readTranslation(id)) || { id, pages: {}, done: false }
      const record = { id, pages: { ...(existing.pages || {}) }, done: false, updatedAt: new Date().toISOString() }
      for (let pageNumber = start; pageNumber <= end; pageNumber++) {
        if (record.pages[pageNumber]) {
          yield { page: pageNumber, cached: true, text: record.pages[pageNumber] }
          continue
        }
        const source = pages[pageNumber - 1] || ''
        if (!source.trim()) {
          record.pages[pageNumber] = ''
          yield { page: pageNumber, text: '' }
          continue
        }
        let text = ''
        for (const chunk of splitForTranslation(source)) {
          for await (const delta of llm.translate(chunk, { signal })) {
            text += delta
            yield { page: pageNumber, delta }
          }
        }
        record.pages[pageNumber] = text
        record.updatedAt = new Date().toISOString()
        await writeTranslation(record)
        yield { page: pageNumber, pageDone: true, text }
      }
      const covered = Object.keys(record.pages).filter((key) => record.pages[key]).length
      record.done = covered >= total
      record.updatedAt = new Date().toISOString()
      await writeTranslation(record)
      yield { done: true, total, from: start, to: end, covered }
    },

    list(filters = {}) {
      const meta = store.list()
      const byId = new Map(meta.map((paper) => [paper.id, paper]))
      const full = meta.map((paper) => store.get(paper.id) || paper)
      const query = filters.q || ''
      const hits = searchPapers(full, query, filters, filters.limit || 120)
      return hits.map((hit) => {
        const base = byId.get(hit.paper.id) || hit.paper
        if (!query) return base
        return { ...base, _score: hit.score, _snippet: hit.snippet }
      })
    },

    detail(id) {
      const paper = store.full(id)
      if (!paper) throw new Error('没有找到这篇文献（id=' + id + '）')
      return paper
    },

    async update(id, patch) {
      return store.update(id, patch)
    },

    async reindex() {
      store.kick('api')
      return store.snapshot()
    },

    async reparse(id) {
      return store.reparse(id)
    },

    async online(query, source = 'all', limit = 12) {
      if (!String(query || '').trim()) throw new Error('请输入检索词')
      return searchSources(String(query).trim(), source, limit)
    },

    async importItem(item, category = '') {
      const url = pdfUrlFor(item || {})
      if (!url) throw new Error('这条结果没有可直接下载的 PDF 链接（可能需要在出版社页面登录）')
      const buffer = await downloadPdf(url)
      const name = (item.title || item.id || 'paper').slice(0, 120)
      const paper = await store.importPdf(buffer, name, category)
      const patch = {}
      if (item.title) patch.title = item.title
      if (Array.isArray(item.authors) && item.authors.length) patch.authors = item.authors
      if (item.year) patch.year = String(item.year)
      if (item.venue) patch.venue = item.venue
      if (Object.keys(patch).length) await store.update(paper.id, patch)
      return store.full(paper.id)
    },

    async importUrl(url, category = '') {
      const buffer = await downloadPdf(url)
      const name = decodeURIComponent(path.basename(new URL(url).pathname).replace(/\.pdf$/i, '')) || 'paper'
      const paper = await store.importPdf(buffer, name, category)
      return store.full(paper.id)
    },

    async reveal(id) {
      const paper = store.get(id)
      const file = paper
        ? path.join(store.libraryRoot, paper.relPath)
        : store.libraryRoot
      if (process.platform === 'win32') {
        spawn('explorer.exe', [`/select,${file}`], { detached: true, stdio: 'ignore' }).unref()
        return true
      }
      if (process.platform === 'darwin') {
        spawn('open', ['-R', file], { detached: true, stdio: 'ignore' }).unref()
        return true
      }
      spawn('xdg-open', [path.dirname(file)], { detached: true, stdio: 'ignore' }).unref()
      return true
    },

    async setCategory(id, category) {
      const paper = store.get(id)
      if (!paper) throw new Error('没有找到这篇文献')
      const clean = String(category || '').trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ')
      const safeCategory = clean === '未分类' ? '' : clean
      const from = path.join(store.libraryRoot, paper.relPath)
      const dir = safeCategory ? path.join(store.libraryRoot, safeCategory) : store.libraryRoot
      await fsp.mkdir(dir, { recursive: true })
      const target = path.join(dir, path.basename(paper.relPath))
      await fsp.rename(from, target).catch(async () => {
        await fsp.copyFile(from, target)
        await fsp.unlink(from)
      })
      await store.kick('move')
      return { ok: true, to: target }
    },

    async pageImage(id, page, scale) {
      const paper = store.get(id)
      if (!paper) throw new Error('没有找到这篇文献')
      const file = path.join(store.libraryRoot, paper.relPath)
      const cacheDir = path.join(store.dataRoot, 'pages', paper.id)
      const scaleKey = Number(scale) > 0 ? Number(scale).toFixed(2) : 'auto'
      const cacheFile = path.join(cacheDir, `p${page}@${scaleKey}.png`)
      try {
        return await fsp.readFile(cacheFile)
      } catch {}
      const rendered = await engine.renderPageToPng(file, page, Number(scale) || undefined)
      await fsp.mkdir(cacheDir, { recursive: true })
      await fsp.writeFile(cacheFile, rendered.png)
      return rendered.png
    },

    filePathOf(id) {
      const paper = store.get(id)
      if (!paper) return null
      return path.join(store.libraryRoot, paper.relPath)
    },

    figurePathOf(id, name) {
      const paper = store.get(id)
      if (!paper) return null
      const index = Number(name)
      const fig = (paper.figures || []).find((f) => f.i === index)
      if (!fig) return null
      return path.join(store.dataRoot, fig.file)
    },

    coverPathOf(id) {
      const paper = store.get(id)
      if (!paper || !paper.cover) return null
      return path.join(store.dataRoot, paper.cover)
    },
  }
  return ops
}
