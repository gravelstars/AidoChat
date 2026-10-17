import { create } from 'zustand'
import { backend } from '../backend'
import { DEFAULT_APPEARANCE, DEFAULT_USER_SEAL } from '../backend'
import type {
  Appearance,
  Avatar,
  BackendEvent,
  CreateGroupInput,
  Group,
  GroupSummary,
  MemoryConfig,
  MemoryItem,
  Member,
  Message,
  Platform,
  ProviderConfig,
  ReplyMode,
  SaveMemberInput,
  SaveProviderInput,
  UpdateGroupInput,
  UserSeal,
  UserProfile,
} from '../backend'

export type View = 'chat' | 'members' | 'settings'

export interface GroupState {
  group: Group
  messages: Message[]
  memory: MemoryItem[]
  busy: boolean
  summarizing: boolean
}

interface Jump {
  seq: number
  nonce: number
}

interface ChatStore {
  ready: boolean
  error: string | null
  platform: Platform
  appearance: Appearance
  /** 实际生效的是不是夜间纸（mode=system 时取决于系统） */
  night: boolean
  profileSaving: boolean
  userDisplayName: string
  userSeal: UserSeal
  view: View
  members: Record<string, Member>
  /** 已软删除、只用于渲染历史的成员 ID；不出现在名册与邀请列表 */
  retiredIds: string[]
  providers: ProviderConfig[]
  /** 纪要整理使用的服务与模型（TASK-008） */
  memory: MemoryConfig
  version: string
  groups: GroupSummary[]
  activeId: string | null
  detail: Record<string, GroupState>
  memoryOpen: boolean
  /** 纪要面板悬停某个来源时，聊天区对应消息高亮 */
  hoverSeq: number | null
  /** 跳转到某条消息（滚动 + 荧光笔闪烁） */
  jump: Jump | null
  /** 刚被确认的条目 ID，用于播放盖章动画（只播一次） */
  justStamped: string | null

  init(): Promise<void>
  open(groupId: string): Promise<void>
  setView(v: View): void
  send(content: string, mode?: ReplyMode, attachmentIds?: string[]): Promise<void>
  stop(): void
  retry(messageId: string): void
  createGroup(input: CreateGroupInput): Promise<void>
  updateGroup(input: UpdateGroupInput): Promise<void>
  archiveGroup(groupId: string, archived: boolean): Promise<void>
  deleteGroup(groupId: string): Promise<void>
  toggleMemory(open?: boolean): void
  setHoverSeq(seq: number | null): void
  jumpTo(seq: number): void
  setAppearance(patch: Partial<Appearance>): void
  toggleNight(): void
  setUserProfile(profile: UserProfile): Promise<void>
  setUserSeal(seal: UserSeal): void
  setGroupAvatar(groupId: string, memberId: string, avatar: Avatar | null): Promise<void>
  setMemberAvatar(memberId: string, avatar: Avatar): Promise<void>
  saveMember(input: SaveMemberInput): Promise<Member>
  deleteMember(memberId: string): Promise<void>
  saveProvider(input: SaveProviderInput): Promise<ProviderConfig>
  deleteProvider(providerId: string): Promise<void>
  setMemoryConfig(config: MemoryConfig): Promise<void>
  confirmMemory(id: string): Promise<void>
  rejectMemory(id: string): Promise<void>
  reopenMemory(id: string): Promise<void>
  editMemory(id: string, content: string): Promise<void>
  completeMemory(id: string): Promise<void>
  uncompleteMemory(id: string): Promise<void>
  summarize(): Promise<void>
}

// ---- 流式增量批处理：一帧只提交一次，避免每个字触发一次渲染 ----
const pending = new Map<string, { groupId: string; text: string }>()
let frame = 0
const activeTurns = new Map<string, string>()

function flushDeltas() {
  frame = 0
  if (pending.size === 0) return
  const batch = new Map(pending)
  pending.clear()
  useChat.setState((s) => {
    const detail = { ...s.detail }
    for (const [messageId, { groupId, text }] of batch) {
      const g = detail[groupId]
      if (!g) continue
      detail[groupId] = {
        ...g,
        messages: g.messages.map((m) => (m.id === messageId ? { ...m, content: m.content + text } : m)),
      }
    }
    return { detail }
  })
}

