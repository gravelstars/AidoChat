import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Group, MemoryItem, MemoryKind, Member, UserSeal as UserSealData } from '../../backend'
import { USER_ID } from '../../backend'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { Seal, UserSeal } from '../../components/Seal'
import { avatarOf, isCustomSeal } from '../../lib/avatar'
import { Segmented } from '../../components/Segmented'
import { clock } from '../../lib/format'
import { useChat, type GroupState } from '../../state/store'
import { TodoCheck } from './TodoCheck'
import styles from './MemoryPanel.module.css'

/**
 * 纪要面板：群记忆的可视化。核心视觉语言——
 *   AI 建议 = 铅笔批注（虚线、灰墨）
 *   你提出 = 墨笔（实线），但尚未盖章
 *   已确认 = 朱印「定」
 * 这一套区分是产品的灵魂，见 docs/DESIGN.md §4。
 */

const SECTIONS: { kind: MemoryKind; title: string; empty: string }[] = [
  { kind: 'decision', title: '决定', empty: '还没有拍板的事' },
  { kind: 'todo', title: '待办', empty: '没有待办' },
  { kind: 'plan', title: '方案', empty: '还没有提出方案' },
  { kind: 'background', title: '背景', empty: '没有记录背景信息' },
]

type Filter = 'all' | 'pending' | 'confirmed'

export function MemoryPanel({ state, members }: { state: GroupState; members: Record<string, Member> }) {
  const { memory, summarizing, group } = state
  const toggle = useChat((s) => s.toggleMemory)
  const summarize = useChat((s) => s.summarize)
  const [filter, setFilter] = useState<Filter>('all')
  const [showArchive, setShowArchive] = useState(false)
  // 刚勾选的待办先在原位停留 0.6 秒（看到勾与删除线）再收进「已完成与已否决」。
  const [held, setHeld] = useState<string[]>([])
  const hold = (id: string) => {
    setHeld((h) => [...h, id])
    setTimeout(() => setHeld((h) => h.filter((x) => x !== id)), 600)
  }

  const isLive = (m: MemoryItem) => m.status === 'proposed' || m.status === 'confirmed' || held.includes(m.id)
  const live = memory.filter(isLive)
  const archived = memory.filter((m) => !isLive(m) && (m.status === 'rejected' || m.status === 'done'))
  const pending = live.filter((m) => m.status === 'proposed').length
  const visible = live.filter((m) => filter === 'all' || (filter === 'pending' ? m.status === 'proposed' : m.status === 'confirmed'))

  return (
    <aside className={styles.panel} aria-label="群纪要">
      <header className={`${styles.head} drag`}>
        <div className={styles.headTitle}>
          <h2 className={styles.title}>纪要</h2>
          <span className={styles.cursor}>{summarizing ? <Pencil /> : group.memoryCursor ? `整理至 #${group.memoryCursor}` : '尚未整理'}</span>
        </div>
        <span className={styles.tools}>
          <Button variant="quiet" size="sm" icon="sparkle" onClick={() => void summarize()} disabled={summarizing} title="把新的讨论整理进纪要">
            整理
          </Button>
          <Button variant="quiet" size="sm" icon="panel" onClick={() => toggle(false)} aria-label="收起纪要" title="收起纪要" />
        </span>
      </header>

      <div className={styles.filters}>
        <Segmented
          size="sm"
          label="筛选"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `全部 ${live.length}` },
            { value: 'pending', label: `待确认 ${pending}` },
            { value: 'confirmed', label: `已确认 ${live.length - pending}` },
          ]}
        />
      </div>

      <div className={styles.scroll}>
        {SECTIONS.map((sec) => {
          const items = visible.filter((m) => m.kind === sec.kind)
          if (filter !== 'all' && items.length === 0) return null
          return (
            <section key={sec.kind} className={styles.section}>
              <h3 className={styles.sectionTitle}>
                {sec.title}
                <span className={styles.count}>{items.length || ''}</span>
              </h3>
              {items.length === 0 ? (
                <p className={styles.empty}>{sec.empty}</p>
              ) : (
                items.map((it) => <Row key={it.id} item={it} members={members} group={group} onComplete={hold} />)
              )}
            </section>
          )
        })}
        {visible.length === 0 && filter !== 'all' && <p className={styles.empty}>{filter === 'pending' ? '都处理完了' : '还没有盖过章'}</p>}

        {archived.length > 0 && (
          <section className={styles.archive}>
            <button className={styles.archiveToggle} onClick={() => setShowArchive((v) => !v)} aria-expanded={showArchive}>
              已完成与已否决 · {archived.length}
              <Icon name="arrowDown" size={12} style={{ transform: showArchive ? 'rotate(180deg)' : undefined }} />
            </button>
            {showArchive && archived.map((it) => <Row key={it.id} item={it} members={members} group={group} />)}
          </section>
        )}
      </div>

      <footer className={styles.foot}>纪要由整理模型生成，整理时相关讨论会发送给该模型服务。只有你盖章的条目才算定论。</footer>
    </aside>
  )
}

