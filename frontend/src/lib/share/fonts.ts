const BUNDLED = new Set(['Noto Sans SC Variable', 'Noto Serif SC Variable', 'JetBrains Mono Variable'])
const fileCache = new Map<string, Promise<string>>()
let cssCache: { key: string; css: string } | null = null

interface Face {
  family: string
  style: string
  weight: string
  url: string
  unicodeRange: string
}

function cleanFamily(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '')
}

function ranges(value: string): [number, number][] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const body = part.replace(/^U\+/i, '')
      const [a, b] = body.split('-')
      const start = parseInt(a, 16)
      const end = b ? parseInt(b, 16) : start
      return Number.isFinite(start) && Number.isFinite(end) ? [start, end] as [number, number] : null
    })
    .filter((r): r is [number, number] => !!r)
}

function intersects(face: Face, used: Set<number>): boolean {
  if (!face.unicodeRange) return true
  const spans = ranges(face.unicodeRange)
  if (!spans.length) return true
  for (const cp of used) {
    for (const [start, end] of spans) {
      if (cp >= start && cp <= end) return true
    }
  }
  return false
}

function collectFaces(used: Set<number>): Face[] {
  if (typeof document === 'undefined') return []
  const faces = new Map<string, Face>()
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue
      const family = cleanFamily(rule.style.getPropertyValue('font-family'))
      if (!BUNDLED.has(family)) continue
      const src = rule.style.getPropertyValue('src')
      const match = /url\((['"]?)(.*?)\1\)/.exec(src)
      if (!match) continue
      const base = sheet.href ?? document.baseURI
      let url: string
      try {
        url = new URL(match[2], base).href
      } catch {
        continue
      }
      const face: Face = {
        family,
        style: rule.style.getPropertyValue('font-style') || 'normal',
        weight: rule.style.getPropertyValue('font-weight') || '400',
        url,
        unicodeRange: rule.style.getPropertyValue('unicode-range'),
      }
      if (!intersects(face, used)) continue
      faces.set(`${face.family}|${face.style}|${face.weight}|${face.url}`, face)
    }
  }
  return [...faces.values()]
}

async function fontBase64(url: string): Promise<string> {
  let pending = fileCache.get(url)
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url)
      if (!response.ok) throw new Error('分享图片字体加载失败，请重新打开应用后再试')
      const bytes = new Uint8Array(await response.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
      return btoa(binary)
    })()
    fileCache.set(url, pending)
    pending.catch(() => fileCache.delete(url))
  }
  return pending
}

/**
 * 只嵌入导出页面实际用到的本地 woff2 分片：按 unicode-range 与页面字符集求交集，
 * 再用 data URL 内联，避免 html-to-image 去外网取字体或把整套中文字体塞进 PNG 生成过程。
 */
export async function buildFontCSS(text: string): Promise<string> {
  const used = new Set<number>()
  for (const ch of text) used.add(ch.codePointAt(0) ?? 0)
  const key = [...used].sort((a, b) => a - b).join(',')
  if (cssCache?.key === key) return cssCache.css
  const faces = collectFaces(used)
  if (!faces.length) throw new Error('未找到可嵌入的本地字体，请重新打开应用后再试')
  const rules = await Promise.all(
    faces.map(async (face) => {
      const data = await fontBase64(face.url)
      const range = face.unicodeRange ? `\n  unicode-range: ${face.unicodeRange};` : ''
      return `@font-face {\n  font-family: '${face.family}';\n  font-style: ${face.style};\n  font-weight: ${face.weight};\n  font-display: block;\n  src: url(data:font/woff2;base64,${data}) format('woff2-variations');${range}\n}`
    }),
  )
  const css = rules.join('\n')
  cssCache = { key, css }
  return css
}

export function clearFontCache() {
  cssCache = null
  fileCache.clear()
}