function upsert(list: Message[], m: Message): Message[] {
  const i = list.findIndex((x) => x.id === m.id)
  if (i < 0) return [...list, m].sort((a, b) => a.seq - b.seq)
  const next = list.slice()
  // streaming 通知可能追上尚未绘制的增量；终态经过后端清理，必须采用权威正文。
  const queued = pending.get(m.id)
  const local = next[i].content + (queued?.text ?? '')
  // 重试会把消息重置为 pending + 空内容，此时必须以后端为准
  const keepLocal = m.status === 'streaming' && local.length > m.content.length
  next[i] = { ...m, content: keepLocal ? local : m.content }
  if (queued) pending.delete(m.id)
  return next
}

const darkQuery = matchMedia('(prefers-color-scheme: dark)')

/** 把外观偏好落到根元素上，返回实际是否为夜间。 */
function applyAppearance(a: Appearance): boolean {
  const night = a.mode === 'night' || (a.mode === 'system' && darkQuery.matches)
  const root = document.documentElement
  root.dataset.paper = night ? a.nightPaper : a.paper
  root.dataset.font = a.fontSize
  root.dataset.density = a.density
  return night
}

function onEvent(e: BackendEvent) {
  const set = useChat.setState
  switch (e.kind) {
    case 'delta': {
      // 首次打开群期间的增量由真实桥接并入快照；尚无 detail 时不能再次排入 RAF。
      if (!useChat.getState().detail[e.groupId]) return
      const cur = pending.get(e.messageId)
      pending.set(e.messageId, { groupId: e.groupId, text: (cur?.text ?? '') + e.delta })
      if (!frame) frame = requestAnimationFrame(flushDeltas)
      return
    }
    case 'message':
      set((s) => {
        const g = s.detail[e.groupId]
        if (!g) return {}
        return { detail: { ...s.detail, [e.groupId]: { ...g, messages: upsert(g.messages, e.message) } } }
      })
      return
    case 'turn.start':
      activeTurns.set(e.groupId, e.turnId)
      set((s) => patchGroup(s, e.groupId, { busy: true }))
      return
    case 'turn.end':
      if (activeTurns.has(e.groupId) && activeTurns.get(e.groupId) !== e.turnId) return
      activeTurns.delete(e.groupId)
      flushDeltas()
      set((s) => patchGroup(s, e.groupId, { busy: false }))
      return
    case 'memory':
      if(e.error) reportError(new Error(e.error))
      set((s) => {
        const g = s.detail[e.groupId]
        if (!g) return {}
        return patchGroup(s, e.groupId, { memory: e.items, summarizing: e.summarizing, group: { ...g.group, memoryCursor: e.cursor } })
      })
      return
    case 'group':
      set((s) => {
        const rest = s.groups.filter((g) => g.id !== e.group.id)
        const groups = [e.group, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        const d = s.detail[e.group.id]
        if (!d) return { groups }
        const { lastMessage: _, ...info } = e.group
        return { groups, detail: { ...s.detail, [e.group.id]: { ...d, group: { ...d.group, ...info } } } }
      })
      return
    case 'group.remove':
      activeTurns.delete(e.groupId)
      set((s) => {
        const detail = { ...s.detail }
        delete detail[e.groupId]
        return { groups: s.groups.filter((g) => g.id !== e.groupId), detail, activeId: s.activeId === e.groupId ? null : s.activeId }
      })
      return
  }
}

function patchGroup(s: ChatStore, id: string, patch: Partial<GroupState>): Partial<ChatStore> {
  const g = s.detail[id]
  if (!g) return {}
  return { detail: { ...s.detail, [id]: { ...g, ...patch } } }
}

function patchMemoryItem(item: MemoryItem) {
  useChat.setState((s) => {
    const g = s.detail[item.groupId]
    if (!g) return {}
    return patchGroup(s, item.groupId, { memory: g.memory.map((m) => (m.id === item.id ? item : m)) })
  })
}

export const useChat = create<ChatStore>((set, get) => ({
  ready: false,
  error: null,
  platform: 'mac',
  appearance: DEFAULT_APPEARANCE,
  night: false,
  profileSaving: false,
  userDisplayName: '你',
  userSeal: DEFAULT_USER_SEAL,
  view: 'chat',
  members: {},
  retiredIds: [],
  providers: [],
  memory: { providerId: '', model: '' },
  version: '',
  groups: [],
  activeId: null,
  detail: {},
  memoryOpen: true,
  hoverSeq: null,
  jump: null,
  justStamped: null,

  async init() {
    backend.subscribe(onEvent)
    try {
      const b = await backend.bootstrap()
      const night = applyAppearance(b.appearance)
      darkQuery.addEventListener('change', () => set({ night: applyAppearance(get().appearance) }))
      document.documentElement.dataset.platform = b.platform
      set({
        ready: true,
        platform: b.platform,
        appearance: b.appearance,
        night,
        userDisplayName: b.userDisplayName || '你',
        userSeal: b.userSeal,
        providers: b.providers,
        memory: b.memory ?? { providerId: '', model: '' },
        version: b.version ?? '',
        members: Object.fromEntries(b.members.map((m) => [m.id, m])),
        retiredIds: b.retiredMemberIds ?? [],
        groups: b.groups,
      })
      const first = b.groups.find((g) => !g.archived) ?? b.groups[0]
      if (first) await get().open(first.id)
    } catch (err) {
      set({ error: String(err) })
    }
  },

  async open(groupId) {
    set({ activeId: groupId, view: 'chat', hoverSeq: null })
    if (get().detail[groupId]) return
    const d = await backend.openGroup(groupId)
    set((s) => ({ detail: { ...s.detail, [groupId]: { ...d, summarizing: false } } }))
  },

  setView(view) {
    set({ view })
  },

  async send(content, mode, attachmentIds) {
    const id = get().activeId
    if (!id) return
    await backend.send(id, content, mode, attachmentIds)
  },

  stop() {
    const id = get().activeId
    if (id) void backend.stop(id).catch(reportError)
  },

  retry(messageId) {
    void backend.retry(messageId).catch(reportError)
  },

  async createGroup(input) {
    const g = await backend.createGroup(input)
    await get().open(g.id)
  },

  async updateGroup(input) {
    const g = await backend.updateGroup(input)
    set((s) => {
      const groups = s.groups.map((x) => (x.id === g.id ? { ...x, ...g } : x))
      const d = s.detail[g.id]
      if (!d) return { groups }
      return { groups, detail: { ...s.detail, [g.id]: { ...d, group: { ...d.group, ...g } } } }
    })
  },

  async archiveGroup(groupId, archived) {
    try { await backend.archiveGroup(groupId, archived) }
    catch (err) { reportError(err); return }
    set((s) => ({ groups: s.groups.map((x) => (x.id === groupId ? { ...x, archived } : x)) }))
  },

  async deleteGroup(groupId) {
    try { await backend.deleteGroup(groupId) }
    catch (err) { reportError(err); return }
    // 后端也会推 group.remove；这里乐观移除，事件到了再校正（幂等）。
    set((s) => {
      const detail = { ...s.detail }
      delete detail[groupId]
      return { groups: s.groups.filter((g) => g.id !== groupId), detail, activeId: s.activeId === groupId ? null : s.activeId }
    })
  },

  toggleMemory(open) {
    set((s) => ({ memoryOpen: open ?? !s.memoryOpen }))
  },

  setHoverSeq(hoverSeq) {
    set({ hoverSeq })
  },

  jumpTo(seq) {
    set({ jump: { seq, nonce: Date.now() } })
  },

  setAppearance(patch) {
    const previous = get().appearance
    const appearance = { ...previous, ...patch }
    set({ appearance, night: applyAppearance(appearance) })
    void backend.setAppearance(appearance).catch((err) => {
      if (get().appearance === appearance) set({ appearance: previous, night: applyAppearance(previous) })
      reportError(err)
    })
  },

  toggleNight() {
    get().setAppearance({ mode: get().night ? 'day' : 'night' })
  },

  async setUserProfile(profile) {
    if (get().profileSaving) throw new Error('个人资料正在保存，请稍后再保存。')
    set({ profileSaving: true })
    try {
      await backend.setUserProfile(profile)
      set({ userDisplayName: profile.displayName.trim(), userSeal: profile.seal })
    } finally { set({ profileSaving: false }) }
  },

  setUserSeal(userSeal) {
    if (get().profileSaving) { reportError(new Error('个人资料正在保存，请稍后再保存。')); return }
    const previous = get().userSeal
    set({ userSeal, profileSaving: true })
    void backend.setUserSeal(userSeal).catch((err) => {
      if (get().userSeal === userSeal) set({ userSeal: previous })
      reportError(err)
    }).finally(() => set({ profileSaving: false }))
  },

  async setGroupAvatar(groupId, memberId, avatar) {
    await backend.setGroupAvatar(groupId, memberId, avatar)
  },

  async setMemberAvatar(memberId, avatar) {
    const m = await backend.setMemberAvatar(memberId, avatar)
    set((s) => ({ members: { ...s.members, [m.id]: m } }))
  },

  async saveMember(input) {
    const m = await backend.saveMember(input)
    set((s) => ({ members: { ...s.members, [m.id]: m }, retiredIds: s.retiredIds.filter((id) => id !== m.id) }))
    return m
  },

  async deleteMember(memberId) {
    await backend.deleteMember(memberId)
    // 成员仍留在 members 里用于渲染历史，但标记为已退群（从名册与邀请列表移除）。
    set((s) => ({
      retiredIds: s.retiredIds.includes(memberId) ? s.retiredIds : [...s.retiredIds, memberId],
      groups: s.groups.map((g) => (g.memberIds.includes(memberId) ? { ...g, memberIds: g.memberIds.filter((id) => id !== memberId) } : g)),
      detail: Object.fromEntries(Object.entries(s.detail).map(([id, d]) => [id, { ...d, group: { ...d.group, memberIds: d.group.memberIds.filter((x) => x !== memberId) } }])),
    }))
  },

  async saveProvider(input) {
    const p = await backend.saveProvider(input)
    set((s) => {
      const i = s.providers.findIndex((x) => x.id === p.id)
      const providers = i < 0 ? [...s.providers, p] : s.providers.map((x) => (x.id === p.id ? p : x))
      return { providers }
    })
    return p
  },

  async deleteProvider(providerId) {
    await backend.deleteProvider(providerId)
    set((s) => ({
      providers: s.providers.filter((p) => p.id !== providerId),
      memory: s.memory.providerId === providerId ? { providerId: '', model: '' } : s.memory,
    }))
  },

  async setMemoryConfig(config) {
    try { await backend.setMemoryConfig(config) }
    catch (err) { reportError(err); return }
    set(() => ({ memory: config }))
  },

  async confirmMemory(id) {
    set({ justStamped: id })
    await updateMemory(id, { status: 'confirmed', confirmedAt: new Date().toISOString() }, () => backend.memory.confirm(id))
  },

  async rejectMemory(id) {
    await updateMemory(id, { status: 'rejected', confirmedAt: undefined }, () => backend.memory.reject(id))
  },

  async reopenMemory(id) {
    await updateMemory(id, { status: 'proposed', confirmedAt: undefined }, () => backend.memory.reopen(id))
  },

  async editMemory(id, content) {
    await updateMemory(id, { content, origin: 'user' }, () => backend.memory.edit(id, content))
  },

  async completeMemory(id) {
    await updateMemory(id, { status: 'done' }, () => backend.memory.complete(id))
  },

  async uncompleteMemory(id) {
    await updateMemory(id, { status: 'proposed' }, () => backend.memory.uncomplete(id))
  },

  async summarize() {
    const id = get().activeId
    if (id) await backend.memory.summarize(id).catch(reportError)
  },
}))

/** 乐观更新：点击立刻生效，后端返回后再校正。 */
function optimistic(id: string, patch: Partial<MemoryItem>) {
  const s = useChat.getState()
  for (const g of Object.values(s.detail)) {
    const it = g.memory.find((m) => m.id === id)
    if (it) return patchMemoryItem({ ...it, ...patch })
  }
}

export const useActive = () => useChat((s) => (s.activeId ? s.detail[s.activeId] : undefined))

function reportError(err: unknown) { useChat.setState({ error: err instanceof Error ? err.message : String(err) }) }

async function updateMemory(id: string, patch: Partial<MemoryItem>, operation: () => Promise<MemoryItem>) {
  const previous = Object.values(useChat.getState().detail).flatMap((g) => g.memory).find((item) => item.id === id)
  optimistic(id, patch)
  try { patchMemoryItem(await operation()) }
  catch (err) {
    if (previous) {
      try {
        const detail = await backend.openGroup(previous.groupId)
        useChat.setState((s) => patchGroup(s, previous.groupId, { memory: detail.memory, group: detail.group }))
      } catch { patchMemoryItem(previous) }
    }
    if (useChat.getState().justStamped === id) useChat.setState({ justStamped: null })
    reportError(err)
  }
}
