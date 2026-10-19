import type { Language, Locale } from './types'

/**
 * 文案以中文原文为 key。新增语言只需在 locales/ 下放一个文件：
 * code、label、messages、errors 齐全即可，无需改动这里的代码。
 */
const discovered = import.meta.glob<Locale>('./locales/*.ts', { eager: true, import: 'default' })

export const locales: Record<string, Locale> = Object.fromEntries(
  Object.values(discovered).map((locale) => [locale.code, locale]),
)

const PREFERRED = ['zh', 'en']

/** 语言列表：中文、英文优先，其他语言按 code 排序。 */
export const languages = Object.values(locales).sort((a, b) => {
  const ai = PREFERRED.indexOf(a.code)
  const bi = PREFERRED.indexOf(b.code)
  if (ai >= 0 || bi >= 0) return (ai < 0 ? PREFERRED.length : ai) - (bi < 0 ? PREFERRED.length : bi)
  return a.code.localeCompare(b.code)
})

export const DEFAULT_LANGUAGE: Language = 'zh'

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && value in locales
}

let active: Language = DEFAULT_LANGUAGE
const listeners = new Set<() => void>()

export function getLanguage(): Language {
  return active
}

export function setLanguage(language: Language): void {
  if (language === active) return
  active = isLanguage(language) ? language : DEFAULT_LANGUAGE
  if (typeof document !== 'undefined') document.documentElement.lang = active
  listeners.forEach((listener) => listener())
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 翻译界面文案；{name} 形式的占位符用 vars 替换。中文本身不需要映射。 */
export function translate(text: string, vars?: Record<string, string | number>): string {
  const template = locales[active]?.messages[text] ?? text
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match))
}

/** 翻译后端返回的高频错误；未命中的保持原文。 */
export function translateError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  for (const [pattern, replacement] of locales[active]?.errors ?? []) {
    if (pattern.test(text)) {
      return text.replace(pattern, (...args: unknown[]) =>
        replacement.replace(/\$(\d)/g, (_, index: string) => String(args[Number(index)] ?? '')),
      )
    }
  }
  return text
}

/** 初始化界面语言（来自 Bootstrap）。 */
export function initLanguage(language: unknown): Language {
  const next = isLanguage(language) ? language : DEFAULT_LANGUAGE
  active = next
  if (typeof document !== 'undefined') document.documentElement.lang = next
  return next
}
