import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Member, Message } from '../../backend'
import { Icon } from '../../components/Icon'
import { Seal } from '../../components/Seal'
import { avatarOf } from '../../lib/avatar'
import { dayLabel } from '../../lib/format'
import { useChat, type GroupState } from '../../state/store'
import { MessageItem } from './MessageItem'
import styles from './MessageList.module.css'

interface Props {
  state: GroupState
  members: Record<string, Member>
  onInsertMention(name: string): void
}

/** 距底部多少像素以内视为"在底部"，新内容会自动跟随 */
const STICK_THRESHOLD = 80

export function MessageList({ state, members, onInsertMention }: Props) {
  const { group, messages } = state
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const jump = useChat((s) => s.jump)
  // 打开群时已存在的最大 Seq；之后出现的才播放入场动画
  const baseline = useRef<{ id: string; seq: number }>({ id: '', seq: 0 })
  if (baseline.current.id !== group.id) {
    baseline.current = { id: group.id, seq: messages.at(-1)?.seq ?? 0 }
  }

  const bySeqId = useMemo(() => new Map(messages.map((m) => [m.id, m.seq])), [messages])

  // 轮次分组信息：首尾标记、串行排队提示
  const meta = useMemo(() => {
    const out = new Map<string, { first: boolean; last: boolean; waitingFor?: string }>()
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      const prev = messages[i - 1]
      const next = messages[i + 1]
      const sameTurn = (a?: Message) => !!a && !!m.turnId && a.turnId === m.turnId && a.authorKind !== 'system'
      let waitingFor: string | undefined
      if (m.status === 'pending') {
        const ahead = messages.slice(0, i).reverse().find((x) => x.turnId === m.turnId && (x.status === 'streaming' || x.status === 'pending'))
        if (ahead && ahead.authorKind === 'member') waitingFor = members[ahead.authorId]?.name
      }
      out.set(m.id, { first: !sameTurn(prev), last: !sameTurn(next), waitingFor })
    }
    return out
  }, [messages, members])

  const onScroll = () => {
    const el = scroller.current!
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
    stick.current = atBottom
    setShowJump(!atBottom)
  }

  // 新内容到来时：在底部就跟随，否则只显示"回到最新"
  const lastLen = messages.at(-1)?.content.length ?? 0
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages.length, lastLen])

  // 切换群时直接到底
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
    stick.current = true
    setShowJump(false)
  }, [group.id])

  // 跳转到指定消息
  useEffect(() => {
    if (!jump) return
    const el = scroller.current?.querySelector<HTMLElement>(`[data-seq="${jump.seq}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.removeAttribute('data-flash')
    void el.offsetWidth // 重启动画
    el.setAttribute('data-flash', '')
    const t = setTimeout(() => el.removeAttribute('data-flash'), 1700)
    return () => clearTimeout(t)
  }, [jump])

  const toBottom = () => {
    const el = scroller.current!
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  const onlySystem = messages.every((m) => m.authorKind === 'system')

  return (
    <div className={styles.wrap}>
      <div ref={scroller} className={styles.scroller} onScroll={onScroll}>
        <div className={styles.column}>
          {messages.map((m, i) => {
            const prev = messages[i - 1]
            const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt)
            const info = meta.get(m.id)!
            return (
              <Fragment key={m.id}>
                {newDay && <div className={styles.day}>{dayLabel(m.createdAt)}</div>}
                <MessageItem
                  message={m}
                  members={members}
                  group={group}
                  replyToSeq={m.replyToId ? bySeqId.get(m.replyToId) : undefined}
                  first={info.first}
                  last={info.last}
                  waitingFor={info.waitingFor}
                  fresh={m.seq > baseline.current.seq}
                />
              </Fragment>
            )
          })}
          {onlySystem && <EmptyHint group={group} members={members} onPick={onInsertMention} />}
        </div>
      </div>
      <button className={`${styles.jump} ${showJump ? styles.jumpShow : ''}`} onClick={toBottom} tabIndex={showJump ? 0 : -1}>
        <Icon name="arrowDown" size={14} />
        回到最新
      </button>
    </div>
  )
}

function EmptyHint({ group, members, onPick }: { group: GroupState['group']; members: Record<string, Member>; onPick(name: string): void }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>这张纸还是空的</p>
      <p className={styles.emptyText}>用 @ 点名让成员回答。没有 @ 的消息只会记在群里，不会触发回复。</p>
      <div className={styles.emptyChips}>
        {group.memberIds.map((id) => {
          const m = members[id]
          if (!m) return null
          return (
            <button key={id} className={styles.chip} onClick={() => onPick(m.name)}>
              <Seal avatar={avatarOf(m, group)} size="xs" />@{m.name}
              <span className={styles.chipBrief}>{m.brief}</span>
            </button>
          )
        })}
        <button className={styles.chip} onClick={() => onPick('所有人')}>
          @所有人
        </button>
      </div>
    </div>
  )
}
