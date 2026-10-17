import type { Avatar, Group, Member, Message, UserSeal } from '../../backend'
import { avatarOf } from '../avatar'
import { clock } from '../format'

export interface ShareAttachment {
  name: string
  kind: 'image' | 'document'
  url: string
  pageCount: number
  width: number
  height: number
}

export type ShareAuthor =
  | { kind: 'user'; name: string; seal: UserSeal }
  | { kind: 'member'; name: string; avatar: Avatar }
  | { kind: 'system' }

export interface ShareMessage {
  seq: number
  author: ShareAuthor
  time: string
  content: string
  attachments: ShareAttachment[]
}

export interface ShareOptions {
  startSeq: number
  endSeq: number
  showGroupTitle: boolean
  showTime: boolean
  showSignature: boolean
  /** 实际使用的纸面 id：当前纸或强制宣纸 */
  paper: string
}

export interface ShareSnapshot {
  groupTitle: string
  date: string
  paper: string
  showGroupTitle: boolean
  showTime: boolean
  showSignature: boolean
  messages: ShareMessage[]
}

export interface SnapshotSource {
  group: Group
  messages: Message[]
  members: Record<string, Member>
  userDisplayName: string
  userSeal: UserSeal
}

/** 只有完成且可展示的消息可以进入分享；pending/streaming 会误导读者。 */
export function shareEligible(m: Message): boolean {
  return m.status !== 'pending' && m.status !== 'streaming'
}

export function shareDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * 生成冻结快照：显式挑出可公开字段，绝不 spread Message/Member，
 * 避免把 provider、model、turn、context、附件提取全文或本机路径带进导出。
 */
export function buildShareSnapshot(source: SnapshotSource, options: ShareOptions, now = new Date()): ShareSnapshot {
  const { startSeq, endSeq } = options
  if (!Number.isInteger(startSeq) || !Number.isInteger(endSeq)) {
    throw new Error('请选择分享的起止消息')
  }
  if (startSeq > endSeq) {
    throw new Error('分享起点不能晚于终点')
  }
  const bySeq = new Map(source.messages.map((m) => [m.seq, m]))
  if (!bySeq.has(startSeq) || !bySeq.has(endSeq)) {
    throw new Error('选中的消息已不存在，请重新选择范围')
  }
  const selected = source.messages
    .filter((m) => m.seq >= startSeq && m.seq <= endSeq)
    .sort((a, b) => a.seq - b.seq)
  if (!selected.length) {
    throw new Error('所选范围没有可分享的消息')
  }
  if (selected.some((m) => !shareEligible(m))) {
    throw new Error('正在生成的消息不能分享，请等本轮结束后再试')
  }

  return {
    groupTitle: source.group.title,
    date: shareDate(now),
    paper: options.paper,
    showGroupTitle: options.showGroupTitle,
    showTime: options.showTime,
    showSignature: options.showSignature,
    messages: selected.map((m) => shareMessage(m, source)),
  }
}

function shareMessage(m: Message, source: SnapshotSource): ShareMessage {
  return {
    seq: m.seq,
    author: shareAuthor(m, source),
    time: clock(m.createdAt),
    content: m.content,
    attachments: (m.attachments ?? []).map((a) => ({
      name: a.name,
      kind: a.kind,
      url: a.url,
      pageCount: a.pageCount,
      width: a.width,
      height: a.height,
    })),
  }
}

function shareAuthor(m: Message, source: SnapshotSource): ShareAuthor {
  if (m.authorKind === 'system') return { kind: 'system' }
  if (m.authorKind === 'user') {
    return { kind: 'user', name: source.userDisplayName, seal: source.userSeal }
  }
  const member = source.members[m.authorId]
  return {
    kind: 'member',
    name: member?.name ?? '已退群成员',
    avatar: avatarOf(member, source.group) ?? { glyph: '去', color: 'dai' },
  }
}

/** 供字体筛选使用：页面上会出现的所有文字。 */
export function shareText(snapshot: ShareSnapshot): string {
  const parts = [snapshot.date, 'AidoChat', '第 页 共 续附件图片文档']
  if (snapshot.showGroupTitle) parts.push(snapshot.groupTitle)
  for (const m of snapshot.messages) {
    parts.push(m.time, m.content)
    if (m.author.kind === 'user') parts.push(m.author.name, m.author.seal.text)
    if (m.author.kind === 'member') parts.push(m.author.name, m.author.avatar.glyph)
    for (const a of m.attachments) parts.push(a.name, a.pageCount ? `${a.pageCount} 页` : '')
  }
  return parts.join('')
}
