import { DEMO_ATTACHMENT_LIMIT, DEMO_SNAPSHOT_LIMIT, DEMO_STORAGE_ERROR, DEMO_STATE_KEY, demoKey, isDemo, recoverDemoGroups, validateDemoAvatar } from '../demo/storage'
import { validateAttachment, validateDocument } from '../lib/attachments'
import { validateUserProfile } from '../lib/userProfile'
import type {
  Attachment,
  Appearance,
  Avatar,
  Backend,
  BackendEvent,
  Bootstrap,
  CreateGroupInput,
  Group,
  GroupDetail,
  MemoryConfig,
  MemoryItem,
  Member,
  Message,
  ProviderConfig,
  ReplyMode,
  SaveProviderInput,
  SendResult,
  UpdateGroupInput,
  UserSeal,
} from './contract'
import { DEFAULT_APPEARANCE, DEFAULT_USER_SEAL, USER_ID } from './contract'
import { parseMentions, planTargets } from '../lib/mention'

/**
 * 浏览器开发用的模拟后端。行为对齐 internal/turn/orchestrator.go：
 * 占位 → 串行/并行流式 → 收尾；停止保留已生成部分；失败不阻塞后续成员。
 * 这里的文案只是演示，不代表模型真实输出。
 */

const iso = (d: Date) => d.toISOString()
const minutesAgo = (n: number) => iso(new Date(Date.now() - n * 60_000))
let idSeq = 1000
const nid = (p: string) => `${p}${++idSeq}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 演示数据与界面语言一致；切换语言不会改写已有记录。
const storedLanguage = readJSON<string>(demoKey('agc.language'))
let language = typeof storedLanguage === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(storedLanguage) ? storedLanguage : 'zh'
const localized = (zh: string, en: string) => (language === 'zh' ? zh : en)
const demoUserSeal: UserSeal = language === 'zh' ? DEFAULT_USER_SEAL : { text: 'Y', style: 'baiwen' }

const membersZh: Member[] = [
  {
    id: 'mo', name: '墨白', avatar: { glyph: '墨', color: 'shiqing' }, brief: '管好看和好用，偶尔为一行字较真',
    rolePrompt: '你是一位对细节敏感的体验设计师，喜欢用具体的画面和例子说话，反对空洞的套话。', providerId: 'p1', model: 'claude-sonnet-5-5', contextTokens: 64000,
  },
  {
    id: 'qy', name: '青砚', avatar: { glyph: '青', color: 'shilv' }, brief: '读代码，也读言外之意',
    rolePrompt: '你是一个爱较真的代码审查者，会指出风险，也会给出能落地的替代方案。说话直接，但不刻薄。', providerId: 'p2', model: 'deepseek-chat', contextTokens: 32000,
  },
  {
    id: 'sy', name: '拾遗', avatar: { glyph: '拾', color: 'zheshi' }, brief: '负责追问，直到问题变清楚',
    rolePrompt: '你是一位善于追问的产品经理，喜欢把模糊的想法拆成具体的小问题，也会提醒大家别忘了最初的目的。', providerId: 'p1', model: 'claude-haiku-5-5', contextTokens: 32000,
  },
  {
    id: 'gl', name: '观澜', avatar: { glyph: '澜', color: 'dai' }, brief: '用数字讲故事，也承认数字讲不出的部分',
    rolePrompt: '你是一位数据分析师，习惯用数字和对比说明问题，也会诚实地说出数据覆盖不到的地方。', providerId: 'p3', model: 'qwen-max', contextTokens: 32000,
  },
]

const membersEn: Member[] = [
  {
    id: 'mo', name: 'Mira', avatar: { glyph: 'M', color: 'shiqing' }, brief: 'Cares about how things look and feel',
    rolePrompt: 'You are a detail-sensitive experience designer. You speak with concrete images and examples, and dislike empty jargon.', providerId: 'p1', model: 'claude-sonnet-5-5', contextTokens: 64000,
  },
  {
    id: 'qy', name: 'Kai', avatar: { glyph: 'K', color: 'shilv' }, brief: 'Reads code, and what is between the lines',
    rolePrompt: 'You are a stubborn code reviewer. You point out risks and offer workable alternatives. Direct, never unkind.', providerId: 'p2', model: 'deepseek-chat', contextTokens: 32000,
  },
  {
    id: 'sy', name: 'June', avatar: { glyph: 'J', color: 'zheshi' }, brief: 'Keeps asking until the question is clear',
    rolePrompt: 'You are a product thinker who asks good questions. You turn fuzzy ideas into small concrete questions and remind the group of the original goal.', providerId: 'p1', model: 'claude-haiku-5-5', contextTokens: 32000,
  },
  {
    id: 'gl', name: 'Theo', avatar: { glyph: 'T', color: 'dai' }, brief: 'Tells stories with numbers, and admits what they miss',
    rolePrompt: 'You are a data analyst. You explain with numbers and comparisons, and you are honest about what the data cannot show.', providerId: 'p3', model: 'qwen-max', contextTokens: 32000,
  },
]

const members: Member[] = language === 'zh' ? membersZh : membersEn
const memberById: Record<string, Member> = Object.fromEntries(members.map((m) => [m.id, m]))
// 已软删除、但仍用于渲染历史消息的成员
const retired = new Set<string>()

function msg(p: Partial<Message> & Pick<Message, 'groupId' | 'seq' | 'authorKind' | 'authorId' | 'content'>): Message {
  return {
    id: `m-${p.groupId}-${p.seq}`, mentions: [], mentionAll: false, replyToId: '', turnId: '', provider: '', model: '',
    contextSeq: 0, status: 'done', error: '', createdAt: minutesAgo(60), replyMode: 'serial', ...p,
  }
}

function seedHomeZh(): GroupDetail {
  const g = 'g1'
  const messages: Message[] = [
    msg({ groupId: g, seq: 1, authorKind: 'system', authorId: '', content: '你创建了群聊，邀请了 墨白、青砚、拾遗', createdAt: minutesAgo(180) }),
    msg({ groupId: g, seq: 2, authorKind: 'user', authorId: USER_ID, turnId: 't1', mentions: ['mo', 'qy'], createdAt: minutesAgo(52),
      content: '@墨白 @青砚 官网首页现在是三栏，信息太散。想改成单列，你们先各自看看可行性。' }),
    msg({ groupId: g, seq: 3, authorKind: 'member', authorId: 'mo', turnId: 't1', replyToId: 'm-g1-2', model: 'claude-sonnet-5-5', contextSeq: 2, createdAt: minutesAgo(51),
      content: '单列可行，而且更适合现在以移动端为主的访问结构。建议这样排：\n\n1. **首屏**：一句话价值主张 + 搜索框，去掉轮播\n2. **核心场景**：三张纵向卡片，每张只讲一件事\n3. **信任背书**：客户 logo 与一句引言\n\n三栏里的「最新动态」可以下沉到页脚，访问数据里它的点击率很低。' }),
    msg({ groupId: g, seq: 4, authorKind: 'member', authorId: 'qy', turnId: 't1', replyToId: 'm-g1-2', model: 'deepseek-chat', contextSeq: 3, createdAt: minutesAgo(50),
      content: '同意墨白在 #3 的结构。实现上补两点：\n\n- 三张卡片如果都依赖接口数据，首屏会有明显的空白闪烁，**需要骨架屏**\n- 现在的轮播组件被其他三个页面复用，删首页的引用即可，组件本身先别动' }),
    msg({ groupId: g, seq: 5, authorKind: 'user', authorId: USER_ID, turnId: 't2', createdAt: minutesAgo(40),
      content: '单列就这么定了。首屏保留搜索框，低保真稿我来画。' }),
    msg({ groupId: g, seq: 6, authorKind: 'user', authorId: USER_ID, turnId: 't3', mentions: ['sy'], createdAt: minutesAgo(22),
      content: '@拾遗 从需求角度，这次改版还有什么没考虑到的？' }),
    msg({ groupId: g, seq: 7, authorKind: 'member', authorId: 'sy', turnId: 't3', replyToId: 'm-g1-6', model: 'claude-haiku-5-5', contextSeq: 6, createdAt: minutesAgo(21),
      content: '有三个问题需要先回答：\n\n1. 老用户习惯从三栏右侧进入「文档」，改版后入口在哪？建议首屏导航里保留\n2. M1 定了单列，但没定**桌面端最大宽度**，大屏上单列会很空\n3. 改版效果怎么衡量？建议先定一个指标，比如首屏到注册页的转化率' }),
    msg({ groupId: g, seq: 8, authorKind: 'user', authorId: USER_ID, turnId: 't4', mentions: ['gl'], mentionAll: false, createdAt: minutesAgo(9),
      content: '@墨白 桌面端最大宽度你建议多少？' }),
    msg({ groupId: g, seq: 9, authorKind: 'member', authorId: 'mo', turnId: 't4', replyToId: 'm-g1-8', model: 'claude-sonnet-5-5', status: 'stopped', contextSeq: 8, createdAt: minutesAgo(8),
      content: '正文区建议 **720px** 左右，这是中文阅读比较舒服的行宽（每行 36–40 字）。卡片区可以放宽到 1080px，两侧留白用浅色底区分' }),
  ]
  messages[7].mentions = ['mo']
  const t = (n: number) => minutesAgo(n)
  const memory: MemoryItem[] = [
    { id: 'k1', groupId: g, ref: 1, kind: 'decision', content: '官网首页由三栏改为单列布局', status: 'confirmed', origin: 'member', proposedBy: 'mo',
      sources: [{ messageId: 'm-g1-3', seq: 3, role: 'proposed' }, { messageId: 'm-g1-5', seq: 5, role: 'discussed' }], confirmedAt: t(39), supersededBy: '', createdAt: t(45), updatedAt: t(39) },
    { id: 'k2', groupId: g, ref: 2, kind: 'plan', content: '首屏保留搜索框，去掉轮播', status: 'proposed', origin: 'user', proposedBy: USER_ID,
      sources: [{ messageId: 'm-g1-3', seq: 3, role: 'proposed' }, { messageId: 'm-g1-5', seq: 5, role: 'discussed' }], supersededBy: '', createdAt: t(39), updatedAt: t(39) },
    { id: 'k3', groupId: g, ref: 3, kind: 'plan', content: '卡片数据加载期间使用骨架屏，避免首屏空白闪烁', status: 'proposed', origin: 'member', proposedBy: 'qy',
      sources: [{ messageId: 'm-g1-4', seq: 4, role: 'proposed' }], supersededBy: '', createdAt: t(39), updatedAt: t(39) },
    { id: 'k4', groupId: g, ref: 4, kind: 'todo', content: '画首页单列低保真稿', status: 'proposed', origin: 'user', proposedBy: USER_ID,
      sources: [{ messageId: 'm-g1-5', seq: 5, role: 'proposed' }], supersededBy: '', createdAt: t(39), updatedAt: t(39) },
    { id: 'k5', groupId: g, ref: 5, kind: 'todo', content: '确定改版效果的衡量指标', status: 'proposed', origin: 'member', proposedBy: 'sy',
      sources: [{ messageId: 'm-g1-7', seq: 7, role: 'proposed' }], supersededBy: '', createdAt: t(20), updatedAt: t(20) },
    { id: 'k6', groupId: g, ref: 6, kind: 'background', content: '官网访问以移动端为主', status: 'proposed', origin: 'member', proposedBy: 'mo',
      sources: [{ messageId: 'm-g1-3', seq: 3, role: 'proposed' }], supersededBy: '', createdAt: t(45), updatedAt: t(45) },
    { id: 'k7', groupId: g, ref: 7, kind: 'plan', content: '「最新动态」整栏保留在首页右侧', status: 'rejected', origin: 'member', proposedBy: 'qy',
      sources: [{ messageId: 'm-g1-4', seq: 4, role: 'proposed' }], supersededBy: '', createdAt: t(45), updatedAt: t(30) },
    { id: 'k8', groupId: g, ref: 8, kind: 'todo', content: '盘点轮播组件的复用页面', status: 'done', origin: 'member', proposedBy: 'qy',
      sources: [{ messageId: 'm-g1-4', seq: 4, role: 'proposed' }], supersededBy: '', createdAt: t(45), updatedAt: t(25) },
  ]
  return {
    group: { id: g, title: '首页要不要改单列', topic: '官网首页从三栏改成单列，已经聊到排版、实现和取舍', memberIds: ['mo', 'qy', 'sy'], memberAvatars: {}, archived: false,
      defaultMode: 'serial', memoryCursor: 7, createdAt: minutesAgo(180), updatedAt: minutesAgo(8) },
    messages, memory, busy: false,
  }
}

function seedHomeEn(): GroupDetail {
  const g = 'g1'
  const messages: Message[] = [
    msg({ groupId: g, seq: 1, authorKind: 'system', authorId: '', content: 'You created the group and invited Mira, Kai, and June', createdAt: minutesAgo(180) }),
    msg({ groupId: g, seq: 2, authorKind: 'user', authorId: USER_ID, turnId: 't1', mentions: ['mo', 'qy'], createdAt: minutesAgo(52),
      content: '@Mira @Kai The homepage is three columns right now and feels scattered. I want to try a single column — take a look and tell me if it is feasible.' }),
    msg({ groupId: g, seq: 3, authorKind: 'member', authorId: 'mo', turnId: 't1', replyToId: 'm-g1-2', model: 'claude-sonnet-5-5', contextSeq: 2, createdAt: minutesAgo(51),
      content: 'Single column works, and it fits the mobile-first traffic. I would arrange it like this:\n\n1. **First screen**: one-line value proposition + search, drop the carousel\n2. **Core scenarios**: three vertical cards, one idea each\n3. **Trust**: customer logos and one quote\n\nThe “Latest” column can move to the footer; clicks there are low.' }),
    msg({ groupId: g, seq: 4, authorKind: 'member', authorId: 'qy', turnId: 't1', replyToId: 'm-g1-2', model: 'deepseek-chat', contextSeq: 3, createdAt: minutesAgo(50),
      content: 'I agree with Mira’s structure in #3. Two implementation notes:\n\n- If all three cards depend on API data, the first screen will flash empty — **add skeletons**\n- The carousel component is reused by three other pages; remove the homepage usage, but do not touch the component yet' }),
    msg({ groupId: g, seq: 5, authorKind: 'user', authorId: USER_ID, turnId: 't2', createdAt: minutesAgo(40),
      content: 'Single column it is. Keep the search box on the first screen; I will sketch the low-fidelity version.' }),
    msg({ groupId: g, seq: 6, authorKind: 'user', authorId: USER_ID, turnId: 't3', mentions: ['sy'], createdAt: minutesAgo(22),
      content: '@June What have we not considered from a product side?' }),
    msg({ groupId: g, seq: 7, authorKind: 'member', authorId: 'sy', turnId: 't3', replyToId: 'm-g1-6', model: 'claude-haiku-5-5', contextSeq: 6, createdAt: minutesAgo(21),
      content: 'Three questions to answer first:\n\n1. Old users enter Docs from the right column. Where does that entry live after the change? I suggest keeping it in the first-screen navigation.\n2. We agreed on single column for M1 but not the **desktop maximum width**. A single column will feel empty on large screens.\n3. How do we measure success? Pick one metric first, such as first screen → signup conversion.' }),
    msg({ groupId: g, seq: 8, authorKind: 'user', authorId: USER_ID, turnId: 't4', mentions: ['mo'], mentionAll: false, createdAt: minutesAgo(9),
      content: '@Mira What desktop width would you suggest?' }),
    msg({ groupId: g, seq: 9, authorKind: 'member', authorId: 'mo', turnId: 't4', replyToId: 'm-g1-8', model: 'claude-sonnet-5-5', status: 'stopped', contextSeq: 8, createdAt: minutesAgo(8),
      content: 'A body width of **720px** feels comfortable for English text (60–75 characters per line). Cards can stretch to 1080px, with light backgrounds in the margins.' }),
  ]
  const t = (n: number) => minutesAgo(n)
  const memory: MemoryItem[] = [
    { id: 'k1', groupId: g, ref: 1, kind: 'decision', content: 'The homepage moves from three columns to a single column', status: 'confirmed', origin: 'member', proposedBy: 'mo',
      sources: [{ messageId: 'm-g1-3', seq: 3, role: 'proposed' }, { messageId: 'm-g1-5', seq: 5, role: 'discussed' }], confirmedAt: t(39), supersededBy: '', createdAt: t(45), updatedAt: t(39) },
    { id: 'k2', groupId: g, ref: 2, kind: 'plan', content: 'Keep the search box on the first screen and drop the carousel', status: 'proposed', origin: 'user', proposedBy: USER_ID,
      sources: [{ messageId: 'm-g1-3', seq: 3, role: 'proposed' }, { messageId: 'm-g1-5', seq: 5, role: 'discussed' }], supersededBy: '', createdAt: t(39), updatedAt: t(39) },
    { id: 'k3', groupId: g, ref: 3, kind: 'plan', content: 'Use skeletons while card data loads to avoid an empty first screen', status: 'proposed', origin: 'member', proposedBy: 'qy',
      sources: [{ messageId: 'm-g1-4', seq: 4, role: 'proposed' }], supersededBy: '', createdAt: t(39), updatedAt: t(39) },
    { id: 'k4', groupId: g, ref: 4, kind: 'todo', content: 'Sketch a low-fidelity single-column homepage', status: 'proposed', origin: 'user', proposedBy: USER_ID,
      sources: [{ messageId: 'm-g1-5', seq: 5, role: 'proposed' }], supersededBy: '', createdAt: t(39), updatedAt: t(39) },
    { id: 'k5', groupId: g, ref: 5, kind: 'todo', content: 'Choose a success metric for the redesign', status: 'proposed', origin: 'member', proposedBy: 'sy',
      sources: [{ messageId: 'm-g1-7', seq: 7, role: 'proposed' }], supersededBy: '', createdAt: t(20), updatedAt: t(20) },
    { id: 'k6', groupId: g, ref: 6, kind: 'background', content: 'Most homepage traffic comes from mobile', status: 'proposed', origin: 'member', proposedBy: 'mo',
      sources: [{ messageId: 'm-g1-3', seq: 3, role: 'proposed' }], supersededBy: '', createdAt: t(45), updatedAt: t(45) },
    { id: 'k7', groupId: g, ref: 7, kind: 'plan', content: 'Keep the entire “Latest” column on the right side of the homepage', status: 'rejected', origin: 'member', proposedBy: 'qy',
      sources: [{ messageId: 'm-g1-4', seq: 4, role: 'proposed' }], supersededBy: '', createdAt: t(45), updatedAt: t(30) },
    { id: 'k8', groupId: g, ref: 8, kind: 'todo', content: 'Audit which pages reuse the carousel component', status: 'done', origin: 'member', proposedBy: 'qy',
      sources: [{ messageId: 'm-g1-4', seq: 4, role: 'proposed' }], supersededBy: '', createdAt: t(45), updatedAt: t(25) },
  ]
  return {
    group: { id: g, title: 'Should the homepage go single-column?', topic: 'The homepage may move from three columns to one — layout, implementation, and trade-offs', memberIds: ['mo', 'qy', 'sy'], memberAvatars: {}, archived: false,
      defaultMode: 'serial', memoryCursor: 7, createdAt: minutesAgo(180), updatedAt: minutesAgo(8) },
    messages, memory, busy: false,
  }
}

function seedSmall(id: string, title: string, topic: string, memberIds: string[], lines: [string, string][]): GroupDetail {
  const messages = lines.map(([who, content], i) =>
    msg({ groupId: id, seq: i + 1, authorKind: who === USER_ID ? 'user' : 'member', authorId: who, content, createdAt: minutesAgo(600 - i * 3), turnId: `t${id}${Math.floor(i / 2)}` }),
  )
  return { group: { id, title, topic, memberIds, memberAvatars: {}, archived: false, defaultMode: 'parallel', memoryCursor: 0, createdAt: minutesAgo(900), updatedAt: minutesAgo(560) }, messages, memory: [], busy: false }
}

const dbZh: Record<string, GroupDetail> = {
  g1: seedHomeZh(),
  g2: seedSmall('g2', '一起读点 Go', '每周挑一个并发话题，慢慢读源码', ['qy', 'gl'], [
    [USER_ID, '@青砚 @观澜 这周想搞懂 context 取消是怎么传播的'],
    ['qy', '核心就一句话：**父 context 取消时，所有子 context 都会收到 Done 信号**。建议从 `context.WithCancel` 的源码读起，重点看 `propagateCancel`。'],
  ]),
  g3: seedSmall('g3', '把周报写得像人话', '', ['sy'], [[USER_ID, '@拾遗 帮我把这周周报改得更有重点']]),
}

const dbEn: Record<string, GroupDetail> = {
  g1: seedHomeEn(),
  g2: seedSmall('g2', 'Reading a little Go', 'One concurrency topic a week, reading the source slowly', ['qy', 'gl'], [
    [USER_ID, '@Kai @Theo This week I want to understand how context cancellation propagates'],
    ['qy', 'The core idea is one sentence: **when a parent context is cancelled, every child context receives a Done signal**. Start with the source of `context.WithCancel`, especially `propagateCancel`.'],
  ]),
  g3: seedSmall('g3', 'Make the weekly update sound human', '', ['sy'], [[USER_ID, '@June Help me make this week’s update sound less like a template']]),
}

const db: Record<string, GroupDetail> = language === 'zh' ? dbZh : dbEn

// 可变的模型服务与纪要整理设置（TASK-008 设置页）
const providers: ProviderConfig[] = [
  { id: 'p1', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', hasKey: true },
  { id: 'p2', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', hasKey: true },
  { id: 'p3', name: localized('通义千问', 'Qwen'), kind: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', hasKey: false },
]
const memoryConfig: MemoryConfig = { providerId: '', model: '' }
type Handler = (e: BackendEvent) => void
const handlers = new Set<Handler>()
let persistDemo = () => {}
let demoStorageFailed = false
const failedStreams = new Set<string>()
const emit = (e: BackendEvent) => {
  try { persistDemo() } catch {
    demoStorageFailed = true
    // 容量错误不允许杀掉异步轮次；停止它并明确显示未保存状态。
    for (const [groupId, controller] of running) {
      controller.abort(); failedStreams.add(groupId)
      const detail = db[groupId]
      detail.busy = false
      for (const message of detail.messages) if (message.status === 'pending' || message.status === 'streaming') {
        message.status = 'error'; message.error = DEMO_STORAGE_ERROR
        handlers.forEach(h => h({kind:'message',groupId,message:{...message}}))
      }
      handlers.forEach(h => h({kind:'turn.end',groupId,turnId:detail.messages.at(-1)?.turnId ?? ''}))
    }
    return
  }
  handlers.forEach((h) => h(e))
}
const running = new Map<string, AbortController>()

function summary(d: GroupDetail) {
  const last = [...d.messages].reverse().find((m) => m.status === 'done' || m.status === 'stopped')
  const preview = last?.content.trim() || (last?.attachments?.length ? localized(`[附件] ${last.attachments[0].name}（${last.attachments.length}份）`, `[Attachment] ${last.attachments[0].name} (${last.attachments.length})`) : '')
  return {
    ...d.group,
    lastMessage: last && { authorId: last.authorId, authorKind: last.authorKind, preview: preview.replace(/[#*`>\n-]+/g, ' ').slice(0, 60), at: last.createdAt },
  }
}

