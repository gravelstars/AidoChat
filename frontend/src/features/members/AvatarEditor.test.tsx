import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GroupSummary, Member } from '../../backend/contract'
const state = vi.hoisted(() => ({ update: vi.fn(), save: undefined as (() => void) | undefined, reset: undefined as (() => void) | undefined }))
vi.mock('react', async (importOriginal) => {
 const original = await importOriginal<typeof import('react')>()
 return { ...original, useState: (initial: unknown) => [initial, state.update] }
})
vi.mock('../../components/Dialog', () => ({ Dialog: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => createElement('div', null, children, footer) }))
vi.mock('../../components/Button', () => ({ Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => {
 if (children === '保存') state.save = onClick
 if (children === '恢复默认') state.reset = onClick
 return createElement('button', { onClick }, children)
} }))
const fake = vi.hoisted(() => ({ setGroupAvatar: vi.fn(), setMemberAvatar: vi.fn() }))
vi.mock('../../state/store', () => ({ useChat: (selector: (s: typeof fake) => unknown) => selector(fake) }))
let AvatarEditor: typeof import('./AvatarEditor')['AvatarEditor']
const member: Member = { id: 'a', name: '墨白', avatar: { glyph: '墨', color: 'shiqing' }, brief: '', rolePrompt: '', providerId: 'p', model: 'm', contextTokens: 16000 }
const group: GroupSummary = { id: 'g', title: '群', topic: '', memberIds: ['a'], memberAvatars: { a: member.avatar }, updatedAt: '', archived: false }
beforeAll(async () => { AvatarEditor = (await import('./AvatarEditor')).AvatarEditor })
beforeEach(() => { vi.clearAllMocks() })
it.each(['default', 'group', 'reset'] as const)('头像 %s 保存失败会更新已有错误提示并保持对话框打开', async (scope) => {
 const close = vi.fn()
 fake.setGroupAvatar.mockRejectedValue(new Error('头像保存失败'))
 fake.setMemberAvatar.mockRejectedValue(new Error('头像保存失败'))
 renderToStaticMarkup(createElement(AvatarEditor, { open: true, onClose: close, member, scope: scope === 'default' ? { kind: 'default' } : { kind: 'group', group } }))
 if (scope === 'reset') state.reset!()
 else state.save!()
 await vi.waitFor(() => expect(state.update).toHaveBeenCalledWith('头像保存失败'))
 expect(close).not.toHaveBeenCalled()
})
