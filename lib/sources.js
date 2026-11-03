/**
 * Online paper search: arXiv (best open PDFs), Semantic Scholar (citation data
 * and open-access links) and Crossref (complete bibliographic metadata).
 */
const UA = 'paper-harness/0.1 (local research reading workbench)'

async function fetchWithTimeout(url, { timeout = 15000, headers = {}, as = 'text' } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': UA, accept: '*/*', ...headers },
      signal: controller.signal,
      redirect: 'follow',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
    if (as === 'json') return await response.json()
    if (as === 'buffer') return Buffer.from(await response.arrayBuffer())
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function searchArxiv(query, limit = 12) {
  const terms = String(query)
    .split(/\s+/)
    .map((t) => t.replace(/[^\w.\-+]/g, ''))
    .filter(Boolean)
    .slice(0, 6)
  const phrase = terms.length > 1 ? terms.map((t) => `all:${t}`).join('+AND+') : `all:${terms[0] || query}`
  const url = `https://export.arxiv.org/api/query?search_query=${phrase}&start=0&max_results=${Math.min(limit, 25)}&sortBy=relevance`
  const xml = await fetchWithTimeout(url, { as: 'text' })
  const entries = xml.split('<entry>').slice(1)
  const out = []
  for (const raw of entries) {
    const block = raw.split('</entry>')[0]
    const id = (block.match(/<id>\s*([^<]+?)\s*<\/id>/) || [])[1] || ''
    const arxivId = (id.match(/abs\/([^v<]+)(v\d+)?/) || [])[1]
    const title = stripTags((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1])
    const summary = stripTags((block.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1])
    const published = (block.match(/<published>\s*([^<]+?)\s*<\/published>/) || [])[1] || ''
    const authors = [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].map((m) =>
      stripTags(m[1]),
    )
    if (!title) continue
    out.push({
      source: 'arxiv',
      id: arxivId || id,
      title,
      authors,
      year: published.slice(0, 4),
      venue: 'arXiv',
      abstract: summary,
      pdfUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}` : null,
      url: id,
      doi: (block.match(/<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/) || [])[1] || null,
      arxivId: arxivId || null,
      citations: null,
    })
  }
  return out
}

export async function searchSemanticScholar(query, limit = 12) {
  const url =
    'https://api.semanticscholar.org/graph/v1/paper/search?query=' +
    encodeURIComponent(query) +
    `&limit=${Math.min(limit, 20)}` +
    '&fields=title,authors,year,venue,abstract,openAccessPdf,externalIds,citationCount,url'
  const json = await fetchWithTimeout(url, { as: 'json' })
  const items = Array.isArray(json?.data) ? json.data : []
  return items.map((item) => ({
    source: 's2',
    id: item.paperId,
    title: item.title || '',
    authors: (item.authors || []).map((a) => a.name).filter(Boolean),
    year: item.year ? String(item.year) : '',
    venue: item.venue || '',
    abstract: item.abstract || '',
    pdfUrl: item.openAccessPdf?.url || null,
    url: item.url || (item.paperId ? `https://www.semanticscholar.org/paper/${item.paperId}` : null),
    doi: item.externalIds?.DOI || null,
    arxivId: item.externalIds?.ArXiv || null,
    citations: typeof item.citationCount === 'number' ? item.citationCount : null,
  }))
}

export async function searchCrossref(query, limit = 12) {
  const url =
    'https://api.crossref.org/works?rows=' +
    Math.min(limit, 20) +
    '&query.bibliographic=' +
    encodeURIComponent(query) +
    '&select=DOI,title,author,issued,container-title,abstract,URL,link,type'
  const json = await fetchWithTimeout(url, { as: 'json' })
  const items = json?.message?.items || []
  return items.map((item) => {
    const pdfLink = (item.link || []).find((l) => /pdf/i.test(l['content-type'] || '') || /\.pdf$/i.test(l.URL || ''))
    return {
      source: 'crossref',
      id: item.DOI,
      title: (item.title || [''])[0],
      authors: (item.author || [])
        .map((a) => [a.given, a.family].filter(Boolean).join(' '))
        .filter(Boolean),
      year: item.issued?.['date-parts']?.[0]?.[0] ? String(item.issued['date-parts'][0][0]) : '',
      venue: (item['container-title'] || [''])[0] || '',
      abstract: stripTags(item.abstract),
      pdfUrl: pdfLink?.URL || null,
      url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : null),
      doi: item.DOI || null,
      arxivId: null,
      citations: item['is-referenced-by-count'] ?? null,
    }
  })
}

export async function searchSources(query, source = 'all', limit = 12) {
  const tasks = []
  if (source === 'all' || source === 'arxiv') tasks.push({ source: 'arxiv', run: searchArxiv(query, limit) })
  if (source === 'all' || source === 's2') tasks.push({ source: 's2', run: searchSemanticScholar(query, limit) })
  if (source === 'all' || source === 'crossref')
    tasks.push({ source: 'crossref', run: searchCrossref(query, limit) })
  const settled = await Promise.allSettled(tasks.map((t) => t.run))
  const results = []
  const errors = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      results.push(...result.value)
    } else {
      errors.push({ source: tasks[index].source, message: String(result.reason?.message || result.reason) })
    }
  })
  const seen = new Set()
  const deduped = []
  for (const item of results) {
    const key = (item.doi || item.arxivId || item.title || '').toLowerCase().replace(/\s+/g, ' ').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }
  deduped.sort((a, b) => Number(b.pdfUrl ? 1 : 0) - Number(a.pdfUrl ? 1 : 0) || (b.citations || 0) - (a.citations || 0))
  return { results: deduped.slice(0, limit * 2), errors }
}

export async function downloadPdf(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(60000),
    redirect: 'follow',
  })
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length < 1024) throw new Error('下载内容为空')
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('该链接返回的不是 PDF（可能需要登录）')
  return buffer
}

/** Turn an abstract-page URL into a direct PDF URL when the pattern is known. */
export function pdfUrlFor(item) {
  if (item.pdfUrl) return item.pdfUrl
  if (item.arxivId) return `https://arxiv.org/pdf/${item.arxivId}`
  if (item.url && /arxiv\.org\/abs\//.test(item.url)) return item.url.replace('/abs/', '/pdf/')
  return null
}
