import { useCallback, useRef, useState } from 'react'
import type { Member } from '../../backend'
import { Button } from '../../components/Button'
import { Seal } from '../../components/Seal'
import { avatarOf } from '../../lib/avatar'
import { AvatarEditor } from '../members/AvatarEditor'
import { MemberCard } from './MemberCard'
import { GroupSettingsDialog } from './GroupSettingsDialog'
import { useChat, type GroupState } from '../../state/store'
import { shareEligible } from '../../lib/share/snapshot'
import { ShareExportDialog } from '../share/ShareExportDialog'
import { Composer, type ComposerHandle } from './Composer'
import { MessageList } from './MessageList'
import styles from './ChatView.module.css'

export function ChatView({ state, members }: { state: GroupState; members: Record<string, Member> }) {
  const composer = useRef<ComposerHandle>(null)
  const memoryOpen = useChat((s) => s.memoryOpen)
  const toggleMemory = useChat((s) => s.toggleMemory)
  const { group, memory } = state
  const pendingCount = memory.filter((m) => m.status === 'proposed').length
  const [cardFor, setCardFor] = useState<string | null>(null)
  const [editFor, setEditFor] = useState<string | null>(null)
  const [managing, setManaging] = useState(false)
  const [sharing, setSharing] = useState(false)
  const canShare = state.messages.some(shareEligible)
  const closeCard = useCallback(() => setCardFor(null), [])

  return (
    <section className={styles.chat} aria-label={group.title}>
      <header className={`${styles.head} drag`} data-edge={memoryOpen ? undefined : 'right'}>
        <div className={styles.titles}>
          <h1 className={styles.title}>{group.title}</h1>
          {group.topic && <p className={styles.topic}>{group.topic}</p>}
        </div>
        <div className={styles.roster}>
          {group.memberIds.map((id) => {
            const m = members[id]
            if (!m) return null
            return (
              <span key={id} className={styles.rosterSlot}>
                <button
                  className={styles.rosterItem}
                  title={`${m.name} · ${m.brief}`}
                  aria-expanded={cardFor === id}
                  onClick={() => setCardFor((c) => (c === id ? null : id))}
                >
                  <Seal avatar={avatarOf(m, group)} size="sm" />
                </button>
                {cardFor === id && (
                  <MemberCard
                    member={m}
                    group={group}
                    onClose={closeCard}
                    onMention={() => {
                      setCardFor(null)
                      composer.current?.insertMention(m.name)
                    }}
                    onEditAvatar={() => {
                      setCardFor(null)
                      setEditFor(id)
                    }}
                  />
                )}
              </span>
            )
          })}
          <Button variant="quiet" size="sm" icon="members" aria-label="群管理" title="群管理" onClick={() => setManaging(true)} />
        </div>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => setSharing(true)}
          disabled={!canShare}
          title={canShare ? '把选中的群聊保存为图片' : '还没有可分享的消息'}
        >
          分享图片
        </Button>
        {!memoryOpen && (
          <Button variant="quiet" size="sm" icon="panel" onClick={() => toggleMemory(true)} title="展开纪要">
            纪要{pendingCount > 0 && <span className={styles.badge}>{pendingCount}</span>}
          </Button>
        )}
      </header>
      <MessageList state={state} members={members} onInsertMention={(n) => composer.current?.insertMention(n)} />
      <Composer ref={composer} state={state} members={members} />
      {editFor && members[editFor] && (
        <AvatarEditor open member={members[editFor]} scope={{ kind: 'group', group }} onClose={() => setEditFor(null)} />
      )}
      <GroupSettingsDialog open={managing} onClose={() => setManaging(false)} group={group} />
      <ShareExportDialog open={sharing} onClose={() => setSharing(false)} state={state} members={members} />
    </section>
  )
}