// ---- 演示用回复 ----
function draftReply(self: Member, userText: string, before: Message[], mode: ReplyMode): string {
  const prev = before[before.length - 1]
  const prevName = prev ? memberById[prev.authorId]?.name : ''
  const topic = userText.replace(/[@＠]\S+/g, '').trim().slice(0, 24) || localized('这个问题', 'this topic')
  const lines: Record<string, string[]> = language === 'zh' ? {
    mo: [
      `关于「${topic}」，从体验角度我的看法是：`,
      '',
      '1. **先保证可读性**：正文行宽控制在 36–40 个汉字，行距 1.75 左右',
      '2. **减少同屏决策**：每一屏只让用户做一件事',
      '3. **状态要可见**：加载、空、错误三种状态都要有设计稿',
      '',
      '如果要排优先级，我会先做第 1 点，成本最低、收益最直接。',
    ],
    qy: [
      prev ? `${prevName}在 #${prev.seq} 说的方向我同意，补几个实现上的风险：` : `「${topic}」在实现上有几个点要注意：`,
      '',
      '- 不要在渲染路径里做同步的大计算，**列表超过 200 项要虚拟化**',
      '- 接口失败时要有降级，不能整页白屏',
      '- 改动前先确认影响面，`grep` 一下所有引用点',
      '',
      '```ts\n// 建议的数据获取方式\nconst { data, error } = useQuery(key, fetcher, { staleTime: 30_000 })\n```',
    ],
    sy: [
      prev ? `在 ${prevName} 的基础上，我想追问两个需求层面的问题：` : `「${topic}」我先追问几个问题：`,
      '',
      '1. 这件事要解决的是谁的问题？有没有具体的用户反馈？',
      '2. 做完之后用什么指标判断它是成功的？',
      '',
      '这两点不明确的话，建议先别急着动手。',
    ],
    gl: [
      `从数据看「${topic}」，我建议先拉三个数字：`,
      '',
      '| 指标 | 口径 | 现状 |\n| --- | --- | --- |\n| 首屏跳出率 | 7 日均值 | 待拉取 |\n| 注册转化 | 首页 → 注册页 | 待拉取 |\n| 移动端占比 | UV | 待拉取 |',
      '',
      mode === 'parallel' ? '我没看到其他人的回答，以上是我独立的判断。' : '有了这些再讨论方案会更有底。',
    ],
  } : {
    mo: [
      `About “${topic}”, from an experience point of view:`,
      '',
      '1. **Protect readability**: keep body text around 60–75 characters per line with generous line height',
      '2. **Reduce decisions per screen**: let people do one thing at a time',
      '3. **Make state visible**: design loading, empty, and error states',
      '',
      'If we need a priority, start with #1: lowest cost, clearest payoff.',
    ],
    qy: [
      prev ? `I agree with the direction ${prevName} raised in #${prev.seq}. A few implementation risks:` : `A few implementation notes on “${topic}”:`,
      '',
      '- Do not put expensive synchronous work on the render path; **virtualize lists over 200 items**',
      '- Failures need a fallback; never leave the page blank',
      '- Check the blast radius before editing; `grep` every reference',
      '',
      '```ts\n// A sensible data-fetching shape\nconst { data, error } = useQuery(key, fetcher, { staleTime: 30_000 })\n```',
    ],
    sy: [
      prev ? `Building on ${prevName}, two product questions:` : `For “${topic}”, let me ask a few questions first:`,
      '',
      '1. Whose problem does this solve? Do we have concrete feedback?',
      '2. Which metric tells us it worked?',
      '',
      'If those are unclear, I would wait before building.',
    ],
    gl: [
      `Looking at “${topic}” through data, I would pull three numbers first:`,
      '',
      '| Metric | Definition | Current |\n| --- | --- | --- |\n| First-screen bounce | 7-day average | To pull |\n| Signup conversion | Homepage → signup | To pull |\n| Mobile share | UV | To pull |',
      '',
      mode === 'parallel' ? 'I have not seen the other replies; this is my independent read.' : 'With these numbers, the plan discussion will have a firmer floor.',
    ],
  }
  return (lines[self.id] ?? [localized(`收到，关于「${topic}」我需要更多信息。`, `Got it. I need more detail about “${topic}”.`)]).join('\n')
}

