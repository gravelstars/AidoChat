import { beforeAll, expect, it, vi } from 'vitest'
import { createElement, type MouseEvent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Group, Message } from '../../backend/contract'
const captured = vi.hoisted(() => ({ click: undefined as ((event: MouseEvent) => void) | undefined }))
vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
 const original = await importOriginal<typeof import('react/jsx-dev-runtime')>()
 return { ...original, jsxDEV: (...args: Parameters<typeof original.jsxDEV>) => {
  const props = args[1] as { className?: string; onClick?: (event: MouseEvent) => void }
  if (props?.className?.startsWith('prose selectable')) captured.click = props.onClick
  return original.jsxDEV(...args)
 } }
})
const fake = vi.hoisted(() => ({ subscribe: vi.fn(), bootstrap: vi.fn() }))
vi.mock('../../backend', () => ({ backend: fake, DEFAULT_APPEARANCE: { mode: 'day', paper: 'xuan', nightPaper: 'ye', fontSize: 'm', density: 'comfortable' }, DEFAULT_USER_SEAL: { text: '我', style: 'baiwen' } }))
let MessageItem: typeof import('./MessageItem')['MessageItem']
const group: Group = { id: 'g', title: '群', topic: '', memberIds: [], memberAvatars: {}, defaultMode: 'serial', memoryCursor: 0, createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', archived: false }
const message: Message = { id: 'm', groupId: 'g', seq: 2, authorKind: 'member', authorId: 'a', content: '', mentions: [], mentionAll: false, replyToId: 'u', turnId: 't', provider: 'p', model: 'x', contextSeq: 1, status: 'done', error: '', createdAt: group.createdAt, replyMode: 'serial' }
beforeAll(async () => {
 vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }))
 vi.stubGlobal('document', { documentElement: { dataset: {} } })
 MessageItem = (await import('./MessageItem')).MessageItem
})
function render(content: string) {
 return renderToStaticMarkup(createElement(MessageItem, { message: { ...message, content }, group, members: {}, first: true, last: true, fresh: false }))
}
it.each(['```\nline 1\nline 2\n```', '    line 1\n    line 2'])('无语言代码块保留排版与复制入口：%s', (code) => {
 const html = render(code)
 expect(html).toContain('<pre')
 expect(html).toContain('复制代码')
 expect(html).toContain('line 1\nline 2')
})
it('行内代码保留行内呈现', () => {
 const html = render('正文 `value`')
 expect(html).toContain('<code>value</code>')
 expect(html).not.toContain('复制代码')
})
it('桌面已接管的外部链接不再调用 window.open', () => {
 const open = vi.fn()
 vi.stubGlobal('window', { open })
 render('[链接](https://example.com)')
 expect(captured.click).toBeTypeOf('function')
 const event = { defaultPrevented: true, target: { closest: () => ({ getAttribute: () => 'https://example.com' }) }, preventDefault: vi.fn() } as unknown as MouseEvent
 captured.click!(event)
 expect(open).not.toHaveBeenCalled()
})
it('浏览器预览中的外部链接仍打开新窗口', () => {
 const open = vi.fn()
 vi.stubGlobal('window', { open })
 render('[链接](https://example.com)')
 const event = { defaultPrevented: false, target: { closest: () => ({ getAttribute: () => 'https://example.com' }) }, preventDefault: vi.fn() } as unknown as MouseEvent
 captured.click!(event)
 expect(open).toHaveBeenCalledOnce()
})
