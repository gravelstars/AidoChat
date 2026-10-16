import appIcon from '../../assets/aidochat.svg'
import { useEffect, useState } from 'react'
import type { GroupSummary } from '../../backend'
import { Button } from '../../components/Button'
import { Icon, type IconName } from '../../components/Icon'
import { Seal } from '../../components/Seal'
import { avatarOf } from '../../lib/avatar'
import { relativeDay } from '../../lib/format'
import { useChat } from '../../state/store'
import { CreateGroupDialog } from './CreateGroupDialog'
import styles from './Rail.module.css'

export function Rail() {
  const groups = useChat((s) => s.groups)
  const activeId = useChat((s) => s.activeId)
  const view = useChat((s) => s.view)
  const members = useChat((s) => s.members)
  const detail = useChat((s) => s.detail)
  const open = useChat((s) => s.open)
  const setView = useChat((s) => s.setView)
  const night = useChat((s) => s.night)
  const toggleNight = useChat((s) => s.toggleNight)
  const archiveGroup = useChat((s) => s.archiveGroup)
  const deleteGroup = useChat((s) => s.deleteGroup)
  const [creating, setCreating] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)

  const active = groups.filter((g) => !g.archived)
  const archived = groups.filter((g) => g.archived)

  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(null), 3000)
    return () => clearTimeout(t)
  }, [confirmDelete])

  const row = (g: GroupSummary, isArchived: boolean) => {
    const isActive = view === 'chat' && g.id === activeId
    const busy = detail[g.id]?.busy
    const last = g.lastMessage
    const who = last ? (last.authorKind === 'user' ? '你' : last.authorKind === 'system' ? '' : members[last.authorId]?.name) : ''
    const confirming = confirmDelete === g.id
    return (
      <li key={g.id} className={styles.item}>
        <button className={styles.group} aria-current={isActive ? 'page' : undefined} onClick={() => void open(g.id)}>
          <span className={styles.seals}>
            {g.memberIds.slice(0, 3).map((id) => (
              <Seal key={id} avatar={avatarOf(members[id], g)} size="xs" />
            ))}
          </span>
          <span className={styles.groupText}>
            <span className={styles.groupRow}>
              <span className={styles.groupTitle}>{g.title}</span>
              <span className={styles.groupTime}>{busy ? <span className={styles.live} aria-label="回复中" /> : relativeDay(g.updatedAt)}</span>
            </span>
            <span className={styles.preview}>{last ? `${who ? who + '：' : ''}${last.preview}` : '还没有消息'}</span>
          </span>
        </button>
        <Button
          variant="quiet"
          size="sm"
          className={styles.menuBtn}
          aria-label={`管理「${g.title}」`}
          aria-expanded={menuFor === g.id}
          onClick={() => setMenuFor((c) => (c === g.id ? null : g.id))}
        >
          ⋯
        </Button>
        {menuFor === g.id && (
          <>
            <span className={styles.scrim} onClick={() => setMenuFor(null)} aria-hidden="true" />
            <div className={styles.menu} role="menu">
              <button
                className={styles.menuItem}
                role="menuitem"
                onClick={() => {
                  setMenuFor(null)
                  void archiveGroup(g.id, !isArchived).catch(() => {})
                }}
              >
                {isArchived ? '取消归档' : '归档'}
              </button>
              <button
                className={`${styles.menuItem} ${confirming ? styles.danger : ''}`}
                role="menuitem"
                onClick={() => {
                  if (!confirming) {
                    setConfirmDelete(g.id)
                    return
                  }
                  setMenuFor(null)
                  setConfirmDelete(null)
                  void deleteGroup(g.id).catch(() => {})
                }}
              >
                {confirming ? '再点一次确认删除' : '删除群聊'}
              </button>
            </div>
          </>
        )}
      </li>
    )
  }

  return (
    <nav className={styles.rail} aria-label="群聊列表">
      <div className={`${styles.top} drag`}>
        <img className={styles.mark} src={appIcon} alt="" aria-hidden="true" />
        <span className={styles.wordmark}>AidoChat</span>
      </div>

      <div className={styles.sectionHead}>
        <span>群聊</span>
        <Button variant="quiet" size="sm" icon="plus" aria-label="新建群聊" title="新建群聊" onClick={() => setCreating(true)} />
      </div>

      <ul className={styles.list}>
        {active.map((g) => row(g, false))}
      </ul>

      {archived.length > 0 && (
        <div className={styles.archive}>
          <button className={styles.archiveHead} aria-expanded={archivedOpen} onClick={() => setArchivedOpen((o) => !o)}>
            <Icon name="arrowDown" size={14} style={{ transform: archivedOpen ? undefined : 'rotate(-90deg)' }} />
            已归档 {archived.length}
          </button>
          {archivedOpen && <ul className={styles.list}>{archived.map((g) => row(g, true))}</ul>}
        </div>
      )}

      <div className={styles.bottom}>
        <NavItem icon="members" label="成员" active={view === 'members'} onClick={() => setView('members')} />
        <NavItem icon="settings" label="设置" active={view === 'settings'} onClick={() => setView('settings')} />
        <span className={styles.spacer} />
        <Button
          variant="quiet"
          size="sm"
          icon={night ? 'sun' : 'moon'}
          aria-label="切换昼夜"
          title={night ? '切换到白昼' : '切换到夜间'}
          onClick={toggleNight}
        />
      </div>

      <CreateGroupDialog open={creating} onClose={() => setCreating(false)} />
    </nav>
  )
}

function NavItem({ icon, label, active, onClick }: { icon: IconName; label: string; active: boolean; onClick(): void }) {
  return (
    <button className={styles.nav} aria-current={active ? 'page' : undefined} onClick={onClick}>
      <Icon name={icon} size={16} />
      {label}
    </button>
  )
}