async function streamInto(groupId: string, m: Message, text: string, signal: AbortSignal) {
  // 先"思考"一会儿，再按不规则的小块吐字，模拟真实流式节奏。
  await sleep(500 + Math.random() * 700)
  let i = 0
  while (i < text.length) {
    if (signal.aborted || running.get(groupId)?.signal !== signal) return
    const n = 1 + Math.floor(Math.random() * 4)
    const delta = text.slice(i, i + n)
    i += n
    m.content += delta
    emit({ kind: 'delta', groupId, messageId: m.id, delta })
    await sleep(18 + Math.random() * 30)
  }
}

function update(groupId: string, m: Message, patch: Partial<Message>, ctrl: AbortController) {
  if (running.get(groupId) !== ctrl) return
  if (isDemo && failedStreams.has(groupId)) return
  Object.assign(m, patch)
  emit({ kind: 'message', groupId, message: { ...m } })
}

async function runTurn(d: GroupDetail, user: Message, mode: ReplyMode, slots: Message[], ctrl: AbortController) {
  const groupId = d.group.id
  const one = async (slot: Message, before: Message[]) => {
    if (running.get(groupId) !== ctrl) return
    if (ctrl.signal.aborted) return update(groupId, slot, { status: 'stopped', finishedAt: iso(new Date()) }, ctrl)
    const self = memberById[slot.authorId]
    update(groupId, slot, { status: 'streaming', contextSeq: before.length ? before[before.length - 1].seq : user.seq }, ctrl)
    // 演示：观澜的服务没配 Key，展示失败态
    if (!isDemo && self.id === 'gl' && d.group.id === 'g1') {
      await sleep(900)
      return update(groupId, slot, { status: 'error', error: '401 Unauthorized：该模型服务的 API Key 无效', finishedAt: iso(new Date()) }, ctrl)
    }
    await streamInto(groupId, slot, draftReply(self, user.content, before, mode), ctrl.signal)
    update(groupId, slot, { status: ctrl.signal.aborted ? 'stopped' : 'done', finishedAt: iso(new Date()) }, ctrl)
  }
  if (mode === 'parallel') {
    await Promise.all(slots.map((s) => one(s, [])))
  } else {
    const done: Message[] = []
    for (const s of slots) {
      await one(s, done)
      if (s.status === 'done') done.push(s)
    }
  }
  if (running.get(groupId) !== ctrl) return
  running.delete(groupId)
  if (isDemo && db[groupId] !== d) return
  d.busy = false
  d.group.updatedAt = iso(new Date())
  emit({ kind: 'turn.end', groupId, turnId: user.turnId })
  emit({ kind: 'group', group: summary(d) })
}

