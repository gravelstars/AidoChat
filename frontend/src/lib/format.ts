/** 时间与文本的展示工具。 */
import { getLanguage } from '../i18n'

const pad = (n: number) => String(n).padStart(2, '0')
const english = () => getLanguage() === 'en'
const monthDay = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const fullDate = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' })

export function clock(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 群列表用：今天显示时刻，昨天显示"昨天"，更早显示月-日。 */
export function relativeDay(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = (day(now) - day(d)) / 86_400_000
  if (diff === 0) return clock(iso)
  if (diff === 1) return english() ? 'Yesterday' : '昨天'
  if (d.getFullYear() === now.getFullYear()) return english() ? monthDay.format(d) : `${d.getMonth() + 1}月${d.getDate()}日`
  return english() ? fullDate.format(d) : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/** 两条消息之间是否需要插入日期分隔。 */
export function dayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const yesterday = new Date(now.getTime() - 86_400_000)
  if (same(d, now)) return english() ? 'Today' : '今天'
  if (same(d, yesterday)) return english() ? 'Yesterday' : '昨天'
  return english() ? fullDate.format(d) : `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/**
 * 把正文里的 "#12"（消息编号）和 "M3"（记忆编号）转成内部链接，代码块与行内代码不处理。
 * 渲染端把 href="#msg-12" / "#mem-3" 的链接接管为跳转。
 */
export function linkifyRefs(md: string): string {
  return md
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) => {
      if (i % 2 === 1) return part
      return part
        .replace(/(^|[^\w#\]])#(\d{1,6})(?![\w\]])/g, '$1[#$2](#msg-$2)')
        .replace(/(^|[^\w\]])M(\d{1,4})(?![\w\]])/g, '$1[M$2](#mem-$2)')
    })
    .join('')
}
