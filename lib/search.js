/** Local full-text search over indexed papers. */

function normalize(text) {
  return String(text || '').toLowerCase()
}

function tokenize(query) {
  return normalize(query)
    .split(/[\s,，;；]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 8)
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0
  let count = 0
  let index = 0
  for (;;) {
    const found = haystack.indexOf(needle, index)
    if (found === -1) break
    count++
    index = found + needle.length
    if (count >= 40) break
  }
  return count
}

function snippetOf(text, terms) {
  const body = String(text || '').replace(/\s+/g, ' ')
  for (const term of terms) {
    const at = body.toLowerCase().indexOf(term)
    if (at >= 0) {
      const start = Math.max(0, at - 90)
      return (start > 0 ? '…' : '') + body.slice(start, at + 160).trim() + '…'
    }
  }
  return body.slice(0, 200)
}

export function matchFilters(paper, filters = {}) {
  if (paper.missing && !filters.includeMissing) return false
  if (filters.category && filters.category !== 'all') {
    const cat = paper.category || '未分类'
    if (filters.category === '未分类' ? cat !== '未分类' : cat !== filters.category) return false
  }
  if (filters.status && filters.status !== 'all') {
    const status = paper.status || 'unread'
    if (status !== filters.status) return false
  }
  if (filters.tag) {
    const tags = paper.tags || []
    if (!tags.includes(filters.tag)) return false
  }
  if (filters.year && String(paper.year || '') !== String(filters.year)) return false
  if (filters.hasFigures && !(paper.figures || []).length) return false
  return true
}

export function searchPapers(papers, query, filters = {}, limit = 60) {
  const terms = tokenize(query)
  const filtered = papers.filter((paper) => matchFilters(paper, filters))
  if (!terms.length) {
    return filtered
      .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)))
      .slice(0, limit)
      .map((paper) => ({ paper, score: 0, snippet: (paper.abstract || paper.text || '').slice(0, 180) }))
  }
  const results = []
  for (const paper of filtered) {
    const title = normalize(paper.title)
    const authors = normalize((paper.authors || []).join(' '))
    const tags = normalize((paper.tags || []).join(' '))
    const category = normalize(paper.category)
    const abstract = normalize(paper.abstract)
    const note = normalize(paper.note)
    const text = normalize(paper.text)
    let score = 0
    let matchedTerms = 0
    for (const term of terms) {
      let termScore = 0
      if (title.includes(term)) termScore += 12
      if (tags.includes(term)) termScore += 6
      if (authors.includes(term)) termScore += 5
      if (category.includes(term)) termScore += 4
      if (abstract.includes(term)) termScore += 4
      if (note.includes(term)) termScore += 4
      const hits = countOccurrences(text, term)
      if (hits) termScore += Math.min(hits, 20)
      if (termScore > 0) matchedTerms++
      score += termScore
    }
    if (!score) continue
    // Reward papers matching every term.
    if (matchedTerms === terms.length) score = Math.round(score * 1.35) + 5
    results.push({ paper, score, snippet: snippetOf(paper.abstract || paper.text, terms) })
  }
  results.sort((a, b) => b.score - a.score || String(b.paper.addedAt).localeCompare(String(a.paper.addedAt)))
  return results.slice(0, limit)
}

/** Highlight offsets for the reader's text view. */
export function findInText(text, query) {
  const terms = tokenize(query)
  if (!terms.length) return []
  const body = String(text || '')
  const lower = body.toLowerCase()
  const hits = []
  for (const term of terms) {
    let index = 0
    for (;;) {
      const at = lower.indexOf(term, index)
      if (at === -1) break
      hits.push({ start: at, end: at + term.length })
      index = at + term.length
      if (hits.length > 400) break
    }
  }
  hits.sort((a, b) => a.start - b.start)
  return hits
}
