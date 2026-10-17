import { describe, expect, it } from 'vitest'
import type { Group, Member, Message } from '../../backend'
import { buildShareSnapshot, shareEligible, shareText, type SnapshotSource } from './snapshot'

const group: Group = {
  id: 'g', title: '分享验收', topic: '内部', memberIds: ['a'], memberAvatars: {},
  updatedAt: '2026-10-17T00:00:00Z', archived: false, defaultMode: 'serial', memoryCursor: 0,
  createdAt: '2026-10-17T00:00:00Z',
}
const member: Member = {
  id: 'a', name: '青砚', avatar: { glyph: '青', color: 'shiqing' }, brief: '', rolePrompt: '',
  providerId: 'p', model: 'secret-model', contextTokens: 16000,
}
const source: SnapshotSource = {
  group,
  members: { a: member },
  userDisplayName: '子鹏',
  userSeal: { text: '子鹏之印', style: 'zhuwen' },
  messages: [],
}

function msg(seq: number, authorKind: Message['authorKind'], content: string, extra: Partial<Message> = {}): Message {
  return {
    id: 'm' + seq, groupId: 'g', seq, authorKind, authorId: authorKind === 'user' ? 'user' : 'a',
    content, mentions: [], mentionAll: false, replyToId: '', turnId: 't', provider: 'p',
    model: 'secret-model', contextSeq: 3, status: 'done', error: '', createdAt: '2026-10-17T10:05:00Z',
    replyMode: 'serial', ...extra,
  }
}

describe('分享快照', () => {
  it('只接受完成消息的闭区间，并拒绝逆序/缺失/流式', () => {
    const messages = [msg(1, 'user', '甲'), msg(2, 'member', '乙'), msg(3, 'user', '丙')]
    expect(shareEligible(messages[0])).toBe(true)
    const s = buildShareSnapshot({ ...source, messages }, { startSeq: 2, endSeq: 3, showGroupTitle: true, showTime: true, showSignature: true, paper: 'xuan' }, new Date(2026, 9, 17))
    expect(s.messages.map((m) => m.seq)).toEqual([2, 3])
    expect(() => buildShareSnapshot({ ...source, messages }, { startSeq: 3, endSeq: 2, showGroupTitle: true, showTime: true, showSignature: true, paper: 'xuan' })).toThrow('起点')
    expect(() => buildShareSnapshot({ ...source, messages }, { startSeq: 0, endSeq: 2, showGroupTitle: true, showTime: true, showSignature: true, paper: 'xuan' })).toThrow('不存在')
    const streaming = [msg(1, 'member', '', { status: 'streaming' })]
    expect(() => buildShareSnapshot({ ...source, messages: streaming }, { startSeq: 1, endSeq: 1, showGroupTitle: true, showTime: true, showSignature: true, paper: 'xuan' })).toThrow('生成')
  })

  it('显式白名单字段，不泄露模型、供应商、路径和附件全文', () => {
    const image = { id: 'att1', name: '图.png', mime: 'image/png', size: 10, kind: 'image' as const, url: '/attachments/att1', text: 'SECRET', pageCount: 0, width: 20, height: 10 }
    const doc = { id: 'att2', name: '文.pdf', mime: 'application/pdf', size: 20, kind: 'document' as const, url: '/attachments/att2', text: 'SECRET TEXT', pageCount: 2, width: 0, height: 0 }
    const messages = [msg(1, 'user', '看图', { attachments: [image, doc] })]
    const s = buildShareSnapshot({ ...source, messages }, { startSeq: 1, endSeq: 1, showGroupTitle: true, showTime: true, showSignature: false, paper: 'ye' }, new Date(2026, 9, 17))
    const raw = JSON.stringify(s)
    expect(raw).not.toContain('secret-model')
    expect(raw).not.toContain('SECRET')
    expect(raw).not.toContain('/private/')
    expect(s.messages[0].attachments).toEqual([
      { name: '图.png', kind: 'image', url: '/attachments/att1', pageCount: 0, width: 20, height: 10 },
      { name: '文.pdf', kind: 'document', url: '/attachments/att2', pageCount: 2, width: 0, height: 0 },
    ])
    expect(s.paper).toBe('ye')
    expect(s.showSignature).toBe(false)
    expect(s.date).toBe('2026-10-17')
  })

  it('用户与成员身份冻结为可渲染的印章，已退群成员有回退', () => {
    const messages = [msg(1, 'user', '甲'), msg(2, 'member', '乙'), msg(3, 'member', '丙', { authorId: 'gone' })]
    const s = buildShareSnapshot({ ...source, messages }, { startSeq: 1, endSeq: 3, showGroupTitle: true, showTime: true, showSignature: true, paper: 'xuan' })
    expect(s.messages[0].author).toEqual({ kind: 'user', name: '子鹏', seal: { text: '子鹏之印', style: 'zhuwen' } })
    expect(s.messages[1].author).toMatchObject({ kind: 'member', name: '青砚', avatar: { glyph: '青', color: 'shiqing' } })
    expect(s.messages[2].author).toMatchObject({ kind: 'member', name: '已退群成员', avatar: { color: 'dai' } })
    const text = shareText(s)
    expect(text).toContain('分享验收')
    expect(text).toContain('青砚')
  })
})
