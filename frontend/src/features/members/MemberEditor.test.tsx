import { beforeAll, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Member } from '../../backend/contract'
// SSR 默认读取 Zustand 的初始快照；表单在这里读取同一真实 store 的当前状态。
vi.mock('../../state/store', async (importOriginal) => {
 const original = await importOriginal<typeof import('../../state/store')>()
 const useChat = Object.assign((selector: (s: ReturnType<typeof original.useChat.getState>) => unknown) => selector(original.useChat.getState()), original.useChat)
 return { ...original, useChat }
})
vi.mock('../../components/Dialog', () => ({ Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null }))
const fake = vi.hoisted(() => ({ subscribe: vi.fn() }))
vi.mock('../../backend', () => ({ backend: fake, DEFAULT_APPEARANCE: { mode: 'day', paper: 'xuan', nightPaper: 'ye', fontSize: 'm', density: 'comfortable' }, DEFAULT_USER_SEAL: { text: '我', style: 'baiwen' } }))
let MemberEditor: typeof import('./MemberEditor')['MemberEditor']
let useChat: typeof import('../../state/store')['useChat']
beforeAll(async () => {
 vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }))
 useChat = (await import('../../state/store')).useChat
 MemberEditor = (await import('./MemberEditor')).MemberEditor
})
it('编辑器使用独立头像编辑保存后的最新头像，过时的 member 参数不覆盖图片和颜料', () => {
 const member: Member = { id: 'a', name: '墨白', avatar: { glyph: '墨', color: 'shiqing', image: '/avatars/old.gif' }, brief: '', rolePrompt: '', providerId: 'p', model: 'm', contextTokens: 16000 }
 useChat.setState({ members: { a: { ...member, avatar: { glyph: '新', color: 'shilv', image: '/avatars/new.gif' } } } })
 const html = renderToStaticMarkup(createElement(MemberEditor, { open: true, onClose: () => {}, member }))
 expect(html).toContain('/avatars/new.gif')
 expect(html).not.toContain('/avatars/old.gif')
 expect(html).toContain('var(--pigment-shilv)')
})
