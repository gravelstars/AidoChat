import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { BackendEvent, Group, Message } from '../backend/contract'
const fake = vi.hoisted(() => ({ subscribe: vi.fn(), bootstrap: vi.fn(), openGroup: vi.fn(), setMemoryConfig: vi.fn(), archiveGroup: vi.fn(), deleteGroup: vi.fn() }))
vi.mock('../backend', () => ({ backend: fake, DEFAULT_APPEARANCE: { mode: 'day', paper: 'xuan', nightPaper: 'ye', fontSize: 'm', density: 'comfortable' }, DEFAULT_USER_SEAL: { text: '我', style: 'baiwen' } }))
let useChat: typeof import('./store')['useChat']
let event: (e: BackendEvent) => void
const group: Group = { id: 'g', title: '群', topic: '', memberIds: ['a'], memberAvatars: {}, defaultMode: 'serial', memoryCursor: 0, createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', archived: false }
const message: Message = { id: 'm', groupId: 'g', seq: 2, authorKind: 'member', authorId: 'a', content: '', mentions: [], mentionAll: false, replyToId: 'u', turnId: 't', provider: 'p', model: 'x', contextSeq: 1, status: 'streaming', error: '', createdAt: group.createdAt, replyMode: 'serial' }
beforeAll(async () => {
 vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }))
 vi.stubGlobal('document', { documentElement: { dataset: {} } })
 vi.stubGlobal('requestAnimationFrame', () => 1)
 useChat = (await import('./store')).useChat
})
beforeEach(async () => {
 vi.clearAllMocks()
 useChat.setState({ detail: {}, error: null })
 fake.bootstrap.mockResolvedValue({ platform: 'mac', appearance: useChat.getState().appearance, members: [], providers: [], groups: [], userSeal: { text: '我', style: 'baiwen' } })
 await useChat.getState().init()
 event = fake.subscribe.mock.calls[0][0]
 useChat.setState({ detail: { g: { group, messages: [{ ...message, content: '墨白：正文' }], memory: [], busy: true, summarizing: false } } })
})
it.each(['done', 'stopped', 'error'] as const)('以 %s 权威终态替换原始增量及尚未提交的增量', (status) => {
 event({ kind: 'delta', groupId: 'g', messageId: 'm', delta: '尚未绘制' })
 event({ kind: 'message', groupId: 'g', message: { ...message, status, content: '正文' } })
 event({ kind: 'turn.end', groupId: 'g', turnId: 't' })
 expect(useChat.getState().detail.g.messages[0].content).toBe('正文')
})
it('旧轮的结束事件不会取消新轮的忙碌状态', () => {
 event({ kind: 'turn.start', groupId: 'g', turnId: 'old', order: ['a'] })
 event({ kind: 'turn.start', groupId: 'g', turnId: 'new', order: ['a'] })
 event({ kind: 'turn.end', groupId: 'g', turnId: 'old' })
 expect(useChat.getState().detail.g.busy).toBe(true)
 event({ kind: 'turn.end', groupId: 'g', turnId: 'new' })
 expect(useChat.getState().detail.g.busy).toBe(false)
})
it('纪要配置保存失败进入全局可展示错误状态', async () => {
 fake.setMemoryConfig.mockRejectedValueOnce(new Error('保存纪要配置失败'))
 await useChat.getState().setMemoryConfig({ providerId: 'p', model: 'x' }).catch(() => {})
 expect(useChat.getState().error).toContain('保存纪要配置失败')
})
it.each(['archiveGroup', 'deleteGroup'] as const)('侧栏 %s 失败有错误反馈', async (method) => {
 fake[method].mockRejectedValueOnce(new Error('操作失败'))
 if (method === 'archiveGroup') await useChat.getState().archiveGroup('g', true).catch(() => {})
 else await useChat.getState().deleteGroup('g').catch(() => {})
 expect(useChat.getState().error).toContain('操作失败')
})
