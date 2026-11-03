/**
 * LLM access for the reading assistant.
 *
 * Uses the Harness' own `llm` service, so the paper chat answers with whatever
 * model the user already configured (provider + model from agentDefaultModel).
 */
import { truncate } from './util.js'

const CHAT_SYSTEM = [
  '你是一位严谨的科研阅读助手，正在陪用户精读一篇论文。',
  '回答规则：',
  '1. 先给结论，再给依据；依据要落到论文的具体位置（章节 / 图号 / 页码）。',
  '2. 涉及公式时用文字说明其含义与用途，不要只抄公式。',
  '3. 引用原文时用「」括起来，并说明是原文还是你的解释。',
  '4. 论文没写的内容就明确说"论文没有提到"，不要编造。',
  '5. 用中文回答；专有名词保留英文原文，便于用户查证。',
].join('\n')

const TRANSLATE_SYSTEM = [
  '你是一名学术论文翻译，把英文论文片段译成准确、通顺的中文。',
  '要求：术语按领域惯例翻译并在必要时保留英文原名；保留公式、编号、参考文献标记（如 [12]、Fig. 3、Eq. (2)）原样；',
  '保持段落结构；只输出译文，不要解释、不要加标题、不要总结。',
].join('\n')

const MAX_CONTEXT_CHARS = 26000

export function createLlm({ ctx, log = () => {} }) {
  function llmService() {
    try {
      return ctx.get?.('llm') || null
    } catch {
      return null
    }
  }

  function resolveModel() {
    let selection = null
    try {
      selection = ctx.get?.('agentDefaultModel')?.currentSelection?.() || null
    } catch {}
    const provider = selection?.provider || ''
    const model = selection?.model || ''
    return { provider, model, available: Boolean(provider && model && llmService()) }
  }

  let cachedEffort

  /**
   * The cheapest reasoning effort the selected model supports.
   *
   * Reading a paper and translating it do not need deep reasoning, and a model
   * that thinks for a minute before every paragraph makes the panel feel dead.
   */
  async function fastEffort() {
    if (cachedEffort !== undefined) return cachedEffort
    cachedEffort = null
    try {
      const service = llmService()
      const { provider, model } = resolveModel()
      if (!service || !provider || !model) return null
      const info = await service.resolveModelInfo(provider, model)
      const efforts = (info?.reasoning?.efforts || []).map((entry) => String(entry.id))
      const rank = (id) => {
        const index = ['none', 'off', 'minimal', 'low', 'medium', 'high'].indexOf(id.toLowerCase())
        return index < 0 ? 99 : index
      }
      cachedEffort = efforts.slice().sort((a, b) => rank(a) - rank(b))[0] || null
    } catch {
      cachedEffort = null
    }
    return cachedEffort
  }

  async function* streamOnce(options) {
    const service = llmService()
    const stream = service.stream(options)
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') {
        if (chunk.text) yield chunk.text
        continue
      }
      if (chunk.type === 'finish') {
        const reason = chunk.reason
        if (reason.kind === 'error') throw new Error(reason.failure?.message || '模型调用失败')
        if (reason.kind === 'aborted') {
          const error = new Error('已取消')
          error.aborted = true
          throw error
        }
      }
    }
  }

  function paperContext(paper, focus) {
    const parts = []
    parts.push(`题目：${paper.title || paper.fileName}`)
    if (paper.authors?.length) parts.push(`作者：${paper.authors.slice(0, 8).join(', ')}`)
    const meta = [paper.year, paper.venue, paper.doi ? `DOI ${paper.doi}` : '', paper.arxivId ? `arXiv:${paper.arxivId}` : '']
      .filter(Boolean)
      .join(' · ')
    if (meta) parts.push(meta)
    if (paper.abstract) parts.push(`\n【摘要】\n${paper.abstract}`)
    if (focus?.text) {
      parts.push(`\n【用户当前选中的原文${focus.page ? `（第 ${focus.page} 页）` : ''}】\n${truncate(focus.text, 6000)}`)
    }
    if (focus?.page && Array.isArray(paper.pages) && paper.pages[focus.page - 1]) {
      parts.push(`\n【第 ${focus.page} 页原文】\n${truncate(paper.pages[focus.page - 1], 8000)}`)
    }
    const full = String(paper.text || '')
    parts.push(
      `\n【论文正文${full.length > MAX_CONTEXT_CHARS ? `（前 ${MAX_CONTEXT_CHARS} 字，原文共 ${full.length} 字）` : ''}】\n${truncate(full, MAX_CONTEXT_CHARS)}`,
    )
    return parts.join('\n')
  }

  function buildMessages(history, question) {
    const messages = []
    const { provider, model } = resolveModel()
    for (const item of history || []) {
      if (!item || !item.content) continue
      const text = String(item.content).slice(0, 8000)
      if (item.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: [{ type: 'text', text }],
          source: { kind: 'model', provider, model },
        })
      } else {
        messages.push({ role: 'user', content: [{ type: 'text', text }] })
      }
    }
    messages.push({ role: 'user', content: [{ type: 'text', text: question }] })
    return messages
  }

  async function* streamText({ system, messages, maxTokens = 4000, temperature, signal }) {
    const service = llmService()
    if (!service) throw new Error('当前环境没有可用的 llm 服务')
    const { provider, model } = resolveModel()
    if (!provider || !model) throw new Error('没有找到默认模型，请先在设置里选择模型')
    const base = { provider, model, system, messages, maxTokens, signal }
    if (typeof temperature === 'number') base.temperature = temperature
    const effort = await fastEffort()
    let produced = false
    try {
      for await (const text of streamOnce({ ...base, ...(effort ? { reasoningEffort: effort } : {}) })) {
        produced = true
        yield text
      }
      return
    } catch (error) {
      // A model that does not accept this effort fails before emitting anything.
      if (produced || !effort || !/effort|reasoning/i.test(String(error?.message || ''))) throw error
      cachedEffort = null
    }
    yield* streamOnce(base)
  }

  async function* chat({ paper, history, question, focus, signal }) {
    const system = `${CHAT_SYSTEM}\n\n=== 论文信息 ===\n${paperContext(paper, focus)}`
    yield* streamText({
      system,
      messages: buildMessages(history, question),
      maxTokens: 3000,
      signal,
    })
  }

  async function* translate(text, { signal, targetLanguage = '中文' } = {}) {
    const body = String(text || '').trim()
    if (!body) return
    yield* streamText({
      system: `${TRANSLATE_SYSTEM}\n目标语言：${targetLanguage}。`,
      messages: [{ role: 'user', content: [{ type: 'text', text: body }] }],
      maxTokens: 4000,
      temperature: 0.2,
      signal,
    })
  }

  return { resolveModel, chat, translate, streamText, splitForTranslation }
}

/** Split text into translation chunks on paragraph boundaries. */
export function splitForTranslation(text, size = 2600) {
  const source = String(text || '')
  if (!source.trim()) return []
  const paragraphs = source.split(/\n{2,}/)
  const chunks = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (paragraph.length > size) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      for (let i = 0; i < paragraph.length; i += size) chunks.push(paragraph.slice(i, i + size))
      continue
    }
    if (current.length + paragraph.length + 2 > size) {
      if (current) chunks.push(current)
      current = paragraph
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph
    }
  }
  if (current) chunks.push(current)
  return chunks
}
