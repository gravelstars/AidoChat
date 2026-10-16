import type { Member } from '../backend/contract'

/**
 * @ 解析，与 Go 的 domain.ParseMentions 同一套规则。
 * 共享用例：testdata/mentions.json（mention.test.ts 会读取它）。
 */
export const MENTION_ALL_NAMES = ['所有人', 'all', 'All', 'ALL']

const boundaryRe = /[\s\p{P}\p{S}]/u
const cjkRe = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const latinWordRe = /[A-Za-z0-9_]/

const isBoundary = (ch: string) => boundaryRe.test(ch)

function endsAtBoundary(rest: string, name: string): boolean {
  if (rest.length === name.length) return true
  const next = String.fromCodePoint(rest.codePointAt(name.length)!)
  if (isBoundary(next)) return true
  const chars = Array.from(name)
  return cjkRe.test(chars[chars.length - 1]) && !latinWordRe.test(next)
}

export interface MentionSpan {
  start: number
  end: number
  memberId: string | null // null 表示 @所有人
}

export interface ParsedMentions {
  ids: string[]
  all: boolean
  spans: MentionSpan[]
}

export function parseMentions(text: string, candidates: Pick<Member, 'id' | 'name'>[]): ParsedMentions {
  const ids: string[] = []
  const spans: MentionSpan[] = []
  let all = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch !== '@' && ch !== '＠') {
      i++
      continue
    }
    if (i > 0) {
      const prev = String.fromCodePoint(text.codePointAt(i - 1)!)
      // 处理代理对：前一个字符可能是低位代理
      const prevChar = /[\uDC00-\uDFFF]/.test(prev) ? text.slice(i - 2, i) : prev
      if (!isBoundary(prevChar)) {
        i++
        continue
      }
    }
    const rest = text.slice(i + 1)
    let best = { len: 0, id: null as string | null, all: false }
    for (const n of MENTION_ALL_NAMES) {
      if (n.length > best.len && rest.startsWith(n) && endsAtBoundary(rest, n)) best = { len: n.length, id: null, all: true }
    }
    for (const m of candidates) {
      if (m.name && m.name.length > best.len && rest.startsWith(m.name) && endsAtBoundary(rest, m.name)) {
        best = { len: m.name.length, id: m.id, all: false }
      }
    }
    if (best.len > 0) {
      spans.push({ start: i, end: i + 1 + best.len, memberId: best.id })
      if (best.all) all = true
      else if (best.id && !ids.includes(best.id)) ids.push(best.id)
    }
    i += 1 + best.len
  }
  return { ids, all, spans }
}

/** 与 Go 的 domain.PlanTargets 一致：@所有人 → 群成员顺序；否则 → @ 出现顺序。 */
export function planTargets(memberIds: string[], parsed: Pick<ParsedMentions, 'ids' | 'all'>): string[] {
  if (parsed.all) return [...memberIds]
  return parsed.ids.filter((id) => memberIds.includes(id))
}

/** 输入框里光标前正在输入的 @ 片段，用于弹出候选。返回 null 表示不在 @ 状态。 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = Math.max(before.lastIndexOf('@'), before.lastIndexOf('＠'))
  if (at < 0) return null
  if (at > 0 && !isBoundary(before[at - 1])) return null
  const query = before.slice(at + 1)
  if (/\s/.test(query) || query.length > 12) return null
  return { start: at, query }
}