function Pencil() {
  return (
    <span className={styles.pencil}>
      整理中<i />
      <i />
      <i />
    </span>
  )
}

function Row({ item, members, group, onComplete }: { item: MemoryItem; members: Record<string, Member>; group: Group; onComplete?(id: string): void }) {
  const confirm = useChat((s) => s.confirmMemory)
  const reject = useChat((s) => s.rejectMemory)
  const reopen = useChat((s) => s.reopenMemory)
  const edit = useChat((s) => s.editMemory)
  const stamped = useChat((s) => s.justStamped === item.id)
  const setHover = useChat((s) => s.setHoverSeq)
  const jumpTo = useChat((s) => s.jumpTo)
  const userSeal = useChat((s) => s.userSeal)
  const displayName = useChat((s) => s.userDisplayName)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.content)
  const [revealed, setRevealed] = useState(false)
  const ref = useRef<HTMLElement>(null)

  // 正文里点击 "M3" 时定位到这里
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onReveal = () => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setRevealed(true)
      setTimeout(() => setRevealed(false), 1600)
    }
    el.addEventListener('reveal', onReveal)
    return () => el.removeEventListener('reveal', onReveal)
  }, [])

  const proposer = item.proposedBy === USER_ID ? null : members[item.proposedBy]
  const tone = item.status === 'confirmed' ? 'confirmed' : item.status === 'proposed' ? (item.origin === 'user' ? 'user' : 'ai') : item.status
  const sources = useMemo(() => [...new Set(item.sources.map((s) => s.seq))].sort((a, b) => a - b), [item.sources])

  const save = () => {
    const c = draft.trim()
    if (c && c !== item.content) void edit(item.id, c)
    setEditing(false)
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      save()
    }
    if (e.key === 'Escape') {
      setDraft(item.content)
      setEditing(false)
    }
  }

  return (
    <article ref={ref} className={styles.item} data-tone={tone} data-kind={item.kind} data-mem-ref={item.ref} data-revealed={revealed || undefined}>
      <div className={styles.itemMain}>
        <div className={styles.line}>
          {item.kind === 'todo' && <TodoCheck item={item} onComplete={onComplete} />}
          {editing ? (
            <textarea
              className={styles.editor}
              value={draft}
              autoFocus
              rows={2}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onBlur={save}
            />
          ) : (
            <p className={`${styles.content} selectable`} onDoubleClick={() => item.status === 'proposed' && setEditing(true)}>
              <span className={styles.ref}>M{item.ref}</span>
              {item.content}
            </p>
          )}
        </div>
        <div className={styles.meta}>
          <span className={styles.who}>
            {proposer ? <Seal avatar={avatarOf(proposer, group)} size="xs" /> : <UserSeal seal={userSeal} size="xs" title={displayName} />}
            {tone === 'ai' ? `${proposer?.name ?? '成员'} 建议` : tone === 'user' ? '你提出 · 待盖章' : `${proposer?.name ?? '你'}提出`}
          </span>
          {sources.map((seq) => (
            <button key={seq} className={styles.source} onMouseEnter={() => setHover(seq)} onMouseLeave={() => setHover(null)} onClick={() => jumpTo(seq)} title="定位到原话">
              #{seq}
            </button>
          ))}
          {item.confirmedAt && <span className={styles.when}>你确认于 {clock(item.confirmedAt)}</span>}
        </div>
      </div>

      {item.status === 'confirmed' && <Stamp animate={stamped} seal={isCustomSeal(userSeal) ? userSeal : null} />}

      <div className={styles.actions}>
        {item.status === 'proposed' && !editing && (
          <>
            <button className={styles.stampBtn} onClick={() => void confirm(item.id)} title="盖章确认：这条成为定论">
              盖章
            </button>
            <Button variant="quiet" size="sm" icon="edit" onClick={() => setEditing(true)} aria-label="改写" title="改写（双击内容也可以）" />
            <Button variant="quiet" size="sm" icon="close" onClick={() => void reject(item.id)} aria-label="否决" title="否决：AI 之后不会再提" />
          </>
        )}
        {(item.status === 'confirmed' || item.status === 'rejected') && (
          <Button variant="quiet" size="sm" icon="retry" onClick={() => void reopen(item.id)} title={item.status === 'confirmed' ? '撤销确认' : '恢复为待确认'} aria-label="撤销" />
        )}
      </div>
    </article>
  )
}

/** 确认印。用户刻了私印就盖私印，否则盖朱文「定」。从空中落下、压实，墨晕散开。 */
function Stamp({ animate, seal }: { animate: boolean; seal: UserSealData | null }) {
  const cls = [styles.stamp, seal && styles.stampSeal, animate && styles.stampAnimate].filter(Boolean).join(' ')
  return (
    <span className={cls} aria-label="已确认">
      {animate && <span className={styles.bleed} />}
      {seal ? <UserSeal seal={seal} px={32} title="已确认" /> : <span className={styles.stampGlyph}>定</span>}
    </span>
  )
}
