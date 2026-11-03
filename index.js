/**
 * Paper Harness — host half.
 *
 * Owns the literature library on disk (scan + incremental index), the PDF
 * analysis engine, the browser HTTP API and the `paper_library` agent tool.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PdfEngine } from './lib/pdf.js'
import { PaperStore, STATUSES } from './lib/store.js'
import { createOps } from './lib/ops.js'
import { createApiHandler, PREFIX } from './lib/api.js'
import { createLlm } from './lib/llm.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = HERE
const DEFAULT_LIBRARY = path.join(PKG_ROOT, 'library')

export const name = 'paper-harness'

const DEFAULTS = {
  libraryRoot: '',
  maxPages: 80,
  pageScale: 1.7,
  figureScale: 2,
  maxFigures: 16,
  watch: true,
  autoIndex: true,
  verbose: false,
}

function readRawConfig() {
  try {
    return JSON.parse(process.env.PAPER_HARNESS_CONFIG || '{}')
  } catch {
    return {}
  }
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...readRawConfig(), ...(config || {}) }
  const libraryRoot = cfg.libraryRoot && String(cfg.libraryRoot).trim()
    ? path.resolve(String(cfg.libraryRoot).trim())
    : DEFAULT_LIBRARY
  const log = (message) => {
    if (cfg.verbose) {
      try {
        console.log(`[paper-harness] ${message}`)
      } catch {}
    }
  }

  const engine = new PdfEngine({
    pageScale: Number(cfg.pageScale) || DEFAULTS.pageScale,
    figureScale: Number(cfg.figureScale) || DEFAULTS.figureScale,
    maxAnalyzePages: Number(cfg.maxPages) || DEFAULTS.maxPages,
    maxFigures: Number(cfg.maxFigures) || DEFAULTS.maxFigures,
  })
  const store = new PaperStore({
    libraryRoot,
    engine,
    log,
    options: { maxPages: Number(cfg.maxPages) || DEFAULTS.maxPages },
  })
  const llm = createLlm({ ctx, log })
  const ops = createOps({ store, engine, llm, log })

  const ready = (async () => {
    try {
      await store.init()
      log(`library: ${libraryRoot}`)
      if (cfg.autoIndex) store.kick('startup')
    } catch (error) {
      log('init failed: ' + String(error?.message || error))
    }
  })()

  ctx.effect(() => () => {
    try {
      engine.dispose()
    } catch {}
  })

  // ---- filesystem watch: dropping a PDF into a category folder indexes it ----
  if (cfg.watch) {
    ctx.effect(() => {
      let timer = null
      let watcher = null
      const fire = () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          store.kick('fs-change')
        }, 2500)
      }
      const start = async () => {
        try {
          await fsp.mkdir(libraryRoot, { recursive: true })
          watcher = fs.watch(libraryRoot, { recursive: true }, (_event, file) => {
            if (file && String(file).includes('.paper-harness')) return
            fire()
          })
          watcher.on('error', (error) => log('watch error: ' + String(error?.message || error)))
        } catch (error) {
          log('watch unavailable: ' + String(error?.message || error))
        }
      }
      start()
      return () => {
        if (timer) clearTimeout(timer)
        try {
          watcher?.close()
        } catch {}
      }
    })
  }

  // ---- browser API ----
  ctx.inject(['webServer'], (scope) => {
    const handler = createApiHandler({ ops, llm, log })
    scope.effect(() => scope.webServer.register({ kind: 'prefix', path: PREFIX, handler }))
    log('api mounted at ' + PREFIX)
  })

  // ---- prompt context so the model knows the library exists ----
  ctx.inject(['systemPrompt'], (scope) => {
    scope.effect(() =>
      scope.systemPrompt.context({
        name: 'paper-harness',
        order: 620,
        text: () =>
          [
            '## 文献台（paper-harness）',
            `文献库目录：${libraryRoot}（把 PDF 放进该目录下的分类子文件夹即会被自动索引）。`,
            '用 `paper_library` 工具操作用户的文献库：action=list|search 找文献，action=read 读全文与图注，action=figures 列出插图，action=update 记录阅读状态/标签/笔记，action=online 在线检索，action=import 下载入库。',
            '用户用"这篇/那篇文献"指代而没有给 id 时，先用 action=search 或 action=list 定位，再读取。',
          ].join('\n'),
      }),
    )
  })

  // ---- agent tool ----
  ctx.inject(['tools'], (scope) => {
    const truncate = (text, max) => {
      const s = String(text || '')
      return s.length <= max ? s : s.slice(0, max) + `\n…（已截断，共 ${s.length} 字符）`
    }

    scope.effect(() =>
      scope.tools.register({
        name: 'paper_library',
        description: [
          '操作用户的本地文献库（Paper Harness）。',
          'action=list：按分类/状态/标签列出文献；action=search：库内全文检索；',
          'action=read：读取一篇文献的元数据、摘要、图注与正文；action=figures：列出该文献的插图与图注；',
          'action=update：更新阅读状态(unread/reading/read/mastered)、评分、标签、笔记；',
          'action=online：在线检索 arXiv / Semantic Scholar / Crossref；action=import：把在线结果或 PDF 链接下载入库；',
          'action=state：库概况；action=reindex：重新扫描文献库。',
        ].join('\n'),
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['state', 'list', 'search', 'read', 'figures', 'update', 'online', 'import', 'reindex'],
              description: '要执行的操作',
            },
            id: { type: 'string', description: '文献 id（list/search/online 结果里给出）' },
            query: { type: 'string', description: 'list/search/online 的检索词' },
            category: { type: 'string', description: '分类（文件夹名），import 时指定入库位置' },
            status: { type: 'string', enum: STATUSES, description: '阅读状态' },
            tags: { type: 'array', items: { type: 'string' }, description: '标签列表（覆盖写）' },
            rating: { type: 'number', description: '评分 1-5' },
            note: { type: 'string', description: '阅读笔记（覆盖写）' },
            source: { type: 'string', enum: ['all', 'arxiv', 's2', 'crossref'], description: '在线检索来源' },
            url: { type: 'string', description: 'PDF 直链（action=import 时使用）' },
            item: { type: 'object', description: 'action=import 时的在线检索结果对象', additionalProperties: true },
            maxChars: { type: 'number', description: 'action=read 返回正文的最大字符数（默认 12000）' },
          },
          required: ['action'],
          additionalProperties: false,
        },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render(_args, value) {
            if (value && typeof value.text === 'string' && value.text) {
              return [{ type: 'text', text: value.text }]
            }
            const pretty = JSON.stringify(value, null, 2)
            return [{ type: 'text', text: pretty.length > 20000 ? pretty.slice(0, 20000) + '\n…' : pretty }]
          },
        },
        async execute(args) {
          await ready
          const action = String(args?.action || 'state')
          if (action === 'state') {
            const state = ops.state()
            return {
              text: [
                `文献库：${state.libraryRoot}`,
                `已索引 ${state.total} 篇（未读 ${state.statusCounts.unread} / 在读 ${state.statusCounts.reading} / 已读 ${state.statusCounts.read} / 精读 ${state.statusCounts.mastered}）`,
                `分类：${state.categories.map((c) => `${c.name}(${c.count})`).join('、') || '（空）'}`,
                `标签：${state.tags.map((t) => t.name).join('、') || '（无）'}`,
                state.scanning ? '（正在索引…）' : '',
              ]
                .filter(Boolean)
                .join('\n'),
            }
          }
          if (action === 'list' || action === 'search') {
            const items = ops.list({
              q: args?.query || '',
              category: args?.category || 'all',
              status: args?.status || 'all',
              tag: args?.tags?.[0] || '',
              limit: 40,
            })
            if (!items.length) return { text: '没有匹配的文献。' }
            const lines = items.map((p) =>
              [
                `- ${p.id}｜${p.title || p.fileName}`,
                `  ${p.authors?.slice(0, 4).join(', ') || '—'}｜${p.year || '—'}｜${p.category}｜${statusLabel(p.status)}${p.rating ? `｜★${p.rating}` : ''}｜${p.pageCount}页｜${(p.figures || []).length}图`,
                p._snippet ? `  ${String(p._snippet).slice(0, 160).replace(/\s+/g, ' ')}` : '',
              ]
                .filter(Boolean)
                .join('\n'),
            )
            return { text: `共 ${items.length} 条：\n` + lines.join('\n') }
          }
          if (action === 'read') {
            const paper = ops.detail(String(args?.id || ''))
            const maxChars = Number(args?.maxChars) || 12000
            return {
              text: [
                `# ${paper.title || paper.fileName}`,
                `${(paper.authors || []).join(', ') || '—'}｜${paper.year || '—'}｜${paper.venue || paper.category}｜${paper.pageCount} 页｜DOI ${paper.doi || '—'}`,
                paper.abstract ? `\n摘要：${paper.abstract}` : '',
                `\n插图（${(paper.figures || []).length} 张）：`,
                ...(paper.figures || []).map((f) => `- [p${f.page}] ${f.caption}`),
                `\n正文（前 ${maxChars} 字符）：\n${truncate(paper.text, maxChars)}`,
              ]
                .filter(Boolean)
                .join('\n'),
            }
          }
          if (action === 'figures') {
            const paper = ops.detail(String(args?.id || ''))
            return {
              text: [
                `${paper.title}｜共 ${(paper.figures || []).length} 张插图`,
                ...(paper.figures || []).map(
                  (f) => `- [p${f.page}] ${f.caption}（${f.width}×${f.height}，/api/paper-harness/fig/${paper.id}/${f.i}）`,
                ),
              ].join('\n'),
            }
          }
          if (action === 'update') {
            const patch = {}
            if (args?.status) patch.status = args.status
            if (typeof args?.rating === 'number') patch.rating = args.rating
            if (Array.isArray(args?.tags)) patch.tags = args.tags
            if (typeof args?.note === 'string') patch.note = args.note
            const updated = await ops.update(String(args?.id || ''), patch)
            return { text: `已更新：${updated.title}｜${statusLabel(updated.status)}｜★${updated.rating ?? '-'}｜标签：${(updated.tags || []).join('、') || '无'}` }
          }
          if (action === 'online') {
            const result = await ops.online(String(args?.query || ''), args?.source || 'all', 10)
            if (!result.results.length) {
              return { text: '没有检索到结果。' + (result.errors?.length ? `（${result.errors.map((e) => e.source + ': ' + e.message).join('; ')}）` : '') }
            }
            return {
              text: [
                `在线检索「${args?.query}」共 ${result.results.length} 条：`,
                ...result.results.map(
                  (r) =>
                    `- [${r.source}] ${r.title}｜${(r.authors || []).slice(0, 3).join(', ')}｜${r.year || '—'}｜${r.venue || ''}｜${r.pdfUrl ? '有PDF' : '无PDF'}${r.citations != null ? `｜引用 ${r.citations}` : ''}`,
                ),
                '',
                '如需入库，用 action=import 并传入 item（结果对象）与 category。',
              ].join('\n'),
            }
          }
          if (action === 'import') {
            const paper = args?.item
              ? await ops.importItem(args.item, args?.category || '')
              : await ops.importUrl(String(args?.url || ''), args?.category || '')
            return { text: `已入库：${paper.title}（${paper.id}，${paper.pageCount} 页，${(paper.figures || []).length} 张插图）→ ${paper.category}` }
          }
          if (action === 'reindex') {
            await ops.reindex()
            return { text: '已开始重新索引，稍后用 action=state 查看进度。' }
          }
          throw new Error('未知 action: ' + action)
        },
      }),
    )
  })
}

function statusLabel(status) {
  return { unread: '未读', reading: '在读', read: '已读', mastered: '精读' }[status] || '未读'
}
