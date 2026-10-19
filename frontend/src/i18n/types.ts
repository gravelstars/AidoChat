/** 语言代码。新增语言只需新增 locales/<code>.ts，无需改动类型。 */
export type Language = string

export interface Locale {
  code: Language
  label: string
  /** 中文原文 → 本地化文案。中文本身不需要映射，找不到时直接回退原文。 */
  messages: Record<string, string>
  /** 高频后端错误：按顺序匹配并替换，支持 $1 等捕获组。 */
  errors: [RegExp, string][]
}
