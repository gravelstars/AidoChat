export const MAX_ATTACHMENTS = 4

const CODE_EXTENSIONS = [
  'go', 'py', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'java', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh',
  'cs', 'rs', 'rb', 'php', 'swift', 'kt', 'kts', 'scala', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'sql', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  'vue', 'svelte', 'dart', 'lua', 'r', 'pl', 'pm', 'ex', 'exs', 'erl', 'hrl', 'clj', 'cljs', 'fs', 'fsx',
  'vb', 'asm', 's', 'gradle', 'properties', 'log', 'out', 'err', 'tex',
]

const CODE_NAMES = new Set(['dockerfile', 'makefile', 'cmakelists.txt', 'procfile', 'jenkinsfile'])

export const ATTACHMENT_ACCEPT = [
  '.png', '.jpg', '.jpeg', '.webp', '.txt', '.md', '.markdown', '.pdf',
  '.docx', '.pptx', '.xlsx', '.csv', '.json',
  ...CODE_EXTENSIONS.map((ext) => `.${ext}`),
  'text/plain',
].join(',')

export interface AttachmentFormat {
  kind: 'image' | 'document'
  mime: string
  /** 图片走本地预览；PDF/文本在浏览器提取；Office 文件交给 Go 后端提取。 */
  extract: 'image' | 'pdf' | 'text' | 'server'
}

const OFFICE: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export function serverExtracted(name: string): boolean {
  return /\.(docx|pptx|xlsx)$/i.test(name)
}

function expectedMime(ext: string, base: string): string {
  if (OFFICE[ext]) return OFFICE[ext]
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'md' || ext === 'markdown') return 'text/markdown'
  if (ext === 'csv') return 'text/csv'
  if (ext === 'json') return 'application/json'
  if (['txt', 'log', 'out', 'err'].includes(ext) || CODE_EXTENSIONS.includes(ext) || CODE_NAMES.has(base)) return 'text/plain'
  return ''
}

function compatible(ext: string, base: string, mime: string): string | null {
  const expected = expectedMime(ext, base)
  if (!expected) return null
  const lower = (mime || '').toLowerCase()
  if (!lower) return expected
  const aliases = new Set([expected, 'application/octet-stream'])
  if (OFFICE[ext]) aliases.add('application/zip')
  if (ext === 'csv') { aliases.add('application/vnd.ms-excel'); aliases.add('text/plain') }
  if (ext === 'json') { aliases.add('text/json'); aliases.add('text/plain') }
  if (expected === 'text/markdown') { aliases.add('text/plain'); aliases.add('text/x-markdown') }
  if (expected === 'text/plain') {
    for (const alias of ['text/plain', 'application/javascript', 'application/json', 'application/xml', 'text/html', 'text/css']) aliases.add(alias)
    if (lower.startsWith('text/')) return expected
  }
  if (expected === 'image/jpeg') aliases.add('image/jpg')
  return aliases.has(lower) ? expected : null
}

export function attachmentKind(name: string, mime: string): AttachmentFormat {
  const base = name.toLowerCase()
  const ext = base.includes('.') ? base.split('.').pop() ?? '' : ''
  const expected = expectedMime(ext, base)
  if (!expected) throw new Error('附件格式不支持；可添加图片、PDF、Word、PowerPoint、Excel、CSV、JSON、代码或日志文件')
  if (!compatible(ext, base, mime)) throw new Error('文件类型与扩展名不匹配，请选择有效的文件')
  if (OFFICE[ext]) return { kind: 'document', mime: expected, extract: 'server' }
  if (ext === 'pdf') return { kind: 'document', mime: expected, extract: 'pdf' }
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return { kind: 'image', mime: expected, extract: 'image' }
  return { kind: 'document', mime: expected, extract: 'text' }
}

export function validateAttachment(file: { name: string; size: number; type: string }, count: number): AttachmentFormat {
  if (count >= MAX_ATTACHMENTS) throw new Error('每条消息最多添加 4 份附件')
  const format = attachmentKind(file.name, file.type)
  const max = (format.kind === 'image' ? 10 : 20) * 1024 * 1024
  if (file.size > max) throw new Error(format.kind === 'image' ? '图片不能超过 10 MiB' : '文档不能超过 20 MiB')
  if (file.size === 0) throw new Error('文件为空，请选择有内容的文件')
  return format
}

export function validateImage(width: number, height: number) {
  if (width <= 0 || height <= 0 || width * height > 40000000) {
    throw new Error('图片不能超过 4000 万像素，请缩小后添加')
  }
}

export function validateDocument(text: string, pageCount = 0) {
  if (pageCount > 100) throw new Error('PDF 不能超过 100 页')
  if (!text.trim()) throw new Error('文档没有可提取的文本；扫描版 PDF 暂不支持 OCR')
  if (Array.from(text).length > 100000) throw new Error('文档文本不能超过 10 万字符，请拆分后添加')
  if (/\p{Cc}/u.test(text.replace(/[\t\n\r]/g, ''))) {
    throw new Error('文档包含无效控制字符，请转为 UTF-8 文本后添加')
  }
}

export function remainingDraft<T extends { id: string }>(draft: T[], sent: string[]): T[] {
  return draft.filter((a) => !sent.includes(a.id))
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return btoa(binary)
}

export function attachmentSize(size: number): string {
  return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KiB` : `${(size / 1024 / 1024).toFixed(1)} MiB`
}
