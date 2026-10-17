export const MAX_ATTACHMENTS = 4
export const ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.webp,.txt,.md,.markdown,.pdf'

export function attachmentKind(name: string, mime: string): { kind: 'image' | 'document'; mime: string } {
  const ext = name.toLowerCase().split('.').pop()
  const formats: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', pdf: 'application/pdf',
  }
  const resolved = formats[ext ?? '']
  const markdownText = resolved === 'text/markdown' && ['text/plain', 'text/x-markdown'].includes(mime)
  if (!resolved || (mime && mime !== 'application/octet-stream' && mime !== resolved && !markdownText)) {
    throw new Error('仅支持 PNG、JPEG、WebP、TXT、Markdown 和 PDF')
  }
  return { kind: resolved.startsWith('image/') ? 'image' : 'document', mime: resolved }
}

export function validateAttachment(file: { name: string; size: number; type: string }, count: number) {
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