export function createMockBackend(): Backend {
  const attachments=new Map<string,{attachment:Attachment;groupId:string;bound:boolean}>()
  const snapshot = () => JSON.stringify({db, members, historical:memberById, providers, retired:[...retired], memoryConfig, attachments:[...attachments], idSeq})
  const shares=new Map<string,{pages:number;written:Set<number>}>()
  if (isDemo) {
    const saved = readJSON<{db: Record<string, GroupDetail>; members: Member[]; historical: Record<string, Member>; providers: ProviderConfig[]; retired: string[]; memoryConfig: MemoryConfig; attachments: [string, {attachment:Attachment;groupId:string;bound:boolean}][]; idSeq:number}>(DEMO_STATE_KEY)
    if (saved.db && saved.members && saved.providers) {
      for (const id of Object.keys(db)) delete db[id]
      Object.assign(db, recoverDemoGroups(saved.db))
      members.splice(0, members.length, ...saved.members)
      for (const id of Object.keys(memberById)) delete memberById[id]
      Object.assign(memberById, saved.historical ?? Object.fromEntries(members.map(m => [m.id,m])))
      providers.splice(0, providers.length, ...saved.providers.map(p => ({...p, hasKey:false})))
      retired.clear(); saved.retired?.forEach(id => retired.add(id))
      Object.assign(memoryConfig, saved.memoryConfig)
      saved.attachments?.forEach(([id,a]) => attachments.set(id,a))
      idSeq = Math.max(idSeq, saved.idSeq ?? 1000)
      // 历史数据同样不允许带入远程头像。
      for (const member of Object.values(memberById)) {
        try { validateDemoAvatar(member.avatar) } catch { delete member.avatar.image }
      }
      for (const d of Object.values(db)) for (const avatar of Object.values(d.group.memberAvatars)) {
        try { validateDemoAvatar(avatar) } catch { delete avatar.image }
      }
    } else providers.forEach(p => { p.hasKey = false })
    persistDemo = () => {
      const serialized = snapshot()
      if (serialized.length > DEMO_SNAPSHOT_LIMIT) throw new Error(DEMO_STORAGE_ERROR)
      try { localStorage.setItem(DEMO_STATE_KEY, serialized) } catch { throw new Error(DEMO_STORAGE_ERROR) }
    }
    // 初次打开时无需重复写入；写满的浏览器仍可读取和重置演示。
  }
  const api: Backend = {
    async importAttachment(input) {
      if(!db[input.groupId]) throw new Error('群聊不存在')
      if (isDemo && input.base64.length > Math.ceil(DEMO_ATTACHMENT_LIMIT / 3) * 4) throw new Error('演示版每份附件最多 512 KiB；较大文件请使用桌面版。')
      const binary=atob(input.base64)
      const format=validateAttachment({name:input.name,size:binary.length,type:input.mime},0)
      if(format.kind==='document' && format.extract!=='server') validateDocument(input.text,input.pageCount)
      const id=nid('att')
      const text=input.text || (format.extract==='server' ? '演示版不解析 Office 文档正文；桌面版会在本地提取。' : '')
      const a:Attachment={id,name:input.name,mime:format.mime,size:binary.length,kind:format.kind,url:`data:${format.mime};base64,${input.base64}`,text,pageCount:input.pageCount,width:0,height:0}
      attachments.set(id,{attachment:a,groupId:input.groupId,bound:false})
      return structuredClone(a)
    },
    async readAttachment(id) {const a=attachments.get(id);if(!a) throw new Error('附件不存在');return structuredClone(a.attachment)},
    async removeDraftAttachment(id) {const a=attachments.get(id);if(a?.bound) throw new Error('已发送附件不能作为草稿移除');attachments.delete(id)},
    async beginShareExport(input) {
      if (isDemo) throw new Error('浏览器演示版不保存分享图片。请下载桌面版，选择消息后导出 PNG 到本机目录。')
      if(input.pageCount<1||input.pageCount>20) throw new Error('分享图片需要 1–20 页')
      const sessionId=nid('share')
      shares.set(sessionId,{pages:input.pageCount,written:new Set()})
      return {sessionId,cancelled:false}
    },
    async writeShareExportPage(input) {
      const s=shares.get(input.sessionId)
      if(!s) throw new Error('分享任务不存在或已结束，请重新导出')
      if(input.index<1||input.index>s.pages) throw new Error('分享页序号超出范围')
      if(s.written.has(input.index)) throw new Error('该页已经写入')
      if(!input.pngBase64.startsWith('iVBORw0KGgo')) throw new Error('分享页不是有效 PNG')
      s.written.add(input.index)
    },
    async commitShareExport(sessionId) {
      const s=shares.get(sessionId)
      if(!s||s.written.size!==s.pages) throw new Error('分享图片尚未生成完整')
      shares.delete(sessionId)
      return {count:s.pages,folderName:`群聊-${new Date().toISOString().slice(0,10)}-mock`}
    },
    async cancelShareExport(sessionId) {shares.delete(sessionId)},
    async bootstrap(): Promise<Bootstrap> {
      await sleep(120)
      const ua = navigator.userAgent
      const platform = /Mac/.test(ua) ? 'mac' : /Win/.test(ua) ? 'windows' : 'linux'
      const forced = new URLSearchParams(location.search).get('platform') as Bootstrap['platform'] | null
      return {
        platform: forced ?? platform,
        appearance: { ...DEFAULT_APPEARANCE, ...readJSON<Appearance>(demoKey('agc.appearance')) },
        userDisplayName: readJSON<{displayName:string}>(demoKey('agc.profile'))?.displayName || localized('你', 'You'),
        userSeal: { ...demoUserSeal, ...readJSON<UserSeal>(demoKey('agc.seal')), ...readJSON<{seal:UserSeal}>(demoKey('agc.profile'))?.seal },
        members: isDemo ? Object.values(memberById) : members,
        providers: structuredClone(providers),
        groups: Object.values(db).map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        retiredMemberIds: [...retired],
        memory: { ...memoryConfig },
        language,
        version: isDemo ? '0.1.4-demo' : '0.1.0-mock',
      }
    },

    async openGroup(groupId) {
      await sleep(60)
      const d = db[groupId]
      return structuredClone(d)
    },

    async createGroup(input: CreateGroupInput): Promise<Group> {
      const id = nid('g')
      const now = iso(new Date())
      const names = input.memberIds.map((m) => memberById[m]?.name).join('、')
      const group: Group = { id, title: input.title, topic: input.topic, memberIds: input.memberIds, memberAvatars: {}, archived: false, defaultMode: input.defaultMode, memoryCursor: 0, createdAt: now, updatedAt: now }
      db[id] = {
        group, memory: [], busy: false,
        messages: [msg({ id: nid('m'), groupId: id, seq: 1, authorKind: 'system', authorId: '', content: localized(`你创建了群聊，邀请了 ${names}`, `You created the group and invited ${names}`), createdAt: now })],
      }
      emit({ kind: 'group', group: summary(db[id]) })
      return structuredClone(group)
    },

    async updateGroup(input: UpdateGroupInput): Promise<Group> {
      const d = db[input.id]
      if (!d) throw new Error('群不存在')
      const sys = (content: string) => {
        const m = msg({ id: nid('m'), groupId: input.id, seq: d.messages.length + 1, authorKind: 'system', authorId: '', content, createdAt: iso(new Date()) })
        d.messages.push(m)
        emit({ kind: 'message', groupId: input.id, message: { ...m } })
      }
      if (d.group.title !== input.title) sys(localized(`你把群名改为「${input.title}」`, `You renamed the group to “${input.title}”`))
      if (d.group.topic !== input.topic) sys(localized('你改了群主题', 'You changed the group topic'))
      if (d.group.defaultMode !== input.defaultMode) sys(localized(
        `你把默认回复方式改为${input.defaultMode === 'parallel' ? '同时回复' : '依次回复'}`,
        `You changed the default reply mode to ${input.defaultMode === 'parallel' ? 'Parallel' : 'Sequential'}`,
      ))
      const added = input.memberIds.filter((x) => !d.group.memberIds.includes(x))
      const removed = d.group.memberIds.filter((x) => !input.memberIds.includes(x))
      for (const id of added) sys(localized(`你邀请了 ${memberById[id]?.name ?? id}`, `You invited ${memberById[id]?.name ?? id}`))
      for (const id of removed) sys(localized(`你移出了 ${memberById[id]?.name ?? id}`, `You removed ${memberById[id]?.name ?? id}`))
      if (!added.length && !removed.length && d.group.memberIds.join() !== input.memberIds.join()) sys(localized('你调整了发言顺序', 'You changed the speaker order'))
      Object.assign(d.group, { title: input.title, topic: input.topic, defaultMode: input.defaultMode, memberIds: input.memberIds })
      emit({ kind: 'group', group: summary(d) })
      return structuredClone(d.group)
    },

    async archiveGroup(groupId, archived) {
      const d = db[groupId]
      if (!d) throw new Error('群不存在')
      d.group.archived = archived
      emit({ kind: 'group', group: summary(d) })
    },

    async deleteGroup(groupId) {
      for(const [id,a] of attachments) if(a.groupId===groupId) attachments.delete(id)
      delete db[groupId]
      emit({ kind: 'group.remove', groupId })
    },

    async send(groupId, content, mode, attachmentIds=[]): Promise<SendResult> {
      const d = db[groupId]
      failedStreams.delete(groupId)
      if (d.busy) throw new Error('该群有回复正在进行，请稍候或先停止')
      const cands = d.group.memberIds.map((id) => memberById[id])
      const parsed = parseMentions(content, cands)
      const order = planTargets(d.group.memberIds, parsed)
      if(attachmentIds.length>4 || new Set(attachmentIds).size!==attachmentIds.length) throw new Error('每条消息最多 4 份不同附件')
      const pending=attachmentIds.map(id=>attachments.get(id))
      if(pending.some(a=>!a||a.groupId!==groupId||a.bound)) throw new Error('附件不属于本群，或已发送，请重新添加')
      if(!content.trim()&&!pending.length) throw new Error('消息不能为空')
      if(pending.some(a=>a!.attachment.kind==='image')&&order.some(id=>!memberById[id].supportsImages)) throw new Error('被点名成员尚未启用图片输入')
      const m: ReplyMode = mode ?? d.group.defaultMode
      const turnId = nid('t')
      const seq = () => d.messages.length + 1
      const user = msg({ id: nid('m'), groupId, seq: seq(), authorKind: 'user', authorId: USER_ID, content, turnId,
        mentions: parsed.ids, mentionAll: parsed.all, replyMode: m, createdAt: iso(new Date()) })
      user.attachments=pending.map(a=>structuredClone(a!.attachment))
      for(const a of pending) a!.bound=true
      d.messages.push(user)
      emit({ kind: 'message', groupId, message: { ...user } })
      if (order.length === 0) {
        emit({ kind: 'group', group: summary(d) })
        return { userMessage: user, turnId, order }
      }
      d.busy = true
      const slots = order.map((mid) => {
        const s = msg({ id: nid('m'), groupId, seq: seq(), authorKind: 'member', authorId: mid, content: '', turnId,
          replyToId: user.id, model: memberById[mid].model, status: 'pending', replyMode: m, createdAt: iso(new Date()) })
        d.messages.push(s)
        emit({ kind: 'message', groupId, message: { ...s } })
        return s
      })
      emit({ kind: 'turn.start', groupId, turnId, order })
      const ctrl = new AbortController()
      running.set(groupId, ctrl)
      void runTurn(d, user, m, slots, ctrl)
      return { userMessage: { ...user }, turnId, order }
    },

    async stop(groupId) {
      running.get(groupId)?.abort()
    },

    async retry(messageId) {
      for (const d of Object.values(db)) {
        const m = d.messages.find((x) => x.id === messageId)
        if (!m || d.busy) continue
        const user = d.messages.find((x) => x.id === m.replyToId)!
        failedStreams.delete(d.group.id)
        d.busy = true
        const ctrl = new AbortController()
        running.set(d.group.id, ctrl)
        update(d.group.id, m, { content: '', error: '', status: 'pending' }, ctrl)
        emit({ kind: 'turn.start', groupId: d.group.id, turnId: m.turnId, order: [m.authorId] })
        const self = memberById[m.authorId]
        void (async () => {
          update(d.group.id, m, { status: 'streaming' }, ctrl)
          await streamInto(d.group.id, m, draftReply(self, user.content, [], 'serial'), ctrl.signal)
          update(d.group.id, m, { status: ctrl.signal.aborted ? 'stopped' : 'done', finishedAt: iso(new Date()) }, ctrl)
          if (running.get(d.group.id) !== ctrl) return
          running.delete(d.group.id)
          if (isDemo && db[d.group.id] !== d) return
          d.busy = false
          emit({ kind: 'turn.end', groupId: d.group.id, turnId: m.turnId })
        })()
      }
    },

    memory: {
      async confirm(id) {
        return patchMemory(id, { status: 'confirmed', confirmedAt: iso(new Date()) })
      },
      async reject(id) {
        return patchMemory(id, { status: 'rejected', confirmedAt: undefined })
      },
      async reopen(id) {
        return patchMemory(id, { status: 'proposed', confirmedAt: undefined })
      },
      async edit(id, content) {
        return patchMemory(id, { content: content.trim(), origin: 'user' })
      },
      async complete(id) {
        return patchMemory(id, { status: 'done' })
      },
      async uncomplete(id) {
        return patchMemory(id, { status: 'proposed' })
      },
      async summarize(groupId) {
        const d = db[groupId]
        emit({ kind: 'memory', groupId, items: structuredClone(d.memory), cursor: d.group.memoryCursor, summarizing: true })
        await sleep(1400)
        const fresh = d.messages.filter((m) => m.seq > d.group.memoryCursor && m.status === 'done' && m.authorKind === 'member')
        const last = fresh[fresh.length - 1]
        if (last) {
          const ref = Math.max(0, ...d.memory.map((x) => x.ref)) + 1
          const firstLine = last.content.split('\n').find((l) => l.replace(/[#*\-\d.\s|]/g, '').length > 6) ?? last.content
          d.memory.push({
            id: nid('k'), groupId, ref, kind: 'plan', content: firstLine.replace(/[*`#>]/g, '').replace(/^\s*[-\d.]+\s*/, '').slice(0, 60),
            status: 'proposed', origin: 'member', proposedBy: last.authorId, sources: [{ messageId: last.id, seq: last.seq, role: 'proposed' }],
            supersededBy: '', createdAt: iso(new Date()), updatedAt: iso(new Date()),
          })
        }
        d.group.memoryCursor = d.messages[d.messages.length - 1].seq
        emit({ kind: 'memory', groupId, items: structuredClone(d.memory), cursor: d.group.memoryCursor, summarizing: false })
      },
    },

    async setAppearance(a) {
      localStorage.setItem(demoKey('agc.appearance'), JSON.stringify(a))
    },

    async setLanguage(next) {
      if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(next)) throw new Error('界面语言无效')
      language = next
      localStorage.setItem(demoKey('agc.language'), JSON.stringify(next))
    },

    async setUserProfile(profile) {
      const errors = validateUserProfile(profile)
      if (errors.displayName || errors.seal) throw new Error(errors.displayName || errors.seal)
      localStorage.setItem(demoKey('agc.profile'), JSON.stringify({...profile, displayName:profile.displayName.trim()}))
    },

    async setUserSeal(seal) {
      const errors = validateUserProfile({displayName:'你',seal})
      if(errors.seal) throw new Error(errors.seal)
      const profile=readJSON<{displayName:string}>(demoKey('agc.profile'))
      localStorage.setItem(demoKey('agc.profile'), JSON.stringify({displayName:profile?.displayName || localized('你', 'You'),seal}))
    },

    async uploadAvatar(file) {
      // mock：转成 data URL。真实实现由 Go 保存到应用数据目录并返回资源地址（TASK-013）
      if (file.size > 8 * 1024 * 1024) throw new Error('图片不能超过 8MB')
      return await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => reject(new Error('读取图片失败'))
        r.readAsDataURL(file)
      })
    },

    async setGroupAvatar(groupId, memberId, avatar: Avatar | null) {
      if (isDemo) validateDemoAvatar(avatar)
      const d = db[groupId]
      if (avatar) d.group.memberAvatars[memberId] = avatar
      else delete d.group.memberAvatars[memberId]
      const s = summary(d)
      emit({ kind: 'group', group: s })
      return structuredClone(s)
    },

    async setMemberAvatar(memberId, avatar) {
      if (isDemo) validateDemoAvatar(avatar)
      const m = memberById[memberId]
      m.avatar = avatar
      return structuredClone(m)
    },

    async saveMember(input) {
      if (isDemo) validateDemoAvatar(input.avatar)
      const id = input.id || nid('mem')
      const next: Member = {
        id, name: input.name, avatar: input.avatar, brief: input.brief, rolePrompt: input.rolePrompt,
        supportsImages: input.supportsImages ?? false, providerId: input.providerId, model: input.model, temperature: input.temperature, contextTokens: input.contextTokens,
      }
      const existing = members.find((m) => m.id === id)
      if (existing) Object.assign(existing, next)
      else { members.push(next); retired.delete(id) }
      memberById[id] = existing ?? next
      return structuredClone(memberById[id])
    },

    async deleteMember(memberId) {
      const i = members.findIndex((m) => m.id === memberId)
      if (i >= 0) members.splice(i, 1)
      retired.add(memberId)
      for (const d of Object.values(db)) {
        d.group.memberIds = d.group.memberIds.filter((x) => x !== memberId)
        delete d.group.memberAvatars[memberId]
      }
    },

    async saveProvider(input: SaveProviderInput) {
      const id = input.id || nid('p')
      const next: ProviderConfig = { id, name: input.name, kind: input.kind, baseUrl: input.baseUrl, hasKey: !isDemo && (!!input.key || providers.find((p) => p.id === id)?.hasKey || false) }
      const existing = providers.find((p) => p.id === id)
      if (existing) Object.assign(existing, next)
      else providers.push(next)
      return structuredClone(next)
    },

    async deleteProvider(providerId) {
      const used = members.filter((m) => m.providerId === providerId).map((m) => m.name)
      if (used.length) throw new Error(`还有成员在用这个服务：${used.join('、')}。请先改掉他们的模型服务。`)
      const i = providers.findIndex((p) => p.id === providerId)
      if (i >= 0) providers.splice(i, 1)
      if (memoryConfig.providerId === providerId) {
        memoryConfig.providerId = ''
        memoryConfig.model = ''
      }
    },

    async testProvider() {
      if (isDemo) throw new Error('演示版不会连接模型服务，也不接收 API Key。请在桌面版测试真实连接。')
      await sleep(160)
      return 160
    },

    async setMemoryConfig(config) {
      memoryConfig.providerId = config.providerId
      memoryConfig.model = config.model
    },

    async dataDir() {
      return isDemo ? '当前浏览器的本地存储' : '/tmp/ai-group-chat'
    },

    async openDataDir() {
      if (isDemo) throw new Error('演示数据保存在浏览器中；打开数据目录请使用桌面版。')
      console.info('[mock] openDataDir')
    },

    window: {
      minimise: () => console.info('[mock] window.minimise'),
      toggleMaximise: () => console.info('[mock] window.toggleMaximise'),
      close: () => console.info('[mock] window.close'),
    },

    subscribe(h) {
      handlers.add(h)
      return () => handlers.delete(h)
    },
  }
  if (!isDemo) return api
  // 所有成功的写入（包括不发事件的成员、服务和纪要操作）都保存快照。
  const persistent = <T extends object>(object: T): T => new Proxy(object, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver)
      if (typeof value !== 'function') return value
      if (['subscribe','bootstrap','openGroup','readAttachment','dataDir'].includes(String(key))) return value
      return async (...args: unknown[]) => {
        const before = snapshot()
        const groupReferences = { ...db }
        demoStorageFailed = false
        try {
          const result = await value.apply(target, args)
          if (demoStorageFailed) throw new Error(DEMO_STORAGE_ERROR)
          persistDemo()
          return result
        } catch (error) {
          // localStorage.setItem 是原子的；内存同样回滚，失败附件不能毒化下一次操作。
          const saved = JSON.parse(before)
          // 轮次持有 GroupDetail 和消息占位对象；回滚必须保留这些对象的身份。
          for (const id of Object.keys(saved.db)) if (!db[id] && groupReferences[id]) db[id] = groupReferences[id]
          restoreInPlace(db, saved.db)
          for (const groupId of failedStreams) {
            const detail = db[groupId]
            if (!detail?.busy) continue
            detail.busy = false
            for (const message of detail.messages) if (message.status === 'pending' || message.status === 'streaming') {
              message.status = 'error'; message.error = DEMO_STORAGE_ERROR
            }
          }
          restoreInPlace(members, saved.members)
          restoreInPlace(memberById, saved.historical)
          restoreInPlace(providers, saved.providers)
          retired.clear(); saved.retired.forEach((id:string) => retired.add(id))
          Object.assign(memoryConfig,saved.memoryConfig)
          attachments.clear(); saved.attachments.forEach(([id,a]: [string,{attachment:Attachment;groupId:string;bound:boolean}]) => attachments.set(id,a))
          idSeq=saved.idSeq
          throw error
        }
      }
    },
  })
  api.memory = persistent(api.memory)
  return persistent(api)
}


/** 按实体 id 恢复数组内容，让运行中的流仍然写入同一条消息。 */
function restoreInPlace(target: unknown, saved: unknown): unknown {
  if (Array.isArray(target) && Array.isArray(saved)) {
    const previous = target.slice()
    const next = saved.map((value, index) => {
      const id = value && typeof value === 'object' ? (value as {id?:unknown}).id : undefined
      const existing = id === undefined ? previous[index] : previous.find(item => item && typeof item === 'object' && (item as {id?:unknown}).id === id)
      return restoreInPlace(existing, value)
    })
    target.splice(0, target.length, ...next)
    return target
  }
  if (target && saved && typeof target === 'object' && typeof saved === 'object' && !Array.isArray(target) && !Array.isArray(saved)) {
    const current = target as Record<string,unknown>
    const original = saved as Record<string,unknown>
    for (const key of Object.keys(current)) if (!(key in original)) delete current[key]
    for (const [key,value] of Object.entries(original)) current[key] = restoreInPlace(current[key],value)
    return target
  }
  return structuredClone(saved)
}

function readJSON<T>(key: string): Partial<T> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<T>
  } catch {
    return {}
  }
}

function patchMemory(id: string, patch: Partial<MemoryItem>): MemoryItem {
  for (const d of Object.values(db)) {
    const it = d.memory.find((x) => x.id === id)
    if (it) {
      Object.assign(it, patch, { updatedAt: iso(new Date()) })
      return structuredClone(it)
    }
  }
  throw new Error('记忆条目不存在')
}
