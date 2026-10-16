import { useEffect, useRef } from 'react'
import type { GroupSummary, Member } from '../../backend'
import { Button } from '../../components/Button'
import { Seal } from '../../components/Seal'
import { avatarOf } from '../../lib/avatar'
import styles from './MemberCard.module.css'

/** 点群头部的成员印章弹出的小名片：点名，或者改他在本群的样子。 */
export function MemberCard({
  member,
  group,
  onMention,
  onEditAvatar,
  onClose,
}: {
  member: Member
  group: GroupSummary
  onMention(): void
  onEditAvatar(): void
  onClose(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const custom = !!group.memberAvatars[member.id]

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // 推迟一帧挂载，避免打开它的那次点击立刻把它关掉
    const t = setTimeout(() => document.addEventListener('mousedown', onDown))
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div ref={ref} className={`${styles.card} no-drag`} role="dialog" aria-label={member.name}>
      <div className={styles.top}>
        <Seal avatar={avatarOf(member, group)} size="xl" />
        <div className={styles.text}>
          <span className={styles.name} style={{ color: `var(--pigment-${avatarOf(member, group)!.color})` }}>
            {member.name}
          </span>
          <span className={styles.brief}>{member.brief || '没有简介'}</span>
          <span className={styles.model}>{member.model}</span>
        </div>
      </div>
      {custom && <p className={styles.note}>在本群用了单独的头像</p>}
      <div className={styles.actions}>
        <Button variant="ghost" size="sm" onClick={onMention}>
          @ 点名
        </Button>
        <Button variant="quiet" size="sm" icon="edit" onClick={onEditAvatar}>
          本群头像
        </Button>
      </div>
    </div>
  )
}
