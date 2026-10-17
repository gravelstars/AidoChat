import type { Appearance, Backend, BackendEvent, Bootstrap, GroupDetail, Message } from './contract'

interface ShellRuntime {
  Flags: { GetFlag(name: string): unknown }
  Window: {
    Minimise(): Promise<void>
    ToggleMaximise(): Promise<void>
    Close(): Promise<void>
    SetBackgroundColour?(r: number, g: number, b: number, a: number): Promise<void>
  }
  Browser?: { OpenURL(url: string): Promise<void> }
  Call: { ByName(name: string, ...args: unknown[]): Promise<unknown> }
  Events: { On(name: string, handler: (event: { data: BackendEvent }) => void): () => void }
}

type NativeHost = Window & {
  _wails?: { flags?: Record<string, unknown> }
  chrome?: { webview?: { postMessage?: unknown } }
  webkit?: { messageHandlers?: { external?: { postMessage?: unknown } } }
}

export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false
  const host = window as NativeHost
  return !!(host._wails || host.chrome?.webview?.postMessage || host.webkit?.messageHandlers?.external?.postMessage)
}

let runtime: Promise<ShellRuntime> | undefined
async function loadRuntime(): Promise<ShellRuntime> {
  if (!runtime) {
    // 使用与 Go 完全同版本的内置运行时，浏览器预览不会请求这个地址。
    const attempt = (async () => {
      const url = '/wails/runtime.js'
      const api = await import(/* @vite-ignore */ url) as ShellRuntime
      if (!(window as NativeHost)._wails?.flags?.['app.platform']) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { cleanup(); reject(new Error('桌面运行时未就绪，请重启应用')) }, 10000)
          const ready = () => { cleanup(); resolve() }
          const cleanup = () => { clearTimeout(timer); window.removeEventListener('wails:runtime-config-ready', ready) }
          window.addEventListener('wails:runtime-config-ready', ready)
          if ((window as NativeHost)._wails?.flags?.['app.platform']) ready()
        })
      }
      return api
    })()
    runtime = attempt
    // 失败不缓存：运行时瞬时未就绪不应让整个会话此后永久不可用。
    attempt.catch(() => { if (runtime === attempt) runtime = undefined })
  }
  return runtime
}

export function externalURL(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin)
    if (url.origin === origin) return null
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null
  } catch { return null }
}

let linksInstalled = false
function installLinks(api: ShellRuntime) {
  if (linksInstalled || !api.Browser) return
  linksInstalled = true
  const open = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return
    const anchor = event.target.closest('a[href]')
    if (!anchor) return
    const href = externalURL(anchor.getAttribute('href') ?? '', window.location.origin)
    if (!href) return
    event.preventDefault()
    void api.Browser!.OpenURL(href).catch(console.error)
  }
  document.addEventListener('click', open, true)
  document.addEventListener('auxclick', (event) => { if (event.button === 1) open(event) }, true)
}

