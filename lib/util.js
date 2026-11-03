import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export function nowIso() {
  return new Date().toISOString()
}

export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

export async function readJson(file, fallback) {
  try {
    const text = await fsp.readFile(file, 'utf8')
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

export function readJsonSync(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

let writeChain = new Map()

/** Serialise writes per file so concurrent updates cannot interleave. */
export async function writeJson(file, value) {
  const prev = writeChain.get(file) || Promise.resolve()
  const next = prev
    .catch(() => {})
    .then(async () => {
      await ensureDir(path.dirname(file))
      const tmp = file + '.tmp'
      await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
      await fsp.rename(tmp, file)
    })
  writeChain.set(file, next)
  try {
    await next
  } finally {
    if (writeChain.get(file) === next) writeChain.delete(file)
  }
}

export async function sha1File(file) {
  const hash = crypto.createHash('sha1')
  const stream = fs.createReadStream(file)
  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

export function shortHash(input, len = 12) {
  return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, len)
}

export function safeName(input, fallback = 'untitled') {
  const cleaned = String(input || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const trimmed = cleaned.slice(0, 80).replace(/[. ]+$/, '')
  return trimmed || fallback
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

export function humanSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

/** True when the file starts with the %PDF magic (extension-less PDFs included). */
export async function looksLikePdf(file) {
  try {
    const fh = await fsp.open(file, 'r')
    try {
      const buf = Buffer.alloc(5)
      const { bytesRead } = await fh.read(buf, 0, 5, 0)
      if (bytesRead < 5) return false
      return buf.toString('latin1') === '%PDF-'
    } finally {
      await fh.close()
    }
  } catch {
    return false
  }
}

export function isPdfName(name) {
  return /\.pdf$/i.test(name)
}

/** Recursively collect candidate PDF files under root. */
export async function walkPdfs(root, limit = 4000) {
  const out = []
  async function walk(dir, depth) {
    if (out.length >= limit || depth > 6) return
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
      } else if (entry.isFile()) {
        if (isPdfName(entry.name)) {
          out.push(full)
        } else if (await looksLikePdf(full)) {
          out.push(full)
        }
      }
      if (out.length >= limit) return
    }
  }
  await walk(root, 0)
  return out
}

export function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?。！？])\s+/)
    .filter((s) => s.trim().length > 0)
}

export function truncate(text, max) {
  const s = String(text || '')
  return s.length <= max ? s : s.slice(0, max).trimEnd() + '…'
}
