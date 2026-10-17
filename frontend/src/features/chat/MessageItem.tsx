import { Children, isValidElement, memo, useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Group, Member, Message } from '../../backend'
import { Seal, UserSeal } from '../../components/Seal'
import { avatarOf } from '../../lib/avatar'
import { Icon } from '../../components/Icon'
import { clock, linkifyRefs } from '../../lib/format'
import { parseMentions } from '../../lib/mention'
import { useChat } from '../../state/store'
import { AttachmentList } from './AttachmentList'
import { CodeBlock } from './CodeBlock'
import styles from './MessageItem.module.css'

interface Props {
  message: Message
  members: Record<string, Member>
  group: Group
  /** 本轮排在它前面、尚未完成的成员名（串行排队提示） */
  waitingFor?: string
  replyToSeq?: number
  first: boolean // 是否为本轮第一条（决定是否画轮次连线的起点）
  last: boolean
  /** 打开群之后新出现的消息才播放入场动画 */
  fresh: boolean
}

export const MessageItem = memo(function MessageItem({ message: m, members, group, waitingFor, replyToSeq, first, last, fresh }: Props) {
  const hover = useChat((s) => s.hoverSeq === m.seq)
  const jumpTo = useChat((s) => s.jumpTo)
  const userSeal = useChat((s) => s.userSeal)
  const userDisplayName = useChat((s) => s.userDisplayName)

  if (m.authorKind === 'system') {
    return (
      <div className={styles.system} id={`msg-${m.seq}`} data-seq={m.seq}>
        <span>{m.content}</span>
      </div>
    )
  }

  const isUser = m.authorKind === 'user'
  const member = members[m.authorId]
  const name = isUser ? userDisplayName : member?.name ?? '已退群成员'
  const live = m.status === 'pending' || m.status === 'streaming'

  return (
    <article
      id={`msg-${m.seq}`}
      data-seq={m.seq}
      className={[styles.item, isUser ? styles.user : styles.member, hover && styles.hover, fresh && styles.fresh, first && styles.first, last && styles.last].filter(Boolean).join(' ')}
      style={member ? ({ '--seal': `var(--pigment-${member.avatar.color})` } as CSSProperties) : undefined}
      aria-busy={live}
    >
      <div className={styles.gutter}>
        {isUser ? (
          <UserSeal seal={userSeal} size="md" title={userDisplayName} />
        ) : (
          <Seal avatar={avatarOf(member, group)} size="md" muted={m.status === 'pending'} active={m.status === 'streaming' && !m.content} title={name} />
        )}
      </div>
      <div className={styles.main}>
        <header className={styles.head}>
          <span className={styles.name} title={name}>{name}</span>
          {!isUser && replyToSeq ? (
            <button className={styles.replyTo} onClick={() => jumpTo(replyToSeq)} title="跳到被回复的消息">
              <Icon name="reply" size={12} />
              回复 #{replyToSeq}
            </button>
          ) : null}
          <span className={styles.time}>{clock(m.createdAt)}</span>
          <span className={styles.spacer} />
          {m.content && <CopyFull text={m.content} />}
          {!isUser && m.model && (
            <span className={styles.provenance} title={`生成时看到了 #${m.contextSeq} 及之前的消息`}>
              {m.model}
              {m.contextSeq ? ` · 读至 #${m.contextSeq}` : ''}
            </span>
          )}
          <span className={styles.seq}>#{m.seq}</span>
        </header>
        <Body m={m} members={members} groupMemberIds={group.memberIds} waitingFor={waitingFor} />
      </div>
    </article>
  )
})

