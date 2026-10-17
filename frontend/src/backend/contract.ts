/**
 * 前端与 Go 后端的契约。字段语义与 internal/domain/domain.go 一一对应（Go 侧 PascalCase → 这里 camelCase）。
 * 页面和组件只能通过 Backend 接口与后端交互：
 *   - mock.ts      浏览器开发用的模拟实现（已完成）
 *   - wails.ts     Wails v3 绑定实现（TASK-002）
 * 改动本文件即改动契约，需同步修改 Go 侧并写 ADR。
 */

export type ReplyMode = 'serial' | 'parallel'
export type AuthorKind = 'user' | 'member' | 'system'
export type MessageStatus = 'pending' | 'streaming' | 'done' | 'error' | 'stopped'
export type Pigment = 'shiqing' | 'shilv' | 'zheshi' | 'tenghuang' | 'dai' | 'zise'
export type Platform = 'mac' | 'windows' | 'linux'

/** 纸张：四种日间、两种夜间。定义见 design/tokens.css */
export type LightPaper = 'xuan' | 'su' | 'ma' | 'qing'
export type DarkPaper = 'ye' | 'wujin'
export type PaperId = LightPaper | DarkPaper

export interface Appearance {
  mode: 'day' | 'night' | 'system'
  paper: LightPaper // 白昼用的纸
  nightPaper: DarkPaper // 夜间用的纸
  fontSize: 's' | 'm' | 'l'
  density: 'comfortable' | 'compact'
}

/** 用户的私印：既是用户头像，也是确认纪要时盖下的印。1–4 个字 */
export interface UserProfile {
  displayName: string
  seal: UserSeal
}

export interface UserSeal {
  text: string
  style: 'baiwen' | 'zhuwen' // 白文（朱底纸色字）/ 朱文（纸底朱色字）
}

export const DEFAULT_APPEARANCE: Appearance = { mode: 'day', paper: 'xuan', nightPaper: 'ye', fontSize: 'm', density: 'comfortable' }
export const DEFAULT_USER_SEAL: UserSeal = { text: '我', style: 'baiwen' }

export const USER_ID = 'user'

export interface Avatar {
  glyph: string
  color: Pigment
  /** 可直接用于 <img src> 的地址（Wails 下由 Go 的资源服务提供，见 TASK-013）。支持动图 */
  image?: string
}

export interface Member {
  id: string
  name: string
  avatar: Avatar
  brief: string
  rolePrompt: string
  providerId: string
  model: string
  temperature?: number
  contextTokens: number
}

export interface ProviderConfig {
  id: string
  name: string
  kind: 'openai' | 'anthropic'
  baseUrl: string
  hasKey: boolean // Key 永远不回传前端，只告诉有没有
}

export interface GroupSummary {
  id: string
  title: string
  topic: string
  memberIds: string[]
  /** 本群对成员头像的覆盖，没有覆盖的成员用其默认头像 */
  memberAvatars: Record<string, Avatar>
  lastMessage?: { authorId: string; authorKind: AuthorKind; preview: string; at: string }
  updatedAt: string
  /** 已归档：仍在数据里，但从侧栏主列表移入「已归档」区（TASK-009） */
  archived: boolean
}

export interface Group extends GroupSummary {
  defaultMode: ReplyMode
  memoryCursor: number
  createdAt: string
}

export interface Message {
  id: string
  groupId: string
  seq: number
  authorKind: AuthorKind
  authorId: string
  content: string
  mentions: string[]
  mentionAll: boolean
  replyToId: string
  turnId: string
  provider: string
  model: string
  contextSeq: number
  status: MessageStatus
  error: string
  createdAt: string
  finishedAt?: string
  /** 这条消息触发的一轮用的是依次还是同时回复（仅用户消息有意义；见 TASK-005 重试） */
  replyMode: ReplyMode
}

export type MemoryKind = 'background' | 'plan' | 'decision' | 'todo'
export type MemoryStatus = 'proposed' | 'confirmed' | 'rejected' | 'done' | 'superseded'
export type MemoryOrigin = 'user' | 'member'

export interface MemorySource {
  messageId: string
  seq: number
  role: 'proposed' | 'discussed' | 'completed'
}

export interface MemoryItem {
  id: string
  groupId: string
  ref: number
  kind: MemoryKind
  content: string
  status: MemoryStatus
  origin: MemoryOrigin
  proposedBy: string
  sources: MemorySource[]
  confirmedAt?: string
  supersededBy: string
  createdAt: string
  updatedAt: string
}

export interface Bootstrap {
  platform: Platform
  appearance: Appearance
  userDisplayName: string
  userSeal: UserSeal
  members: Member[]
  providers: ProviderConfig[]
  groups: GroupSummary[]
  /** 只作为历史发言者存在的已删除成员：仍用于渲染历史，但不出现在名册与邀请列表里 */
  retiredMemberIds: string[]
  /** 纪要整理使用的服务与模型（TASK-008） */
  memory: MemoryConfig
  version: string
}

