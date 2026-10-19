import { useEffect, useState } from 'react'
import type { Group, ReplyMode } from '../../backend'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { Field, TextArea, TextInput } from '../../components/Field'
import { Seal } from '../../components/Seal'
import { Segmented } from '../../components/Segmented'
import { avatarOf } from '../../lib/avatar'
import { translateError } from '../../i18n'
import { useT } from '../../i18n/react'
import { useChat } from '../../state/store'
import styles from './GroupSettingsDialog.module.css'

/**
 * 群设置（TASK-009）：改名、主题、默认回复方式、成员增删与顺序。
 * 每次变更都会在群里留一条系统消息。
 */
export function GroupSettingsDialog({ open, onClose, group }: { open: boolean; onClose(): void; group: Group }) {
  const members = useChat((s) => s.members)
  const retiredIds = useChat((s) => s.retiredIds)
  const busy = useChat((s) => s.detail[group.id]?.busy ?? false)
  const updateGroup = useChat((s) => s.updateGroup)

  const [title, setTitle] = useState(group.title)
  const [topic, setTopic] = useState(group.topic)
  const [mode, setMode] = useState<ReplyMode>(group.defaultMode)
  const [ids, setIds] = useState<string[]>(group.memberIds)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const t = useT()

  useEffect(() => {
    if (!open) return
    setTitle(group.title)
    setTopic(group.topic)
    setMode(group.defaultMode)
    setIds(group.memberIds)
    setError('')
  }, [open, group])

  const move = (i: number, delta: number) => {
    const j = i + delta
    if (j < 0 || j >= ids.length) return
    const next = ids.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    setIds(next)
  }

  const available = Object.values(members).filter((m) => !retiredIds.includes(m.id) && !ids.includes(m.id))

  const submit = async () => {
    if (!title.trim()) {
      setError(t('群名不能为空'))
      return
    }
    if (ids.length === 0) {
      setError(t('群里至少要有一位成员'))
      return
    }
    setSubmitting(true)
    try {
      await updateGroup({ id: group.id, title: title.trim(), topic: topic.trim(), defaultMode: mode, memberIds: ids })
      onClose()
    } catch (e) {
      setError(translateError(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('群设置')}
      description={t('改动会在群里留下一条系统通知，成员也会看到。')}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={submitting || busy}>
            {t('保存')}
          </Button>
        </>
      }
    >
      {busy && <p className={styles.note}>{t('有成员正在回复，暂时不能调整成员；可以先停止本轮。')}</p>}
      <Field label={t('群名')}>
        {(id) => <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} />}
      </Field>
      <Field label={t('主题')} hint={t('会写进每位成员的 system prompt。')}>
        {(id) => <TextArea id={id} value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} maxLength={200} />}
      </Field>
      <Field label={t('默认回复方式')} hint={t('发送时仍可临时切换。')}>
        {() => (
          <Segmented
            label={t('默认回复方式')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'serial', label: t('依次回复') },
              { value: 'parallel', label: t('同时回复') },
            ]}
          />
        )}
      </Field>
      <Field label={t('成员')} error={error} hint={t('顺序就是 @所有人 时的回复顺序。')}>
        {() => (
          <>
            <div className={styles.roster}>
              {ids.map((mid, i) => {
                const m = members[mid]
                if (!m) return null
                return (
                  <div key={mid} className={styles.member}>
                    <span className={styles.order}>{i + 1}</span>
                    <Seal avatar={avatarOf(m, group)} size="sm" />
                    <span className={styles.memberName}>{m.name}</span>
                    <span className={styles.move}>
                      <Button variant="quiet" size="sm" aria-label={t('上移')} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                        ↑
                      </Button>
                      <Button variant="quiet" size="sm" aria-label={t('下移')} disabled={busy || i === ids.length - 1} onClick={() => move(i, 1)}>
                        ↓
                      </Button>
                    </span>
                    <Button variant="quiet" size="sm" disabled={busy} onClick={() => setIds(ids.filter((x) => x !== mid))}>
                      {t('移出')}
                    </Button>
                  </div>
                )
              })}
            </div>
            {available.length > 0 && (
              <div className={styles.addRow}>
                {available.map((m) => (
                  <Button key={m.id} variant="quiet" size="sm" icon="plus" disabled={busy} onClick={() => setIds([...ids, m.id])}>
                    {m.name}
                  </Button>
                ))}
              </div>
            )}
          </>
        )}
      </Field>
    </Dialog>
  )
}