function Body({ m, members, groupMemberIds, waitingFor }: { m: Message; members: Record<string, Member>; groupMemberIds: string[]; waitingFor?: string }) {
  const retry = useChat((s) => s.retry)
  const busy = useChat((s) => (s.activeId ? s.detail[s.activeId]?.busy : false))

  if (m.authorKind === 'user') return <>{m.content && <UserText text={m.content} members={members} groupMemberIds={groupMemberIds} />}{!!m.attachments?.length && <AttachmentList attachments={m.attachments} />}</>

  if (m.status === 'pending') {
    return <p className={styles.waiting}>{waitingFor ? `排队中，等 ${waitingFor} 说完` : '准备中'}</p>
  }
  if (m.status === 'streaming' && !m.content) {
    return (
      <p className={styles.thinking} aria-label="正在思考">
        正在读群记录
        <span className={styles.dots}>
          <i />
          <i />
          <i />
        </span>
      </p>
    )
  }
  return (
    <>
      {m.content && <AiText content={m.content} streaming={m.status === 'streaming'} />}
      {m.status === 'stopped' && (
        <div className={styles.note}>
          <span>已中断</span>
          <button className={styles.inlineAction} disabled={busy} onClick={() => retry(m.id)}>
            <Icon name="retry" size={13} />
            重新生成
          </button>
        </div>
      )}
      {m.status === 'error' && (
        <div className={styles.error} role="alert">
          <span className={styles.errorText}>{m.error || '调用失败'}</span>
          <button className={styles.inlineAction} disabled={busy} onClick={() => retry(m.id)}>
            <Icon name="retry" size={13} />
            重试
          </button>
        </div>
      )}
    </>
  )
}

function UserText({ text, members, groupMemberIds }: { text: string; members: Record<string, Member>; groupMemberIds: string[] }) {
  const parts = useMemo(() => {
    const cands = groupMemberIds.map((id) => members[id]).filter(Boolean)
    const { spans } = parseMentions(text, cands)
    const out: { text: string; mention: boolean }[] = []
    let at = 0
    for (const s of spans) {
      if (s.start > at) out.push({ text: text.slice(at, s.start), mention: false })
      out.push({ text: text.slice(s.start, s.end), mention: true })
      at = s.end
    }
    if (at < text.length) out.push({ text: text.slice(at), mention: false })
    return out
  }, [text, members, groupMemberIds])
  return (
    <p className={`${styles.userText} selectable`}>
      {parts.map((p, i) => (p.mention ? <span key={i} className={styles.mention}>{p.text}</span> : p.text))}
    </p>
  )
}

const AiText = memo(function AiText({ content, streaming }: { content: string; streaming: boolean }) {
  const jumpTo = useChat((s) => s.jumpTo)
  const md = useMemo(() => linkifyRefs(content), [content])
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    const href = a?.getAttribute('href') ?? ''
    if (href.startsWith('#msg-')) {
      e.preventDefault()
      jumpTo(Number(href.slice(5)))
    } else if (href.startsWith('#mem-')) {
      e.preventDefault()
      document.querySelector(`[data-mem-ref="${href.slice(5)}"]`)?.dispatchEvent(new CustomEvent('reveal', { bubbles: true }))
    } else if (a && !e.defaultPrevented) {
      // 外部链接交给系统浏览器（Wails 侧拦截，TASK-002）
      e.preventDefault()
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  }
  return (
    <div className={`prose selectable ${styles.ai} ${streaming ? styles.streaming : ''}`} onClick={onClick}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => {
            // 块级语义来自 pre，而非语言标记；无语言围栏和缩进代码也需要保留排版。
            const child = Children.toArray(children)[0]
            if (!isValidElement<{ className?: string; children?: unknown }>(child)) return <pre>{children}</pre>
            const lang = /language-([\w+#-]+)/.exec(child.props.className || '')?.[1] ?? ''
            return <CodeBlock code={String(child.props.children ?? '').replace(/\n$/, '')} lang={lang} streaming={streaming} />
          },
          a: ({ href, children }) => (
            <a href={href} className={href?.startsWith('#msg-') || href?.startsWith('#mem-') ? styles.ref : undefined}>
              {children}
            </a>
          ),
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  )
})

/** 消息悬停时在名字行右侧出现的"复制全文"。 */
function CopyFull({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <button
      className={styles.copyFull}
      data-copied={copied}
      aria-label="复制全文"
      title="复制全文"
      onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {})}
    >
      <Icon name={copied ? 'check' : 'panel'} size={13} />
      {copied ? '已复制' : ''}
    </button>
  )
}
