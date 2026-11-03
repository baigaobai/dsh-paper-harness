/**
 * Paper Harness — browser half.
 *
 * Registers the sidebar entry and the main-panel page (library, reader, online
 * search). All data comes from the host API at /api/paper-harness.
 */
window.__ModuleLoader__.load({
  id: 'dsh-paper-harness',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const API = '/api/paper-harness'
    const PANEL_ID = 'paper-harness'

    const STR = {
      zh: {
        title: '文献台',
        subtitle: '把 PDF 丢进文献库文件夹，自动索引、图文速览、检索归类',
        searchPlaceholder: '在文献库里搜索：标题、作者、正文…',
        online: '在线检索',
        reindex: '重新索引',
        all: '全部',
        categories: '分类',
        status: '阅读状态',
        tags: '标签',
        empty: '文献库还是空的。把 PDF 拖进文献库目录下的分类文件夹，这里就会自动出现。',
        emptyFilter: '没有符合筛选条件的文献。',
        indexing: '索引中',
        unread: '未读',
        reading: '在读',
        read: '已读',
        mastered: '精读',
        back: '返回列表',
        figures: '图片速览',
        pages: '全文阅读',
        text: '文本',
        notes: '信息与笔记',
        noFigures: '这篇没有抽取到插图，可直接看全文页面。',
        noText: '没有抽取到文本（可能是扫描版 PDF）。',
        openFolder: '在资源管理器中显示',
        reparse: '重新解析',
        rating: '评分',
        note: '笔记',
        notePlaceholder: '记下这篇能为我所用的一点：方法、结论、可复用的数据/代码…',
        saved: '已保存',
        source: '来源',
        import: '入库',
        imported: '已入库',
        importing: '下载中…',
        onlineTitle: '在线检索文献',
        onlinePlaceholder: '主题、标题、DOI、arXiv 编号…',
        onlineEmpty: '输入关键词开始检索（arXiv / Semantic Scholar / Crossref）',
        hasPdf: '有 PDF',
        noPdf: '无 PDF',
        citations: '引用',
        library: '文献库',
        close: '关闭',
        pagesLabel: '页',
        figsLabel: '图',
        addTag: '添加标签后回车',
        scanning: '正在索引…',
        error: '出错了',
        chat: 'AI 阅读助手',
        chatHide: '收起',
        chatHint: '左边提问，右边读原文。在正文里选中任意句子，会浮出「问 AI / 翻译」按钮。',
        chatPlaceholder: '问点什么，例如：这个方法的物理假设是什么？（Enter 发送）',
        send: '发送',
        stop: '停止',
        clear: '清空',
        askAi: '问 AI',
        translateSelection: '翻译',
        translateFull: '全文翻译',
        retranslate: '重新翻译',
      },
      en: {
        title: 'Papers',
        subtitle: 'Drop PDFs into the library folder — indexed, figure-first, organised',
        searchPlaceholder: 'Search titles, authors, full text…',
        online: 'Search online',
        reindex: 'Reindex',
        all: 'All',
        categories: 'Categories',
        status: 'Status',
        tags: 'Tags',
        empty: 'The library is empty. Drop PDFs into a category folder under the library root.',
        emptyFilter: 'No papers match these filters.',
        indexing: 'Indexing',
        unread: 'Unread',
        reading: 'Reading',
        read: 'Read',
        mastered: 'Mastered',
        back: 'Back',
        figures: 'Figures',
        pages: 'Full text',
        text: 'Text',
        notes: 'Details & notes',
        noFigures: 'No figures were extracted — open the page view.',
        noText: 'No text layer (scanned PDF?).',
        openFolder: 'Show in folder',
        reparse: 'Reparse',
        rating: 'Rating',
        note: 'Notes',
        notePlaceholder: 'What can this paper give my own work?',
        saved: 'Saved',
        source: 'Source',
        import: 'Import',
        imported: 'Imported',
        importing: 'Downloading…',
        onlineTitle: 'Search papers online',
        onlinePlaceholder: 'Topic, title, DOI or arXiv id…',
        onlineEmpty: 'Type a query to search arXiv / Semantic Scholar / Crossref',
        hasPdf: 'PDF',
        noPdf: 'No PDF',
        citations: 'cites',
        library: 'Library',
        close: 'Close',
        pagesLabel: 'pages',
        figsLabel: 'figs',
        addTag: 'Type a tag and press Enter',
        scanning: 'Indexing…',
        error: 'Error',
        chat: 'Reading assistant',
        chatHide: 'Hide',
        chatHint: 'Ask on the left, read on the right. Select any sentence to ask or translate it.',
        chatPlaceholder: 'Ask anything, e.g. what is the physical assumption here? (Enter to send)',
        send: 'Send',
        stop: 'Stop',
        clear: 'Clear',
        askAi: 'Ask AI',
        translateSelection: 'Translate',
        translateFull: 'Translate paper',
        retranslate: 'Retranslate',
      },
    }

    let dict = STR.zh

    async function api(path, options = {}) {
      const init = { ...options }
      if (init.body && typeof init.body !== 'string') {
        init.body = JSON.stringify(init.body)
        init.headers = { 'content-type': 'application/json', ...(init.headers || {}) }
      }
      const response = await fetch(API + path, init)
      const type = response.headers.get('content-type') || ''
      const payload = type.includes('application/json') ? await response.json() : await response.text()
      if (!response.ok) {
        const message = (payload && payload.error) || response.statusText || 'request failed'
        throw new Error(message)
      }
      return payload
    }

    // ---------------------------------------------------------------- styles
    const CSS = `
.ph-root { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; }
.ph-row { display: flex; align-items: center; gap: 8px; }
.ph-col { display: flex; flex-direction: column; min-height: 0; }
.ph-header { padding: 18px 22px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); display: flex; flex-direction: column; gap: 12px; }
.ph-titlebar { display: flex; align-items: baseline; gap: 10px; }
.ph-title { font-size: 17px; font-weight: 650; letter-spacing: .2px; }
.ph-sub { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.ph-toolbar { display: flex; gap: 8px; align-items: center; }
.ph-input { flex: 1; min-width: 0; height: 32px; padding: 0 11px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 13px; outline: none; }
.ph-input:focus { border-color: var(--dsw-alias-brand-primary); }
.ph-btn { height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12.5px; cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }
.ph-btn:hover { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.ph-btn.primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
.ph-btn.primary:hover { opacity: .92; }
.ph-btn.ghost { background: transparent; border-color: transparent; color: var(--dsw-alias-label-secondary); }
.ph-btn.ghost:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.ph-btn:disabled { opacity: .5; cursor: default; }
.ph-body { flex: 1; min-height: 0; display: flex; }
.ph-facets { width: 208px; flex: none; border-right: 1px solid var(--dsw-alias-border-l1); padding: 14px 12px; overflow: auto; display: flex; flex-direction: column; gap: 18px; }
.ph-facet-title { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--dsw-alias-label-secondary); margin-bottom: 6px; }
.ph-facet-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; border-radius: 7px; cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.ph-facet-item:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.ph-facet-item.active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-weight: 600; }
.ph-count { font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.ph-content { flex: 1; min-width: 0; overflow: auto; padding: 18px 22px 40px; }
.ph-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: 14px; }
.ph-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; cursor: pointer; display: flex; flex-direction: column; transition: border-color .12s, transform .12s; }
.ph-card:hover { border-color: var(--dsw-alias-border-l2); transform: translateY(-1px); }
.ph-thumb { position: relative; aspect-ratio: 4 / 3; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.ph-thumb img { width: 100%; height: 100%; object-fit: cover; object-position: top center; display: block; }
.ph-thumb .ph-badge { position: absolute; right: 7px; top: 7px; }
.ph-card-body { padding: 10px 11px 11px; display: flex; flex-direction: column; gap: 5px; }
.ph-card-title { font-size: 12.8px; font-weight: 600; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.ph-card-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ph-badge { font-size: 10px; padding: 2px 6px; border-radius: 999px; background: rgba(0,0,0,.45); color: #fff; backdrop-filter: blur(4px); white-space: nowrap; }
.ph-badge.soft { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.ph-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.ph-reader { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.ph-reader-head { padding: 14px 22px 0; display: flex; flex-direction: column; gap: 10px; }
.ph-reader-title { font-size: 16.5px; font-weight: 650; line-height: 1.32; }
.ph-reader-meta { font-size: 12px; color: var(--dsw-alias-label-secondary); display: flex; flex-wrap: wrap; gap: 4px 12px; }
.ph-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--dsw-alias-border-l1); padding: 10px 22px 0; }
.ph-tab { padding: 7px 12px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.ph-tab:hover { color: var(--dsw-alias-label-primary); }
.ph-tab.active { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-brand-primary); font-weight: 600; }
.ph-reader-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 22px 48px; }
.ph-figs { columns: 2; column-gap: 14px; }
.ph-fig { break-inside: avoid; margin-bottom: 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.ph-fig img { width: 100%; display: block; cursor: zoom-in; background: #fff; }
.ph-fig-cap { padding: 8px 10px; font-size: 11.5px; line-height: 1.45; color: var(--dsw-alias-label-secondary); border-top: 1px solid var(--dsw-alias-border-l1); max-height: 76px; overflow: hidden; }
.ph-pages { display: flex; flex-direction: column; align-items: center; gap: 14px; }
.ph-page { width: 100%; max-width: 860px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden; background: #fff; }
.ph-page img { width: 100%; display: block; }
.ph-page-no { font-size: 11px; color: var(--dsw-alias-label-secondary); text-align: right; padding: 3px 6px; }
.ph-page-fail { padding: 40px 18px; text-align: center; font-size: 12.5px; line-height: 1.8; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); }
.ph-text { max-width: 860px; margin: 0 auto; font-size: 13.5px; line-height: 1.78; white-space: pre-wrap; word-break: break-word; }
.ph-text mark { background: rgba(255, 200, 60, .55); color: inherit; border-radius: 2px; }
.ph-panel { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
.ph-field { display: flex; flex-direction: column; gap: 7px; }
.ph-label { font-size: 11.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--dsw-alias-label-secondary); }
.ph-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden; width: fit-content; }
.ph-seg button { border: 0; background: transparent; padding: 6px 12px; font-size: 12px; cursor: pointer; color: var(--dsw-alias-label-secondary); border-right: 1px solid var(--dsw-alias-border-l1); }
.ph-seg button:last-child { border-right: 0; }
.ph-seg button.on { background: var(--dsw-alias-brand-primary); color: #fff; }
.ph-stars { display: inline-flex; gap: 2px; }
.ph-star { cursor: pointer; font-size: 16px; line-height: 1; color: var(--dsw-alias-border-l2); }
.ph-star.on { color: #f5a623; }
.ph-textarea { width: 100%; min-height: 130px; resize: vertical; padding: 10px 12px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.6; outline: none; font-family: inherit; }
.ph-textarea:focus { border-color: var(--dsw-alias-brand-primary); }
.ph-tag { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.ph-tag button { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 0 0 0 2px; font-size: 12px; }
.ph-empty { padding: 60px 20px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.8; }
.ph-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.62); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 24px; }
.ph-modal { width: min(920px, 100%); max-height: 86vh; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 70px rgba(0,0,0,.45); }
.ph-modal-head { padding: 14px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); display: flex; flex-direction: column; gap: 10px; }
.ph-modal-body { overflow: auto; padding: 14px 16px 24px; display: flex; flex-direction: column; gap: 10px; }
.ph-result { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 11px 12px; display: flex; flex-direction: column; gap: 5px; background: var(--dsw-alias-bg-layer-1); }
.ph-result-title { font-size: 13px; font-weight: 600; line-height: 1.4; }
.ph-result-abs { font-size: 11.5px; color: var(--dsw-alias-label-secondary); line-height: 1.55; max-height: 62px; overflow: hidden; }
.ph-lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.85); z-index: 70; display: flex; flex-direction: column; padding: 30px; gap: 12px; cursor: zoom-out; }
.ph-lightbox img { flex: 1; min-height: 0; object-fit: contain; width: 100%; background: #fff; border-radius: 6px; }
.ph-lightbox-cap { color: #e8e8e8; font-size: 12px; line-height: 1.5; max-height: 70px; overflow: auto; }
.ph-toasts { position: fixed; right: 18px; bottom: 18px; display: flex; flex-direction: column; gap: 8px; z-index: 90; }
.ph-toast { background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; padding: 9px 12px; font-size: 12.5px; box-shadow: 0 8px 24px rgba(0,0,0,.25); max-width: 380px; }
.ph-toast.error { border-color: var(--dsw-alias-state-error-primary); }
.ph-split { display: flex; flex: 1; min-height: 0; }
.ph-chat { width: 430px; flex: none; border-right: 1px solid var(--dsw-alias-border-l1); display: flex; flex-direction: column; min-height: 0; background: var(--dsw-alias-bg-layer-1); }
.ph-chat.collapsed { width: 40px; align-items: center; justify-content: center; }
.ph-chat-collapsed { writing-mode: vertical-rl; color: var(--dsw-alias-label-secondary); font-size: 12px; letter-spacing: .12em; padding: 16px 0; }
.ph-chat-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.ph-chat-title { font-size: 12.5px; font-weight: 650; }
.ph-chat-body { flex: 1; min-height: 0; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.ph-chat-empty { color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 1.8; display: flex; flex-direction: column; gap: 10px; }
.ph-chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
.ph-chip { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border-radius: 999px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
.ph-chip:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.ph-msg { font-size: 12.8px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.ph-msg.user { align-self: flex-end; max-width: 88%; background: var(--dsw-alias-brand-primary); color: #fff; padding: 8px 11px; border-radius: 10px 10px 2px 10px; }
.ph-msg.assistant { align-self: stretch; background: var(--dsw-alias-bg-layer-2); padding: 9px 11px; border-radius: 10px 10px 10px 2px; }
.ph-msg.translate { align-self: stretch; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); padding: 9px 11px; border-radius: 10px; }
.ph-msg.failed { border: 1px solid var(--dsw-alias-state-error-primary); }
.ph-msg-label { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-bottom: 4px; letter-spacing: .04em; }
.ph-msg-note { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 4px; }
.ph-caret { display: inline-block; animation: ph-blink 1s steps(2) infinite; color: var(--dsw-alias-brand-primary); }
@keyframes ph-blink { 50% { opacity: 0; } }
.ph-chat-error { font-size: 12px; color: var(--dsw-alias-state-error-primary); }
.ph-chat-input { border-top: 1px solid var(--dsw-alias-border-l1); padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.ph-chat-textarea { width: 100%; min-height: 66px; max-height: 200px; resize: vertical; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 12.8px; line-height: 1.6; padding: 8px 10px; outline: none; }
.ph-chat-textarea:focus { border-color: var(--dsw-alias-brand-primary); }
.ph-chat-actions { display: flex; align-items: center; gap: 8px; }
.ph-quote { border-left: 2px solid var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-base); border-radius: 0 8px 8px 0; padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; }
.ph-quote-text { font-size: 11.5px; color: var(--dsw-alias-label-secondary); line-height: 1.5; max-height: 54px; overflow: hidden; }
.ph-quote-bar { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.ph-selbar { position: fixed; z-index: 80; transform: translate(-50%, -100%); display: flex; gap: 4px; padding: 5px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.28); }
.ph-selbar .ph-btn { height: 28px; padding: 0 9px; font-size: 12px; }
.ph-pane { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.ph-text-page { margin-bottom: 22px; }
.ph-text-page-label { font-size: 11px; color: var(--dsw-alias-label-secondary); border-bottom: 1px dashed var(--dsw-alias-border-l1); padding-bottom: 3px; margin-bottom: 8px; letter-spacing: .06em; }
.ph-text-body { white-space: pre-wrap; }
.ph-resizer { width: 5px; flex: none; cursor: col-resize; background: transparent; }
.ph-resizer:hover { background: var(--dsw-alias-brand-primary); opacity: .35; }
.ph-tr { flex: none; border-left: 1px solid var(--dsw-alias-border-l1); display: flex; flex-direction: column; min-height: 0; background: var(--dsw-alias-bg-layer-1); }
.ph-tr-head { padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); display: flex; flex-direction: column; gap: 8px; }
.ph-tr-body { flex: 1; min-height: 0; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.ph-tr-item { border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-base); overflow: hidden; }
.ph-tr-item-head { display: flex; align-items: center; gap: 6px; padding: 5px 9px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 11px; color: var(--dsw-alias-label-secondary); }
.ph-doc-toolbar { position: sticky; top: 0; z-index: 6; display: flex; align-items: center; gap: 8px; padding: 4px 0 10px; background: var(--dsw-alias-bg-base); }
.ph-doc { display: flex; flex-direction: column; align-items: center; gap: 18px; }
.ph-doc-page { width: 100%; max-width: 1000px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden; background: #fff; }
.ph-doc-canvas { position: relative; }
.ph-doc-canvas > img { display: block; width: 100%; }
.ph-doc-no { font-size: 11px; color: var(--dsw-alias-label-secondary); text-align: right; padding: 3px 7px; background: var(--dsw-alias-bg-layer-1); }
.ph-textlayer { position: absolute; inset: 0; line-height: 1; }
.ph-textlayer > span { position: absolute; color: transparent; white-space: pre; overflow: hidden; line-height: 1; cursor: text; transform-origin: 0 50%; }
.ph-textlayer > span::selection { background: rgba(59, 130, 246, .38); }
.ph-textlayer > span.ph-hit { background: rgba(255, 205, 0, .45); }
.ph-hint { margin: 0 0 10px; padding: 8px 12px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); display: flex; align-items: center; }
.ph-tr-item-body { padding: 8px 10px; font-size: 12.6px; line-height: 1.72; white-space: pre-wrap; word-break: break-word; }
.ph-num { width: 52px; height: 26px; padding: 0 6px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 12px; text-align: center; }
.ph-progress { height: 3px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.ph-progress i { display: block; height: 100%; background: var(--dsw-alias-brand-primary); transition: width .3s; }
@media (max-width: 900px) { .ph-facets { display: none; } .ph-grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); } .ph-figs { columns: 1; } }
@media (max-width: 1180px) { .ph-chat { width: 340px; } }
@media (max-width: 980px) { .ph-chat { width: 300px; } .ph-msg { font-size: 12.4px; } }
`

    // ------------------------------------------------------------- utilities
    const STATUS_COLOR = {
      unread: 'var(--dsw-alias-state-idle-primary)',
      reading: 'var(--dsw-alias-brand-primary)',
      read: 'var(--dsw-alias-state-success-primary)',
      mastered: 'var(--dsw-alias-state-warn-primary)',
    }

    function statusText(status) {
      return dict[status] || dict.unread
    }

    function fmtDate(iso) {
      if (!iso) return ''
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${date.getFullYear()}-${month}-${day}`
    }

    function useDebounced(value, delay) {
      const [debounced, setDebounced] = useState(value)
      useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay)
        return () => clearTimeout(timer)
      }, [value, delay])
      return debounced
    }

    // --------------------------------------------------------------- widgets
    function Icon(props) {
      const size = props.size || 18
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 64 64',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M14 6h26l14 14v36a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z',
          fill: props.active ? 'var(--dsw-alias-brand-primary)' : 'none',
          stroke: props.active ? 'var(--dsw-alias-brand-primary)' : 'currentColor',
          strokeWidth: 3.2,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M20 40l6-8 5 4 6-9 6 7',
          fill: 'none',
          stroke: props.active ? '#fff' : 'currentColor',
          strokeWidth: 3.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('circle', { cx: 44, cy: 44, r: 9, fill: 'none', stroke: props.active ? '#fff' : 'currentColor', strokeWidth: 3.4 }),
        h('path', { d: 'M51 51l6 6', stroke: props.active ? '#fff' : 'currentColor', strokeWidth: 4, strokeLinecap: 'round' }),
      )
    }

    function Stars({ value, onChange }) {
      const stars = []
      for (let i = 1; i <= 5; i++) {
        stars.push(
          h(
            'span',
            {
              key: i,
              className: 'ph-star' + (value >= i ? ' on' : ''),
              onClick: () => onChange(value === i ? null : i),
              title: i + ' 星',
            },
            '★',
          ),
        )
      }
      return h('div', { className: 'ph-stars' }, stars)
    }

    function Toasts({ items }) {
      if (!items.length) return null
      return h(
        'div',
        { className: 'ph-toasts' },
        items.map((toast) => h('div', { key: toast.id, className: 'ph-toast' + (toast.error ? ' error' : '') }, toast.text)),
      )
    }

    // ------------------------------------------------------------------ app
    function App() {
      const [state, setState] = useState(null)
      const [items, setItems] = useState([])
      const [filters, setFilters] = useState({ q: '', category: 'all', status: 'all', tag: '' })
      const [paper, setPaper] = useState(null)
      const [loadingPaper, setLoadingPaper] = useState(false)
      const [onlineOpen, setOnlineOpen] = useState(false)
      const [toasts, setToasts] = useState([])
      const [error, setError] = useState('')
      const debouncedQuery = useDebounced(filters.q, 260)
      const revRef = useRef(-1)

      const toast = useCallback((text, isError) => {
        const id = Math.random().toString(36).slice(2)
        setToasts((list) => [...list, { id, text, error: isError }])
        setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), isError ? 6000 : 2600)
      }, [])

      const refreshState = useCallback(async () => {
        try {
          const next = await api('/state')
          setState(next)
          return next
        } catch (err) {
          setError(String(err.message || err))
          return null
        }
      }, [])

      const refreshList = useCallback(async () => {
        try {
          const params = new URLSearchParams()
          if (debouncedQuery) params.set('q', debouncedQuery)
          if (filters.category !== 'all') params.set('category', filters.category)
          if (filters.status !== 'all') params.set('status', filters.status)
          if (filters.tag) params.set('tag', filters.tag)
          const data = await api('/papers?' + params.toString())
          setItems(data.items || [])
        } catch (err) {
          setError(String(err.message || err))
        }
      }, [debouncedQuery, filters.category, filters.status, filters.tag])

      useEffect(() => {
        refreshState()
      }, [refreshState])

      useEffect(() => {
        refreshList()
      }, [refreshList])

      // Poll for index progress / external changes.
      useEffect(() => {
        let alive = true
        const timer = setInterval(async () => {
          if (!alive) return
          const next = await refreshState()
          if (!alive || !next) return
          if (next.rev !== revRef.current) {
            revRef.current = next.rev
            refreshList()
          }
        }, 4000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [refreshState, refreshList])

      const openPaper = useCallback(
        async (id) => {
          setLoadingPaper(true)
          try {
            const full = await api('/paper/' + encodeURIComponent(id))
            setPaper(full)
          } catch (err) {
            toast(dict.error + '：' + String(err.message || err), true)
          } finally {
            setLoadingPaper(false)
          }
        },
        [toast],
      )

      const patchPaper = useCallback(
        async (id, patch) => {
          try {
            const updated = await api('/paper/' + encodeURIComponent(id), { method: 'POST', body: { patch } })
            setPaper((current) => (current && current.id === id ? { ...current, ...updated } : current))
            setItems((list) => list.map((item) => (item.id === id ? { ...item, ...updated } : item)))
            return updated
          } catch (err) {
            toast(dict.error + '：' + String(err.message || err), true)
            return null
          }
        },
        [toast],
      )

      const onImported = useCallback(
        (created) => {
          toast('已入库：' + (created.title || created.fileName))
          refreshState()
          refreshList()
        },
        [refreshState, refreshList, toast],
      )

      const onMoved = useCallback(
        async (paperId) => {
          await refreshState()
          await refreshList()
          try {
            const full = await api('/paper/' + encodeURIComponent(paperId))
            setPaper(full)
          } catch {}
          toast('已移动')
        },
        [refreshState, refreshList, toast],
      )

      const onReload = useCallback(async (paperId) => {
        try {
          const full = await api('/paper/' + encodeURIComponent(paperId))
          setPaper(full)
        } catch {}
      }, [])

      if (!state && error) {
        return h('div', { className: 'ph-root' }, h('div', { className: 'ph-empty' }, error))
      }

      return h(
        'div',
        { className: 'ph-root' },
        h('style', null, CSS),
        h(Header, {
          state,
          filters,
          setFilters,
          onOnline: () => setOnlineOpen(true),
          onReindex: async () => {
            try {
              await api('/reindex', { method: 'POST', body: {} })
              toast(dict.scanning)
              refreshState()
            } catch (err) {
              toast(String(err.message || err), true)
            }
          },
          paper,
          onBack: () => setPaper(null),
        }),
        state && state.scanning ? h('div', { className: 'ph-progress' }, h('i', { style: { width: progressWidth(state) } })) : null,
        paper
          ? h(Reader, { paper, patchPaper, toast, onMoved: onMoved, onBack: () => setPaper(null), llm: state ? state.llm : null, onReload })
          : h(
              'div',
              { className: 'ph-body' },
              h(Facets, { state, filters, setFilters }),
              h(
                'div',
                { className: 'ph-content' },
                items.length
                  ? h(
                      'div',
                      { className: 'ph-grid' },
                      items.map((item) => h(Card, { key: item.id, item, onOpen: () => openPaper(item.id) })),
                    )
                  : h(
                      'div',
                      { className: 'ph-empty' },
                      h('div', null, state && state.total ? dict.emptyFilter : dict.empty),
                      state && !state.total
                        ? h(
                            'div',
                            { style: { marginTop: 10, fontSize: 12, opacity: 0.75, wordBreak: 'break-all' } },
                            state.libraryRoot,
                          )
                        : null,
                      state && !state.total
                        ? h(
                            'button',
                            {
                              className: 'ph-btn',
                              style: { marginTop: 14 },
                              onClick: () => api('/reveal', { method: 'POST', body: {} }).catch(() => {}),
                            },
                            '⧉ ' + dict.openFolder,
                          )
                        : null,
                    ),
              ),
            ),
        loadingPaper ? h('div', { className: 'ph-empty', style: { position: 'fixed', inset: 'auto 0 0 0', padding: 8 } }, '…') : null,
        onlineOpen ? h(OnlineSearch, { onClose: () => setOnlineOpen(false), onImported, toast, category: filters.category === 'all' ? '' : filters.category }) : null,
        h(Toasts, { items: toasts }),
      )
    }

    function progressWidth(state) {
      const { done, total } = state.progress || {}
      if (!total) return '30%'
      return Math.max(4, Math.round((done / total) * 100)) + '%'
    }

    // --------------------------------------------------------------- header
    function Header({ state, filters, setFilters, onOnline, onReindex, paper, onBack }) {
      return h(
        'div',
        { className: 'ph-header' },
        h(
          'div',
          { className: 'ph-titlebar' },
          h('div', { className: 'ph-title' }, paper ? dict.library : dict.title),
          h(
            'div',
            { className: 'ph-sub' },
            state
              ? `${state.total} 篇 · ${state.categories.length} 个分类${state.scanning ? ` · ${dict.scanning} ${state.progress?.done || 0}/${state.progress?.total || 0}` : ''}`
              : '',
          ),
        ),
        paper
          ? null
          : h(
              'div',
              { className: 'ph-toolbar' },
              h('input', {
                className: 'ph-input',
                placeholder: dict.searchPlaceholder,
                value: filters.q,
                onChange: (event) => setFilters({ ...filters, q: event.target.value }),
              }),
              h('button', { className: 'ph-btn', onClick: onOnline }, '⌕ ' + dict.online),
              h('button', { className: 'ph-btn ghost', onClick: onReindex, title: state?.libraryRoot || '' }, '↻ ' + dict.reindex),
            ),
      )
    }

    // --------------------------------------------------------------- facets
    function Facets({ state, filters, setFilters }) {
      if (!state) return h('div', { className: 'ph-facets' })
      const set = (patch) => setFilters({ ...filters, ...patch })
      const statuses = ['unread', 'reading', 'read', 'mastered']
      return h(
        'div',
        { className: 'ph-facets' },
        h(
          'div',
          null,
          h('div', { className: 'ph-facet-title' }, dict.categories),
          h(
            'div',
            {
              className: 'ph-facet-item' + (filters.category === 'all' ? ' active' : ''),
              onClick: () => set({ category: 'all' }),
            },
            h('span', null, dict.all),
            h('span', { className: 'ph-count' }, String(state.total)),
          ),
          state.categories.map((category) =>
            h(
              'div',
              {
                key: category.name,
                className: 'ph-facet-item' + (filters.category === category.name ? ' active' : ''),
                onClick: () => set({ category: category.name }),
                title: category.name,
              },
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, category.name),
              h('span', { className: 'ph-count' }, String(category.count)),
            ),
          ),
        ),
        h(
          'div',
          null,
          h('div', { className: 'ph-facet-title' }, dict.status),
          h(
            'div',
            { className: 'ph-facet-item' + (filters.status === 'all' ? ' active' : ''), onClick: () => set({ status: 'all' }) },
            h('span', null, dict.all),
          ),
          statuses.map((status) =>
            h(
              'div',
              {
                key: status,
                className: 'ph-facet-item' + (filters.status === status ? ' active' : ''),
                onClick: () => set({ status }),
              },
              h(
                'span',
                { className: 'ph-row', style: { gap: 7 } },
                h('i', { className: 'ph-dot', style: { background: STATUS_COLOR[status] } }),
                dict[status],
              ),
              h('span', { className: 'ph-count' }, String(state.statusCounts[status] || 0)),
            ),
          ),
        ),
        state.tags.length
          ? h(
              'div',
              null,
              h('div', { className: 'ph-facet-title' }, dict.tags),
              h(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } },
                state.tags.slice(0, 24).map((tag) =>
                  h(
                    'span',
                    {
                      key: tag.name,
                      className: 'ph-tag',
                      style: filters.tag === tag.name ? { outline: '1px solid var(--dsw-alias-brand-primary)' } : null,
                      onClick: () => set({ tag: filters.tag === tag.name ? '' : tag.name }),
                    },
                    tag.name,
                    h('span', { style: { opacity: 0.6 } }, String(tag.count)),
                  ),
                ),
              ),
            )
          : null,
      )
    }

    // ----------------------------------------------------------------- card
    function Card({ item, onOpen }) {
      const figureCount = (item.figures || []).length
      return h(
        'div',
        { className: 'ph-card', onClick: onOpen, title: item.title || item.fileName },
        h(
          'div',
          { className: 'ph-thumb' },
          item.cover ? h('img', { src: `${API}/cover/${item.id}`, loading: 'lazy', alt: '' }) : null,
          h(
            'span',
            { className: 'ph-badge' },
            h('i', {
              style: {
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: 3,
                marginRight: 4,
                background: STATUS_COLOR[item.status] || STATUS_COLOR.unread,
              },
            }),
            statusText(item.status),
          ),
        ),
        h(
          'div',
          { className: 'ph-card-body' },
          h('div', { className: 'ph-card-title' }, item.title || item.fileName),
          h(
            'div',
            { className: 'ph-card-meta' },
            [item.authors?.slice(0, 2).join(', '), item.year, item.venue].filter(Boolean).join(' · ') || item.category,
          ),
          h(
            'div',
            { className: 'ph-card-meta' },
            `${item.pageCount || 0} ${dict.pagesLabel} · ${figureCount} ${dict.figsLabel}` +
              (item.tags?.length ? ' · ' + item.tags.slice(0, 2).join(' / ') : ''),
          ),
        ),
      )
    }

    // --------------------------------------------------------------- reader
    function Reader({ paper, patchPaper, toast, onMoved, onBack, llm, onReload }) {
      const [tab, setTab] = useState('doc')
      const [lightbox, setLightbox] = useState(null)
      const [zoom, setZoom] = useState(1.7)
      const [note, setNote] = useState(paper.note || '')
      const [tagDraft, setTagDraft] = useState('')
      const [quote, setQuote] = useState(null)
      const [translateRequest, setTranslateRequest] = useState(null)
      const [selection, setSelection] = useState(null)
      const [chatOpen, setChatOpen] = useState(true)
      const [translateOpen, setTranslateOpen] = useState(false)
      const [translateStart, setTranslateStart] = useState(null)
      const [currentPage, setCurrentPage] = useState(1)
      const [chatWidth, setChatWidth] = useState(380)
      const [translateWidth, setTranslateWidth] = useState(420)
      const noteTimer = useRef(null)
      const paneRef = useRef(null)
      const bodyRef = useRef(null)

      const dragChat = (event) => beginDrag(event, chatWidth, setChatWidth, 260, 720, false)
      const dragTranslate = (event) => beginDrag(event, translateWidth, setTranslateWidth, 300, 760, true)

      const handleScroll = () => {
        const box = bodyRef.current
        if (!box) return
        const sections = box.querySelectorAll('[data-page]')
        if (!sections.length) return
        const top = box.getBoundingClientRect().top
        let page = Number(sections[0].getAttribute('data-page')) || 1
        for (const section of sections) {
          if (section.getBoundingClientRect().top - top <= 72) page = Number(section.getAttribute('data-page')) || page
          else break
        }
        setCurrentPage((previous) => (previous === page ? previous : page))
      }

      const openTranslation = () => {
        setTranslateOpen(true)
        setTranslateStart({ id: Date.now(), from: 1, to: paper.pageCount || 1 })
      }

      useEffect(() => {
        setNote(paper.note || '')
      }, [paper.id])

      useEffect(() => {
        function onKey(event) {
          if (event.key === 'Escape') {
            if (lightbox) setLightbox(null)
            else if (selection) setSelection(null)
            else onBack()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [lightbox, selection, onBack])

      // Select text on the right → offer "ask" / "translate" right where it is.
      useEffect(() => {
        function onUp(event) {
          if (!paneRef.current) return
          if (event && event.target && !paneRef.current.contains(event.target)) return
          const sel = window.getSelection()
          const text = sel && sel.toString ? sel.toString().trim() : ''
          if (!text || text.length < 2) {
            setSelection(null)
            return
          }
          const range = sel.rangeCount ? sel.getRangeAt(0) : null
          if (!range || !paneRef.current.contains(range.commonAncestorContainer)) {
            setSelection(null)
            return
          }
          const rect = range.getBoundingClientRect()
          let node = range.commonAncestorContainer
          if (node && node.nodeType === 3) node = node.parentElement
          const holder = node && node.closest ? node.closest('[data-page]') : null
          const page = holder ? Number(holder.getAttribute('data-page')) || null : null
          setSelection({ text: text.slice(0, 6000), x: rect.left + rect.width / 2, y: rect.top, page })
        }
        function onDown(event) {
          if (event && event.target && event.target.closest && event.target.closest('.ph-selbar')) return
          setSelection(null)
        }
        document.addEventListener('mouseup', onUp)
        document.addEventListener('mousedown', onDown)
        return () => {
          document.removeEventListener('mouseup', onUp)
          document.removeEventListener('mousedown', onDown)
        }
      }, [])

      const saveNote = (value) => {
        setNote(value)
        if (noteTimer.current) clearTimeout(noteTimer.current)
        noteTimer.current = setTimeout(() => patchPaper(paper.id, { note: value }), 700)
      }

      const addTag = () => {
        const tag = tagDraft.trim()
        if (!tag) return
        const tags = [...new Set([...(paper.tags || []), tag])]
        setTagDraft('')
        patchPaper(paper.id, { tags })
      }

      const askAboutSelection = () => {
        if (!selection) return
        setQuote({ text: selection.text, page: selection.page })
        setChatOpen(true)
        setSelection(null)
        window.getSelection()?.removeAllRanges()
      }

      const translateSelection = () => {
        if (!selection) return
        setChatOpen(true)
        setTranslateRequest({
          id: Date.now(),
          text: selection.text,
          label: selection.page ? `第 ${selection.page} 页选段` : '选中片段',
        })
        setSelection(null)
        window.getSelection()?.removeAllRanges()
      }

      const regenerateLayer = async () => {
        try {
          toast('正在重建文本层…')
          await api('/paper/' + encodeURIComponent(paper.id) + '/reparse', { method: 'POST', body: {} })
          if (onReload) await onReload(paper.id)
          toast('文本层已重建')
        } catch (error) {
          toast(String(error?.message || error), true)
        }
      }

      const tabs = [
        ['doc', '原文'],
        ['figures', dict.figures + ` (${(paper.figures || []).length})`],
        ['notes', dict.notes],
      ]

      return h(
        'div',
        { className: 'ph-reader' },
        h(
          'div',
          { className: 'ph-reader-head' },
          h(
            'div',
            { className: 'ph-row', style: { gap: 10 } },
            h('button', { className: 'ph-btn ghost', onClick: onBack }, '← ' + dict.back),
            h('span', { className: 'ph-sub' }, paper.category),
            h('span', { style: { flex: 1 } }),
            h(
              'button',
              { className: 'ph-btn ghost', onClick: () => setChatOpen((open) => !open) },
              chatOpen ? '⟨ ' + dict.chatHide : '⟩ ' + dict.chat,
            ),
            h('button', { className: 'ph-btn ghost', onClick: openTranslation }, '文A ' + dict.translateFull),
            h('button', { className: 'ph-btn ghost', onClick: () => api('/reveal', { method: 'POST', body: { id: paper.id } }).catch(() => {}) }, '⧉ ' + dict.openFolder),
          ),
          h('div', { className: 'ph-reader-title' }, paper.title || paper.fileName),
          h(
            'div',
            { className: 'ph-reader-meta' },
            h('span', null, (paper.authors || []).slice(0, 6).join(', ') || '—'),
            h('span', null, paper.year || ''),
            h('span', null, paper.venue || ''),
            h('span', null, `${paper.pageCount || 0} ${dict.pagesLabel}`),
            paper.doi ? h('a', { href: 'https://doi.org/' + paper.doi, target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-alias-brand-primary)' } }, 'DOI') : null,
            paper.arxivId ? h('a', { href: 'https://arxiv.org/abs/' + paper.arxivId, target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-alias-brand-primary)' } }, 'arXiv') : null,
            h(
              'span',
              { className: 'ph-row', style: { gap: 6 } },
              h('i', { className: 'ph-dot', style: { background: STATUS_COLOR[paper.status] || STATUS_COLOR.unread } }),
              statusText(paper.status),
            ),
            paper.rating ? h('span', null, '★'.repeat(paper.rating)) : null,
          ),
        ),
        h(
          'div',
          { className: 'ph-split' },
          h(ChatPanel, {
            paper,
            llm,
            toast,
            quote,
            onClearQuote: () => setQuote(null),
            translateRequest,
            collapsed: !chatOpen,
            width: chatWidth,
          }),
          chatOpen ? h('div', { className: 'ph-resizer', onMouseDown: dragChat }) : null,
          h(
            'div',
            { className: 'ph-pane', ref: paneRef },
            h(
              'div',
              { className: 'ph-tabs' },
              tabs.map(([key, label]) =>
                h('div', { key, className: 'ph-tab' + (tab === key ? ' active' : ''), onClick: () => setTab(key) }, label),
              ),
            ),
            h(
              'div',
              { className: 'ph-reader-body', ref: bodyRef, onScroll: handleScroll },
              tab === 'doc'
                ? h(DocumentReader, { paper, zoom, setZoom, onNeedLayout: regenerateLayer })
                : null,
              tab === 'figures' ? h(FigureGallery, { paper, onZoom: setLightbox }) : null,
              tab === 'notes'
                ? h(NotesPanel, { paper, patchPaper, note, saveNote, addTag, tagDraft, setTagDraft, toast, onMoved })
                : null,
            ),
          ),
          translateOpen ? h('div', { className: 'ph-resizer', onMouseDown: dragTranslate }) : null,
          translateOpen
            ? h(TranslationPanel, {
                paper,
                toast,
                width: translateWidth,
                startSignal: translateStart,
                currentPage,
                onClose: () => setTranslateOpen(false),
                onOpenStart: (from, to) => setTranslateStart({ id: Date.now(), from, to }),
              })
            : null,
        ),
        selection
          ? h(
              'div',
              {
                className: 'ph-selbar',
                style: { left: Math.round(selection.x), top: Math.round(selection.y - 10) },
                onMouseDown: (event) => event.stopPropagation(),
              },
              h('button', { className: 'ph-btn primary', onClick: askAboutSelection }, '◎ ' + dict.askAi),
              h('button', { className: 'ph-btn', onClick: translateSelection }, '文A ' + dict.translateSelection),
            )
          : null,
        lightbox
          ? h(
              'div',
              { className: 'ph-lightbox', onClick: () => setLightbox(null) },
              h('img', { src: lightbox.src, alt: '' }),
              h('div', { className: 'ph-lightbox-cap' }, lightbox.caption || ''),
            )
          : null,
      )
    }

    /** Drag handle that widens/shrinks a side column. */
    function beginDrag(event, currentWidth, setWidth, min, max, invert) {
      event.preventDefault()
      const startX = event.clientX
      const move = (moveEvent) => {
        const delta = (moveEvent.clientX - startX) * (invert ? -1 : 1)
        setWidth(Math.max(min, Math.min(max, currentWidth + delta)))
      }
      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
      }
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'col-resize'
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }

    let messageSeq = 0
    const nextId = () => 'm' + ++messageSeq

    async function* sseEvents(response) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          const line = raw.split('\n').find((item) => item.startsWith('data: '))
          if (!line) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') return
          try {
            yield JSON.parse(payload)
          } catch {}
        }
      }
    }

    function ChatPanel({ paper, llm, toast, quote, onClearQuote, translateRequest, collapsed, width }) {
      const [messages, setMessages] = useState([])
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const abortRef = useRef(null)
      const bodyRef = useRef(null)
      const inputRef = useRef(null)
      const usedQuote = useRef(null)
      const usedTranslation = useRef(null)
      const available = llm ? llm.available : true

      useEffect(() => {
        if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
      }, [messages, collapsed])

      useEffect(() => {
        if (!quote || quote === usedQuote.current) return
        usedQuote.current = quote
        setDraft((current) => (current ? current : `关于这段：「${String(quote.text).slice(0, 400)}」\n`))
        setTimeout(() => inputRef.current?.focus(), 30)
      }, [quote])

      useEffect(() => {
        if (!translateRequest || translateRequest === usedTranslation.current) return
        usedTranslation.current = translateRequest
        runTranslate(translateRequest.text, translateRequest.label)
      }, [translateRequest])

      const patchMessage = (id, patch) => {
        setMessages((list) => list.map((message) => (message.id === id ? { ...message, ...patch } : message)))
        return id
      }

      const send = async (preset) => {
        const question = String(preset !== undefined ? preset : draft).trim()
        if (!question || busy) return
        if (!available) {
          toast('没有可用的模型，请先在设置里选择模型')
          return
        }
        setBusy('chat')
        setError('')
        const history = messages
          .filter((message) => message.role === 'user' || (message.role === 'assistant' && !message.streaming && !message.failed))
          .slice(-8)
          .map((message) => ({ role: message.role, content: message.text }))
        const userMessage = { id: nextId(), role: 'user', text: question }
        const replyId = nextId()
        const reply = { id: replyId, role: 'assistant', text: '', streaming: true }
        setMessages((list) => [...list, userMessage, reply])
        setDraft('')
        const controller = new AbortController()
        abortRef.current = controller
        try {
          const response = await fetch(API + '/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              paperId: paper.id,
              question,
              history,
              focus: quote ? { text: quote.text, page: quote.page } : null,
            }),
            signal: controller.signal,
          })
          if (!response.ok || !response.body) {
            const detail = await response.text().catch(() => '')
            throw new Error(detail || `请求失败（${response.status}）`)
          }
          for await (const event of sseEvents(response)) {
            if (event.delta) setMessages((list) => list.map((m) => (m.id === replyId ? { ...m, text: m.text + event.delta } : m)))
            if (event.error) throw new Error(event.error)
          }
          patchMessage(replyId, { streaming: false })
        } catch (err) {
          if (err && err.name === 'AbortError') {
            setMessages((list) => list.map((m) => (m.id === replyId ? { ...m, streaming: false, stopped: true } : m)))
          } else {
            setError(String(err?.message || err))
            patchMessage(replyId, { streaming: false, failed: true })
          }
        } finally {
          setBusy('')
          abortRef.current = null
        }
      }

      const runTranslate = async (text, label) => {
        if (!text) return
        const messageId = nextId()
        setBusy('translate')
        setError('')
        setMessages((list) => [...list, { id: messageId, role: 'translate', label: label || '译文', text: '', streaming: true }])
        const controller = new AbortController()
        abortRef.current = controller
        try {
          const response = await fetch(API + '/translate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ paperId: paper.id, text }),
            signal: controller.signal,
          })
          if (!response.ok || !response.body) throw new Error(`翻译请求失败（${response.status}）`)
          for await (const event of sseEvents(response)) {
            if (event.delta) setMessages((list) => list.map((m) => (m.id === messageId ? { ...m, text: m.text + event.delta } : m)))
            if (event.error) throw new Error(event.error)
          }
          patchMessage(messageId, { streaming: false })
        } catch (err) {
          if (err && err.name === 'AbortError') patchMessage(messageId, { streaming: false, stopped: true })
          else {
            setError(String(err?.message || err))
            patchMessage(messageId, { streaming: false, failed: true })
          }
        } finally {
          setBusy('')
          abortRef.current = null
        }
      }

      const stop = () => {
        try {
          abortRef.current?.abort()
        } catch {}
      }

      const clear = () => {
        setMessages([])
        setError('')
        onClearQuote()
      }

      if (collapsed) {
        return h('div', { className: 'ph-chat collapsed' }, h('div', { className: 'ph-chat-collapsed' }, 'AI'))
      }

      const quick = ['这篇文章在做什么？', '方法创新点是什么？', '关键实验结论有哪些？', '有哪些局限或可改进之处？']

      return h(
        'div',
        { className: 'ph-chat', style: width ? { width } : null },
        h(
          'div',
          { className: 'ph-chat-head' },
          h('span', { className: 'ph-chat-title' }, dict.chat),
          llm && llm.model ? h('span', { className: 'ph-badge soft', title: llm.provider }, llm.model) : null,
          h('span', { style: { flex: 1 } }),
          messages.length ? h('button', { className: 'ph-btn ghost', onClick: clear }, dict.clear) : null,
        ),
        h(
          'div',
          { className: 'ph-chat-body', ref: bodyRef },
          messages.length
            ? messages.map((message) => {
                if (message.role === 'translate') {
                  return h(
                    'div',
                    { key: message.id, className: 'ph-msg translate' },
                    h('div', { className: 'ph-msg-label' }, '译文 · ' + message.label),
                    h('div', null, message.text || (message.streaming ? '翻译中…' : '')),
                    message.streaming ? h('span', { className: 'ph-caret' }, '▍') : null,
                  )
                }
                return h(
                  'div',
                  { key: message.id, className: 'ph-msg ' + message.role + (message.failed ? ' failed' : '') },
                  message.text || (message.streaming ? '思考中…' : ''),
                  message.streaming ? h('span', { className: 'ph-caret' }, '▍') : null,
                  message.stopped ? h('div', { className: 'ph-msg-note' }, '（已停止）') : null,
                  message.failed ? h('div', { className: 'ph-msg-note' }, '（生成失败）') : null,
                )
              })
            : h(
                'div',
                { className: 'ph-chat-empty' },
                h('div', null, dict.chatHint),
                h(
                  'div',
                  { className: 'ph-chip-row' },
                  quick.map((item) =>
                    h('button', { key: item, className: 'ph-chip', onClick: () => send(item) }, item),
                  ),
                ),
              ),
          error ? h('div', { className: 'ph-chat-error' }, error) : null,
        ),
        h(
          'div',
          { className: 'ph-chat-input' },
          quote
            ? h(
                'div',
                { className: 'ph-quote' },
                h('div', { className: 'ph-quote-text' }, '「' + String(quote.text).slice(0, 160) + (quote.text.length > 160 ? '…' : '') + '」'),
                h(
                  'div',
                  { className: 'ph-quote-bar' },
                  h('span', { className: 'ph-quote-page' }, quote.page ? `第 ${quote.page} 页` : '选中片段'),
                  h('button', { className: 'ph-btn ghost', onClick: onClearQuote }, '×'),
                ),
              )
            : null,
          h('textarea', {
            ref: inputRef,
            className: 'ph-chat-textarea',
            placeholder: dict.chatPlaceholder,
            value: draft,
            rows: 3,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key !== 'Enter' || event.shiftKey) return
              // Chinese IME: Enter confirms the candidate, it must not send.
              if (event.nativeEvent?.isComposing || event.isComposing) return
              event.preventDefault()
              send()
            },
          }),
          h(
            'div',
            { className: 'ph-chat-actions' },
            h('span', { className: 'ph-sub' }, 'Enter 发送 · Shift+Enter 换行'),
            h('span', { style: { flex: 1 } }),
            busy ? h('button', { className: 'ph-btn', onClick: stop }, dict.stop) : null,
            h('button', { className: 'ph-btn primary', onClick: () => send(), disabled: Boolean(busy) || !draft.trim() }, dict.send),
          ),
        ),
      )
    }

    function TranslationPanel({ paper, toast, width, startSignal, currentPage, onClose, onOpenStart }) {
      const total = paper.pageCount || 1
      const [pages, setPages] = useState({})
      const [status, setStatus] = useState('idle')
      const [error, setError] = useState('')
      const [from, setFrom] = useState(1)
      const [to, setTo] = useState(total)
      const [activeRange, setActiveRange] = useState(null)
      const abortRef = useRef(null)
      const bodyRef = useRef(null)
      const loaded = useRef(false)

      const loadCache = async () => {
        try {
          const cached = await api('/translation/' + encodeURIComponent(paper.id))
          if (cached && cached.pages && Object.keys(cached.pages).length) {
            setPages(cached.pages)
            if (cached.done) setStatus('done')
          }
        } catch {}
      }

      useEffect(() => {
        if (loaded.current) return
        loaded.current = true
        loadCache()
      }, [paper.id])

      const run = async (rangeFrom, rangeTo, { clearFirst = false } = {}) => {
        if (abortRef.current) {
          try {
            abortRef.current.abort()
          } catch {}
          abortRef.current = null
        }
        const start = Math.max(1, Math.min(Number(rangeFrom) || 1, total))
        const end = Math.max(start, Math.min(Number(rangeTo) || total, total))
        setFrom(start)
        setTo(end)
        setActiveRange({ from: start, to: end })
        setStatus('running')
        setError('')
        const controller = new AbortController()
        abortRef.current = controller
        try {
          if (clearFirst) {
            await api('/translation/' + encodeURIComponent(paper.id) + '/clear', { method: 'POST', body: {} })
            setPages({})
          }
          const response = await fetch(API + '/translate/paper', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ paperId: paper.id, from: start, to: end }),
            signal: controller.signal,
          })
          if (!response.ok || !response.body) throw new Error(`翻译请求失败（${response.status}）`)
          for await (const event of sseEvents(response)) {
            if (event.error) throw new Error(event.error)
            if (event.page && event.delta) {
              setPages((current) => ({ ...current, [event.page]: (current[event.page] || '') + event.delta }))
            } else if (event.page && event.cached) {
              setPages((current) => ({ ...current, [event.page]: event.text }))
            } else if (event.done) {
              setStatus('done')
            }
            if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
          }
          setStatus((current) => (current === 'running' ? 'done' : current))
        } catch (err) {
          if (err && err.name === 'AbortError') setStatus('idle')
          else {
            setError(String(err?.message || err))
            setStatus('error')
          }
        } finally {
          abortRef.current = null
        }
      }

      useEffect(() => {
        if (!startSignal || !startSignal.id) return
        run(startSignal.from, startSignal.to)
      }, [startSignal])

      useEffect(
        () => () => {
          try {
            abortRef.current?.abort()
          } catch {}
        },
        [],
      )

      const copy = async (text) => {
        if (!text) return
        try {
          await navigator.clipboard.writeText(text)
          toast('已复制译文')
        } catch {
          const area = document.createElement('textarea')
          area.value = text
          document.body.appendChild(area)
          area.select()
          try {
            document.execCommand('copy')
            toast('已复制译文')
          } catch {
            toast('复制失败', true)
          }
          document.body.removeChild(area)
        }
      }

      const donePages = Object.keys(pages).filter((key) => pages[key]).length
      const list = []
      for (let index = 1; index <= total; index++) list.push(index)
      const running = status === 'running'

      return h(
        'div',
        { className: 'ph-tr', style: width ? { width } : null },
        h(
          'div',
          { className: 'ph-tr-head' },
          h(
            'div',
            { className: 'ph-row', style: { justifyContent: 'space-between' } },
            h('span', { className: 'ph-chat-title' }, '译文'),
            h(
              'div',
              { className: 'ph-row' },
              donePages ? h('button', { className: 'ph-btn ghost', onClick: () => copy(list.map((page) => `【第 ${page} 页】\n${pages[page] || ''}`).join('\n\n')) }, '复制全部') : null,
              h('button', { className: 'ph-btn ghost', onClick: onClose }, '✕'),
            ),
          ),
          h(
            'div',
            { className: 'ph-row', style: { gap: 6 } },
            h('span', { className: 'ph-sub' }, '从'),
            h('input', {
              className: 'ph-num',
              type: 'number',
              min: 1,
              max: total,
              value: from,
              onChange: (event) => setFrom(event.target.value),
            }),
            h('span', { className: 'ph-sub' }, '到'),
            h('input', {
              className: 'ph-num',
              type: 'number',
              min: 1,
              max: total,
              value: to,
              onChange: (event) => setTo(event.target.value),
            }),
            h('span', { className: 'ph-sub' }, `页（共 ${total}）`),
          ),
          h(
            'div',
            { className: 'ph-row', style: { gap: 6 } },
            running
              ? h('button', { className: 'ph-btn', onClick: () => abortRef.current?.abort() }, dict.stop)
              : h('button', { className: 'ph-btn primary', onClick: () => run(from, to) }, `翻译第 ${Number(from) || 1}–${Number(to) || total} 页`),
            h(
              'button',
              {
                className: 'ph-btn',
                disabled: running,
                title: `从当前阅读页（第 ${currentPage} 页）译到本页输入的上限`,
                onClick: () => run(currentPage, to),
              },
              `从第 ${currentPage} 页开始`,
            ),
          ),
          h(
            'div',
            { className: 'ph-row', style: { gap: 8 } },
            h('div', { className: 'ph-progress', style: { flex: 1 } }, h('i', { style: { width: Math.round((donePages / total) * 100) + '%' } })),
            h(
              'span',
              { className: 'ph-sub' },
              `${donePages}/${total} 页` + (activeRange ? `（本次 ${activeRange.from}–${activeRange.to}）` : ''),
            ),
          ),
          error ? h('div', { className: 'ph-sub', style: { color: 'var(--dsw-alias-state-error-primary)' } }, error) : null,
        ),
        h(
          'div',
          { className: 'ph-tr-body', ref: bodyRef },
          list.map((page) =>
            h(
              'div',
              { key: page, className: 'ph-tr-item' },
              h(
                'div',
                { className: 'ph-tr-item-head' },
                h('span', null, `第 ${page} 页`),
                h('span', { style: { flex: 1 } }),
                pages[page]
                  ? h('button', { className: 'ph-btn ghost', style: { height: 22, padding: '0 6px', fontSize: 11 }, onClick: () => copy(pages[page]) }, '复制')
                  : h(
                      'button',
                      {
                        className: 'ph-btn ghost',
                        style: { height: 22, padding: '0 6px', fontSize: 11 },
                        disabled: running,
                        onClick: () => run(page, page),
                      },
                      '译此页',
                    ),
              ),
              h(
                'div',
                { className: 'ph-tr-item-body' },
                pages[page] || (running ? '…' : h('span', { style: { opacity: 0.55 } }, '（未翻译）')),
              ),
            ),
          ),
        ),
      )
    }

    function FigureGallery({ paper, onZoom }) {
      const figures = paper.figures || []
      if (!figures.length) {
        return h('div', { className: 'ph-empty' }, dict.noFigures)
      }
      return h(
        'div',
        { className: 'ph-figs' },
        figures.map((figure) =>
          h(
            'div',
            { key: figure.i, className: 'ph-fig' },
            h('img', {
              src: `${API}/fig/${paper.id}/${figure.i}`,
              loading: 'lazy',
              alt: figure.caption || '',
              onError: (event) => {
                const box = event.currentTarget.closest('.ph-fig')
                if (box) box.style.display = 'none'
              },
              onClick: () =>
                onZoom({
                  src: `${API}/fig/${paper.id}/${figure.i}`,
                  caption: `p.${figure.page} · ${figure.caption}`,
                }),
            }),
            h(
              'div',
              { className: 'ph-fig-cap' },
              h('span', { className: 'ph-badge soft', style: { marginRight: 6 } }, 'p.' + figure.page),
              figure.caption,
            ),
          ),
        ),
      )
    }

    /**
     * The merged reader: the rendered page with a transparent text layer on top,
     * so the paper looks exactly like the PDF while every sentence stays
     * selectable for "ask AI" / "translate".
     */
    function DocumentReader({ paper, zoom, setZoom, onNeedLayout }) {
      const [query, setQuery] = useState('')
      const layouts = Array.isArray(paper.layouts) ? paper.layouts : []
      const hasLayout = layouts.some((entry) => entry && entry.items && entry.items.length)
      const needle = query.trim().toLowerCase()
      const pages = []
      for (let index = 1; index <= (paper.pageCount || 0); index++) pages.push(index)

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'ph-doc-toolbar' },
          h('button', { className: 'ph-btn', onClick: () => setZoom(Math.max(0.8, +(zoom - 0.2).toFixed(1))) }, '−'),
          h('span', { className: 'ph-sub', style: { minWidth: 52, textAlign: 'center' } }, `${Math.round(zoom * 100)}%`),
          h('button', { className: 'ph-btn', onClick: () => setZoom(Math.min(3.4, +(zoom + 0.2).toFixed(1))) }, '+'),
          h('input', {
            className: 'ph-input',
            style: { maxWidth: 240, height: 28 },
            placeholder: '在页面里查找（高亮）…',
            value: query,
            onChange: (event) => setQuery(event.target.value),
          }),
          needle ? h('span', { className: 'ph-sub' }, sumHits(layouts, needle) + ' 处') : null,
          h('span', { style: { flex: 1 } }),
          h('a', { className: 'ph-btn', href: `${API}/file/${paper.id}`, target: '_blank', rel: 'noreferrer' }, 'PDF'),
        ),
        hasLayout
          ? null
          : h(
              'div',
              { className: 'ph-hint' },
              '这篇还没有可选中文本层，页面照常能看。',
              h('button', { className: 'ph-btn', style: { marginLeft: 10 }, onClick: onNeedLayout }, '重建文本层'),
            ),
        h(
          'div',
          { className: 'ph-doc' },
          pages.map((page) =>
            h(DocPage, {
              key: page,
              paper,
              page,
              layout: layouts[page - 1] || null,
              zoom,
              needle,
              total: paper.pageCount || 0,
            }),
          ),
        ),
      )
    }

    function sumHits(layouts, needle) {
      let total = 0
      for (const layout of layouts) {
        if (!layout || !layout.items) continue
        for (const item of layout.items) if (String(item.s).toLowerCase().includes(needle)) total++
      }
      return total
    }

    function DocPage({ paper, page, layout, zoom, needle, total }) {
      const imgRef = useRef(null)
      const [fontPx, setFontPx] = useState(0)

      useEffect(() => {
        const img = imgRef.current
        if (!img) return
        const measure = () => setFontPx(img.clientHeight || 0)
        measure()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(measure)
        observer.observe(img)
        return () => observer.disconnect()
      }, [layout, zoom])

      const image = h('img', {
        ref: imgRef,
        src: `${API}/page/${paper.id}/${page}?scale=${zoom}`,
        loading: page < 3 ? 'eager' : 'lazy',
        alt: `page ${page}`,
        onLoad: () => setFontPx(imgRef.current?.clientHeight || 0),
      })

      if (!layout || !layout.items || !layout.items.length) {
        return h(
          'div',
          { className: 'ph-doc-page', 'data-page': page },
          h('div', { className: 'ph-doc-canvas' }, image),
          h('div', { className: 'ph-doc-no' }, `${page} / ${total}`),
        )
      }

      return h(
        'div',
        { className: 'ph-doc-page', 'data-page': page },
        h(
          'div',
          { className: 'ph-doc-canvas' },
          image,
          h(
            'div',
            { className: 'ph-textlayer', style: fontPx ? { fontSize: `${fontPx}px` } : null },
            layout.items.map((item, index) =>
              h(
                'span',
                {
                  key: index,
                  className: needle && String(item.s).toLowerCase().includes(needle) ? 'ph-hit' : null,
                  style: {
                    left: `${(item.x / layout.w) * 100}%`,
                    top: `${(item.y / layout.h) * 100}%`,
                    width: `${Math.max(item.w / layout.w, 0.004) * 100}%`,
                    height: `${(item.h / layout.h) * 100}%`,
                    fontSize: `${(item.h / layout.h) * 100}%`,
                  },
                },
                item.s,
              ),
            ),
          ),
        ),
        h('div', { className: 'ph-doc-no' }, `${page} / ${total}`),
      )
    }

    function NotesPanel({ paper, patchPaper, note, saveNote, addTag, tagDraft, setTagDraft, toast, onMoved }) {
      const [title, setTitle] = useState(paper.title || '')
      const [categoryDraft, setCategoryDraft] = useState(paper.category || '')
      const [moving, setMoving] = useState(false)
      useEffect(() => setTitle(paper.title || ''), [paper.id])
      useEffect(() => setCategoryDraft(paper.category || ''), [paper.id])

      const moveTo = async () => {
        const category = categoryDraft.trim()
        if (!category || category === paper.category || moving) return
        setMoving(true)
        try {
          await api('/category', { method: 'POST', body: { id: paper.id, category } })
          await onMoved(paper.id)
        } catch (err) {
          toast(String(err.message || err), true)
        } finally {
          setMoving(false)
        }
      }
      return h(
        'div',
        { className: 'ph-panel' },
        paper.abstract
          ? h(
              'div',
              { className: 'ph-field' },
              h('div', { className: 'ph-label' }, '摘要'),
              h('div', { style: { fontSize: 13, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)' } }, paper.abstract),
            )
          : null,
        h(
          'div',
          { className: 'ph-field' },
          h('div', { className: 'ph-label' }, '标题'),
          h('input', {
            className: 'ph-input',
            value: title,
            onChange: (event) => setTitle(event.target.value),
            onBlur: () => {
              if (title.trim() && title !== paper.title) patchPaper(paper.id, { title: title.trim() })
            },
          }),
        ),
        h(
          'div',
          { className: 'ph-field' },
          h('div', { className: 'ph-label' }, dict.status),
          h(
            'div',
            { className: 'ph-seg' },
            ['unread', 'reading', 'read', 'mastered'].map((status) =>
              h(
                'button',
                {
                  key: status,
                  className: paper.status === status ? 'on' : '',
                  onClick: () => patchPaper(paper.id, { status }),
                },
                dict[status],
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'ph-field' },
          h('div', { className: 'ph-label' }, dict.rating),
          h(Stars, { value: paper.rating || 0, onChange: (rating) => patchPaper(paper.id, { rating }) }),
        ),
        h(
          'div',
          { className: 'ph-field' },
          h('div', { className: 'ph-label' }, dict.tags),
          h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
            (paper.tags || []).map((tag) =>
              h(
                'span',
                { key: tag, className: 'ph-tag' },
                tag,
                h(
                  'button',
                  {
                    onClick: () => patchPaper(paper.id, { tags: (paper.tags || []).filter((t) => t !== tag) }),
                    title: '删除',
                  },
                  '×',
                ),
              ),
            ),
            h('input', {
              className: 'ph-input',
              style: { width: 170, height: 28, flex: 'none' },
              placeholder: dict.addTag,
              value: tagDraft,
              onChange: (event) => setTagDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') addTag()
              },
            }),
          ),
        ),
        h(
          'div',
          { className: 'ph-field' },
          h('div', { className: 'ph-label' }, dict.note),
          h('textarea', {
            className: 'ph-textarea',
            placeholder: dict.notePlaceholder,
            value: note,
            onChange: (event) => saveNote(event.target.value),
          }),
        ),
        h(
          'div',
          { className: 'ph-field' },
          h('div', { className: 'ph-label' }, '归类'),
          h(
            'div',
            { className: 'ph-row' },
            h('input', {
              className: 'ph-input',
              style: { maxWidth: 260 },
              placeholder: '分类文件夹名（填新名字即新建）',
              value: categoryDraft,
              onChange: (event) => setCategoryDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') moveTo()
              },
            }),
            h('button', { className: 'ph-btn', onClick: moveTo, disabled: moving }, moving ? '…' : '移动到该分类'),
          ),
        ),
        h(
          'div',
          { className: 'ph-field' },
          h('div', { className: 'ph-label' }, '文件'),
          h('div', { className: 'ph-sub', style: { wordBreak: 'break-all' } }, paper.relPath),
          h(
            'div',
            { className: 'ph-row', style: { marginTop: 6, gap: 8 } },
            h('button', { className: 'ph-btn', onClick: () => api('/reveal', { method: 'POST', body: { id: paper.id } }).catch(() => {}) }, '⧉ ' + dict.openFolder),
            h(
              'button',
              {
                className: 'ph-btn',
                onClick: async () => {
                  try {
                    toast('正在重新解析…')
                    await api('/paper/' + encodeURIComponent(paper.id) + '/reparse', { method: 'POST', body: {} })
                    toast('已重新解析')
                  } catch (err) {
                    toast(String(err.message || err), true)
                  }
                },
              },
              '↻ ' + dict.reparse,
            ),
          ),
        ),
      )
    }

    // --------------------------------------------------------- online search
    function OnlineSearch({ onClose, onImported, toast, category }) {
      const [query, setQuery] = useState('')
      const [source, setSource] = useState('all')
      const [busy, setBusy] = useState(false)
      const [results, setResults] = useState([])
      const [errors, setErrors] = useState([])
      const [target, setTarget] = useState(category || '')
      const [importingId, setImportingId] = useState('')
      const [done, setDone] = useState({})

      const run = async () => {
        const q = query.trim()
        if (!q || busy) return
        setBusy(true)
        setErrors([])
        try {
          const data = await api('/sources?q=' + encodeURIComponent(q) + '&source=' + source)
          setResults(data.results || [])
          setErrors(data.errors || [])
        } catch (err) {
          toast(String(err.message || err), true)
        } finally {
          setBusy(false)
        }
      }

      const doImport = async (item) => {
        setImportingId(item.id || item.title)
        try {
          const created = await api('/import', { method: 'POST', body: { item, category: target } })
          setDone((map) => ({ ...map, [item.id || item.title]: true }))
          onImported(created)
        } catch (err) {
          toast(String(err.message || err), true)
        } finally {
          setImportingId('')
        }
      }

      return h(
        'div',
        { className: 'ph-overlay', onClick: (event) => event.target === event.currentTarget && onClose() },
        h(
          'div',
          { className: 'ph-modal' },
          h(
            'div',
            { className: 'ph-modal-head' },
            h(
              'div',
              { className: 'ph-row', style: { justifyContent: 'space-between' } },
              h('div', { className: 'ph-title', style: { fontSize: 15 } }, dict.onlineTitle),
              h('button', { className: 'ph-btn ghost', onClick: onClose }, '✕'),
            ),
            h(
              'div',
              { className: 'ph-toolbar' },
              h('input', {
                className: 'ph-input',
                placeholder: dict.onlinePlaceholder,
                value: query,
                autoFocus: true,
                onChange: (event) => setQuery(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') run()
                },
              }),
              h(
                'select',
                {
                  className: 'ph-btn',
                  value: source,
                  onChange: (event) => setSource(event.target.value),
                },
                h('option', { value: 'all' }, '全部来源'),
                h('option', { value: 'arxiv' }, 'arXiv'),
                h('option', { value: 's2' }, 'Semantic Scholar'),
                h('option', { value: 'crossref' }, 'Crossref'),
              ),
              h('button', { className: 'ph-btn primary', onClick: run, disabled: busy }, busy ? '…' : '检索'),
            ),
            h(
              'div',
              { className: 'ph-row' },
              h('span', { className: 'ph-sub' }, '入库到分类：'),
              h('input', {
                className: 'ph-input',
                style: { maxWidth: 220, height: 28 },
                placeholder: '未分类（可留空）',
                value: target,
                onChange: (event) => setTarget(event.target.value),
              }),
            ),
            errors.length
              ? h('div', { className: 'ph-sub', style: { color: 'var(--dsw-alias-state-warn-primary)' } }, errors.map((e) => `${e.source}: ${e.message}`).join(' · '))
              : null,
          ),
          h(
            'div',
            { className: 'ph-modal-body' },
            !results.length
              ? h('div', { className: 'ph-empty' }, dict.onlineEmpty)
              : results.map((item, index) => {
                  const key = item.id || item.title || String(index)
                  return h(
                    'div',
                    { key, className: 'ph-result' },
                    h('div', { className: 'ph-result-title' }, item.title || '（无标题）'),
                    h(
                      'div',
                      { className: 'ph-row', style: { flexWrap: 'wrap', gap: '4px 10px' } },
                      h('span', { className: 'ph-sub' }, (item.authors || []).slice(0, 4).join(', ') || '—'),
                      h('span', { className: 'ph-sub' }, item.year || ''),
                      h('span', { className: 'ph-sub' }, item.venue || ''),
                      h('span', { className: 'ph-badge soft' }, item.source),
                      item.citations != null ? h('span', { className: 'ph-badge soft' }, `${dict.citations} ${item.citations}`) : null,
                      h('span', { className: 'ph-badge soft' }, item.pdfUrl || item.arxivId ? dict.hasPdf : dict.noPdf),
                    ),
                    item.abstract ? h('div', { className: 'ph-result-abs' }, item.abstract) : null,
                    h(
                      'div',
                      { className: 'ph-row', style: { marginTop: 2 } },
                      h(
                        'button',
                        {
                          className: 'ph-btn primary',
                          disabled: importingId === key || done[key] || !(item.pdfUrl || item.arxivId),
                          onClick: () => doImport(item),
                        },
                        done[key] ? dict.imported : importingId === key ? dict.importing : dict.import,
                      ),
                      item.url
                        ? h(
                            'a',
                            { className: 'ph-btn ghost', href: item.url, target: '_blank', rel: 'noreferrer' },
                            dict.source,
                          )
                        : null,
                    ),
                  )
                }),
          ),
        ),
      )
    }

    // ---------------------------------------------------------------- mount
    function Boot(props) {
      return h(App, props)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        try {
          const snapshot = ctx.locale?.getSnapshot?.() || ctx.locale?.getLocale?.()
          const id = String(snapshot?.id || snapshot?.locale || snapshot?.language || 'zh')
          dict = id.toLowerCase().startsWith('en') ? STR.en : STR.zh
        } catch {
          dict = STR.zh
        }

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 12,
              label: () => dict.title,
            },
            (props) => h(Icon, { size: props?.size, active: props?.active }),
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, () => h(Boot, null)),
        )
      },
    }
  },
})