/** 桌面只调用真实 Go 服务；mock 的选择留在 index.ts。 */
export function createWailsBackend(load: () => Promise<ShellRuntime> = loadRuntime): Backend {
  const handlers = new Set<(e: BackendEvent) => void>()
  let detach: (() => void) | undefined
  let connecting: Promise<void> | undefined
  let appearance: Appearance | undefined
  let observing = false
  // detach 存在即已连接；connecting 只用于合并并发连接，成功或失败都会清空，
  // 因此一次瞬时失败后下次调用会重试，而不是永久复用被拒的连接。
  const connect = () => {
    if (detach) return Promise.resolve()
    connecting ??= load().then((api) => {
      if (handlers.size && !detach) detach = api.Events.On('backend:event', (e) => {
        for (const handler of handlers) handler(e.data)
      })
    }).finally(() => { connecting = undefined })
    return connecting
  }
  const subscribe = (handler: (e: BackendEvent) => void) => {
    handlers.add(handler)
    void connect().catch(console.error)
    return () => {
      handlers.delete(handler)
      if (!handlers.size) { detach?.(); detach = undefined; connecting = undefined }
    }
  }
  const call = async <T>(method: string, ...args: unknown[]): Promise<T> => {
    // store 会先 subscribe 再 bootstrap；任何写操作开始前监听都必须已建立。
    // 用 connect() 而非直接 await connecting：一次瞬时失败后这里能重建监听。
    if (handlers.size) await connect()
    const api = await load()
    return await api.Call.ByName(`ai-group-chat/app.Service.${method}`, ...args) as T
  }
  const cache = (a: Appearance) => {
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem('agc.appearance', JSON.stringify(a)) } catch { /* 数据库仍是持久化的依据。 */ }
    }
  }
  const syncPaper = async (api: ShellRuntime, a: Appearance) => {
    const dark = a.mode === 'night' || (a.mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    await api.Call.ByName('ai-group-chat/desktop.Shell.SetPaper', dark ? a.nightPaper : a.paper)
  }
  const invoke = (action: (api: ShellRuntime) => Promise<unknown>) => { void load().then(action).catch(console.error) }
  return {
    async bootstrap() {
      const initial = await call<Bootstrap>('Bootstrap')
      const api = await load()
      if (typeof document !== 'undefined') installLinks(api)
      appearance = initial.appearance
      cache(appearance)
      await syncPaper(api, appearance)
      if (!observing && typeof window !== 'undefined') {
        observing = true
        matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
          if (appearance?.mode === 'system') invoke((runtime) => syncPaper(runtime, appearance!))
        })
      }
      return initial
    },
    async openGroup(id) {
      const duringOpen: BackendEvent[] = []
      const off = subscribe((e) => { if ('groupId' in e && e.groupId === id) duringOpen.push(e) })
      try { return mergeOpenEvents(await call<GroupDetail>('OpenGroup', id), duringOpen) }
      finally { off() }
    },
    createGroup: (input) => call('CreateGroup', input),
    updateGroup: (input) => call('UpdateGroup', input),
    archiveGroup: (id, archived) => call('ArchiveGroup', id, archived),
    deleteGroup: (id) => call('DeleteGroup', id),
    importAttachment: (input) => call('ImportAttachment', input),
    readAttachment: (id) => call('ReadAttachment', id),
    removeDraftAttachment: (id) => call('RemoveDraftAttachment', id),
    send: (id, content, mode, ids) => ids?.length ? call('SendWithAttachments', id, content, mode ?? null, ids) : call('Send', id, content, mode ?? null),
    stop: (id) => call('Stop', id),
    retry: (id) => call('Retry', id),
    memory: {
      confirm: (id) => call('ConfirmMemory', id),
      reject: (id) => call('RejectMemory', id),
      reopen: (id) => call('ReopenMemory', id),
      edit: (id, content) => call('EditMemory', id, content),
      complete: (id) => call('CompleteMemory', id),
      uncomplete: (id) => call('UncompleteMemory', id),
      summarize: (id) => call('Summarize', id),
    },
    async setAppearance(a) {
      await call('SetAppearance', a)
      appearance = a
      cache(a)
      await syncPaper(await load(), a)
    },
    setUserProfile: (profile) => call('SetUserProfile', profile),
    setUserSeal: (seal) => call('SetUserSeal', seal),
    async uploadAvatar(file) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return call('UploadAvatar', file.name, file.type, btoa(binary))
    },
    setGroupAvatar: (groupId, memberId, avatar) => call('SetGroupAvatar', groupId, memberId, avatar),
    setMemberAvatar: (memberId, avatar) => call('SetMemberAvatar', memberId, avatar),
    saveMember: (input) => call('SaveMember', input),
    deleteMember: (memberId) => call('DeleteMember', memberId),
    saveProvider: (input) => call('SaveProvider', input),
    deleteProvider: (providerId) => call('DeleteProvider', providerId),
    testProvider: (input) => call('TestProvider', input),
    setMemoryConfig: (config) => call('SetMemoryConfig', config),
    dataDir: () => call('DataDir'),
    openDataDir: () => call('OpenDataDir'),
    window: {
      minimise: () => invoke((api) => api.Window.Minimise()),
      toggleMaximise: () => invoke((api) => api.Window.ToggleMaximise()),
      close: () => invoke((api) => api.Window.Close()),
    },
    subscribe,
  }
}

// 首次打开群时 store 尚无 detail。合并请求期间的事件，避免快照返回前的终态被丢掉。
function mergeOpenEvents(detail: GroupDetail, events: BackendEvent[]): GroupDetail {
  const messages = new Map(detail.messages.map((m) => [m.id, m]))
  const terminal = (m: Message) => !['pending', 'streaming'].includes(m.status)
  for (const e of events) {
    if (e.kind === 'message') {
      const current = messages.get(e.message.id)
      // 数据库可能已读到 done，但缓冲中仍含较早的 streaming 通知。
      if (!current || !terminal(current) || terminal(e.message)) messages.set(e.message.id, e.message)
    } else if (e.kind === 'delta') {
      const current = messages.get(e.messageId)
      if (current && !terminal(current)) messages.set(current.id, { ...current, content: current.content + e.delta })
    } else if (e.kind === 'turn.end') detail.busy = false
    else if (e.kind === 'turn.start' && [...messages.values()].some((m) => m.turnId === e.turnId && !terminal(m))) detail.busy = true
    else if (e.kind === 'memory') {
      const items = new Map(detail.memory.map((m) => [m.id, m]))
      for (const item of e.items) {
        const current = items.get(item.id)
        if (!current || Date.parse(current.updatedAt) <= Date.parse(item.updatedAt)) items.set(item.id, item)
      }
      detail.memory = [...items.values()].sort((a, b) => a.ref - b.ref)
      detail.group.memoryCursor = Math.max(detail.group.memoryCursor, e.cursor)
    }
  }
  detail.messages = [...messages.values()].sort((a, b) => a.seq - b.seq)
  return detail
}