export interface MemoryConfig {
  providerId: string
  model: string
}

/** 新建或编辑一个模型服务（TASK-008）；id 为空表示新建。key 留空表示不修改已保存的 Key。 */
export interface SaveProviderInput {
  id: string
  name: string
  kind: 'openai' | 'anthropic'
  baseUrl: string
  key: string
  testModel?: string
}

export interface GroupDetail {
  group: Group
  messages: Message[]
  memory: MemoryItem[]
  busy: boolean
}

export interface SendResult {
  userMessage: Message
  turnId: string
  order: string[]
}

export interface CreateGroupInput {
  title: string
  topic: string
  memberIds: string[]
  defaultMode: ReplyMode
}

/** 群设置的保存内容（TASK-009） */
export interface UpdateGroupInput {
  id: string
  title: string
  topic: string
  defaultMode: ReplyMode
  memberIds: string[]
}

/** 新建或编辑一位成员；id 为空表示新建（TASK-007）。 */
export interface SaveMemberInput {
  id: string
  name: string
  avatar: Avatar
  brief: string
  rolePrompt: string
  providerId: string
  model: string
  temperature?: number
  contextTokens: number
}

export type BackendEvent =
  | { kind: 'message'; groupId: string; message: Message }
  | { kind: 'delta'; groupId: string; messageId: string; delta: string }
  | { kind: 'turn.start'; groupId: string; turnId: string; order: string[] }
  | { kind: 'turn.end'; groupId: string; turnId: string }
  | { kind: 'memory'; groupId: string; items: MemoryItem[]; cursor: number; summarizing: boolean }
  | { kind: 'group'; group: GroupSummary }
  | { kind: 'group.remove'; groupId: string }

export interface Backend {
  bootstrap(): Promise<Bootstrap>
  openGroup(groupId: string): Promise<GroupDetail>
  createGroup(input: CreateGroupInput): Promise<Group>
  /** 保存群设置（改名/主题/模式/成员增删排序），每次变更写系统消息（TASK-009） */
  updateGroup(input: UpdateGroupInput): Promise<Group>
  /** 归档或取消归档（TASK-009） */
  archiveGroup(groupId: string, archived: boolean): Promise<void>
  /** 删除群并级联删除消息与记忆（TASK-009） */
  deleteGroup(groupId: string): Promise<void>
  send(groupId: string, content: string, mode?: ReplyMode): Promise<SendResult>
  stop(groupId: string): Promise<void>
  /** 重新生成一条失败或中断的回复（TASK-005：Go 侧 Orchestrator.Retry） */
  retry(messageId: string): Promise<void>
  memory: {
    confirm(itemId: string): Promise<MemoryItem>
    reject(itemId: string): Promise<MemoryItem>
    reopen(itemId: string): Promise<MemoryItem>
    edit(itemId: string, content: string): Promise<MemoryItem>
    /** 勾选完成一条待办（TASK-010） */
    complete(itemId: string): Promise<MemoryItem>
    /** 撤销完成，回到未确认（TASK-010） */
    uncomplete(itemId: string): Promise<MemoryItem>
    /** 立即整理新讨论，结果通过 memory 事件推送 */
    summarize(groupId: string): Promise<void>
  }
  setAppearance(a: Appearance): Promise<void>
  setUserProfile(profile: UserProfile): Promise<void>
  setUserSeal(seal: UserSeal): Promise<void>
  /** 保存一张头像图片（原样保存，动图保留动画），返回可用于 Avatar.image 的地址 */
  uploadAvatar(file: File): Promise<string>
  /** 设置成员在某个群里的头像；avatar 为 null 表示恢复默认 */
  setGroupAvatar(groupId: string, memberId: string, avatar: Avatar | null): Promise<GroupSummary>
  /** 修改成员的默认头像（TASK-007 的成员编辑也用它） */
  setMemberAvatar(memberId: string, avatar: Avatar): Promise<Member>
  /** 新建或编辑一位成员（TASK-007） */
  saveMember(input: SaveMemberInput): Promise<Member>
  /** 软删除成员：从所有群移出并写系统消息（TASK-007） */
  deleteMember(memberId: string): Promise<void>
  /** 新建或编辑一个模型服务（TASK-008） */
  saveProvider(input: SaveProviderInput): Promise<ProviderConfig>
  /** 删除模型服务；仍被成员使用时拒绝（TASK-008） */
  deleteProvider(providerId: string): Promise<void>
  /** 发一个极短请求测试连通性，返回耗时毫秒（TASK-008） */
  testProvider(input: SaveProviderInput): Promise<number>
  /** 保存纪要整理使用的服务与模型（TASK-008） */
  setMemoryConfig(config: MemoryConfig): Promise<void>
  /** 数据目录路径（TASK-008） */
  dataDir(): Promise<string>
  /** 在文件管理器中打开数据目录（TASK-008） */
  openDataDir(): Promise<void>
  window: {
    minimise(): void
    toggleMaximise(): void
    close(): void
  }
  subscribe(handler: (e: BackendEvent) => void): () => void
}
