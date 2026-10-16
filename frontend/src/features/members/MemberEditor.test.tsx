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
let MembersView: typeof import('./MembersView')['MembersView']
let CreateGroupDialog: typeof import('../rail/CreateGroupDialog')['CreateGroupDialog']
let useChat: typeof import('../../state/store')['useChat']
beforeAll(async () => {
 vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }))
 useChat = (await import('../../state/store')).useChat
 MemberEditor = (await import('./MemberEditor')).MemberEditor
 MembersView = (await import('./MembersView')).MembersView
 CreateGroupDialog = (await import('../rail/CreateGroupDialog')).CreateGroupDialog
})
it('编辑器使用独立头像编辑保存后的最新头像，过时的 member 参数不覆盖图片和颜料', () => {
 const member: Member = { id: 'a', name: '墨白', avatar: { glyph: '墨', color: 'shiqing', image: '/avatars/old.gif' }, brief: '', rolePrompt: '', providerId: 'p', model: 'm', contextTokens: 16000 }
 useChat.setState({ members: { a: { ...member, avatar: { glyph: '新', color: 'shilv', image: '/avatars/new.gif' } } } })
 const html = renderToStaticMarkup(createElement(MemberEditor, { open: true, onClose: () => {}, member }))
 expect(html).toContain('/avatars/new.gif')
 expect(html).not.toContain('/avatars/old.gif')
 expect(html).toContain('var(--pigment-shilv)')
})

it('没有模型服务时说明先配置服务，并提供可用的新建入口', () => {
 useChat.setState({ providers: [], members: {}, retiredIds: [] })
 const html = renderToStaticMarkup(createElement(MemberEditor, { open: true, onClose: () => {} }))
 expect(html).toContain('还没有模型服务')
 expect(html).toContain('新建模型服务')
})


it('免 Key 的兼容服务在成员名册中不被误报为缺少 Key', () => {
 const member: Member = { id: 'a', name: '本地', avatar: { glyph: '本', color: 'shiqing' }, brief: '', rolePrompt: '', providerId: 'local', model: 'local-model', contextTokens: 16000 }
 useChat.setState({ providers: [{ id: 'local', name: 'Ollama', kind: 'openai', baseUrl: 'http://localhost:11434/v1', hasKey: false }], members: { a: member }, retiredIds: [] })
 const html = renderToStaticMarkup(createElement(MembersView))
 expect(html).not.toContain('缺少 Key')
})

it('空成员群创建表单解释下一步并提供新建成员入口', () => {
 useChat.setState({ members: {}, retiredIds: [] })
 const html = renderToStaticMarkup(createElement(CreateGroupDialog, { open: true, onClose: () => {} }))
 expect(html).toContain('还没有可邀请的成员')
 expect(html).toContain('新建成员')
})

it('已删除成员不会重新出现在邀请列表', () => {
 const member: Member = { id: 'retired', name: '已删除成员', avatar: { glyph: '旧', color: 'shiqing' }, brief: '', rolePrompt: '', providerId: 'local', model: 'model', contextTokens: 16000 }
 useChat.setState({ members: { retired: member }, retiredIds: ['retired'] })
 const html = renderToStaticMarkup(createElement(CreateGroupDialog, { open: true, onClose: () => {} }))
 expect(html).not.toContain('已删除成员')
 expect(html).toContain('还没有可邀请的成员')
})
