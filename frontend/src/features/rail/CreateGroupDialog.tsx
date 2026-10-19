import { useEffect, useState, type FormEvent } from 'react'
import type { ReplyMode } from '../../backend'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { Field, TextArea, TextInput } from '../../components/Field'
import { Seal } from '../../components/Seal'
import { Segmented } from '../../components/Segmented'
import { translateError } from '../../i18n'
import { useT } from '../../i18n/react'
import { useChat } from '../../state/store'
import { MemberEditor } from '../members/MemberEditor'
import styles from './CreateGroupDialog.module.css'

/**
 * 新建群聊。这也是"表单对话框"的标准样板：
 *   Dialog + Field 组合；底部"取消（ghost）/ 主动作（primary）"；
 *   校验在提交时做，错误写在对应 Field 下方；提交中禁用主按钮。
 * 成员编辑器（TASK-007）等表单请照这个结构写。
 */
export function CreateGroupDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const members = useChat((s) => s.members)
  const retiredIds = useChat((s) => s.retiredIds)
  const available = Object.values(members).filter((m) => !retiredIds.includes(m.id))
  const [memberOpen, setMemberOpen] = useState(false)
  const createGroup = useChat((s) => s.createGroup)
  const [title, setTitle] = useState('')
  const [topic, setTopic] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [mode, setMode] = useState<ReplyMode>('serial')
  const [errors, setErrors] = useState<{ title?: string; members?: string; form?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const t = useT()

  useEffect(() => {
    if (open) {
      setMemberOpen(false)
      setTitle('')
      setTopic('')
      setPicked([])
      setMode('serial')
      setErrors({})
    }
  }, [open])

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const errs: typeof errors = {}
    if (!title.trim()) errs.title = t('给群起个名字')
    if (picked.length === 0) errs.members = t('至少邀请一位成员')
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSubmitting(true)
    try {
      await createGroup({ title: title.trim(), topic: topic.trim(), memberIds: picked, defaultMode: mode })
      onClose()
    } catch (e) {
      setErrors({ form: translateError(e) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
    <Dialog
      open={open}
      onClose={onClose}
      title={t('新建群聊')}
      description={t('每个群都是新的一张桌子：聊过的话、定下的事，都只留在这里。')}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={submitting}>
            {t('创建')}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label={t('群名')} error={errors.title}>
          {(id) => <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('例如：随便聊聊、不赶时间、想到什么说什么')} autoFocus maxLength={40} />}
        </Field>
        <Field label={t('主题')} hint={t('给成员一点背景；也可以留空，边聊边定。')}>
          {(id) => <TextArea id={id} value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} placeholder={t('比如：最近在想什么，或者什么都不想，也行。')} maxLength={200} />}
        </Field>
        <Field label={t('邀请成员')} error={errors.members} hint={t('点选的先后就是 @所有人 时的回复顺序。')} aside={<span className={styles.count}>{t('{n} 位', { n: picked.length })}</span>}>
          {() => (
            <>
            {available.length === 0 && <p className={styles.note}>{t('还没有可邀请的成员。先新建成员并配置模型服务，再邀请进群。')}</p>}
            <Button variant="quiet" size="sm" onClick={() => setMemberOpen(true)}>{t('新建成员')}</Button>
            <div className={styles.grid} role="group">
              {available.map((m) => {
                const order = picked.indexOf(m.id)
                return (
                  <button key={m.id} type="button" className={styles.card} aria-pressed={order >= 0} onClick={() => toggle(m.id)}>
                    <Seal avatar={m.avatar} size="md" />
                    <span className={styles.cardText}>
                      <span className={styles.cardName}>{m.name}</span>
                      <span className={styles.cardBrief}>{m.brief}</span>
                    </span>
                    <span className={styles.order}>{order >= 0 ? order + 1 : ''}</span>
                  </button>
                )
              })}
            </div>
            </>
          )}
        </Field>
        <Field label={t('同时 @ 多位成员时')} hint={t('发送时还可以临时切换。')}>
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
        {errors.form && <p className={styles.error} role="alert">{errors.form}</p>}
      </form>
    </Dialog>
    <MemberEditor open={open && memberOpen} onClose={() => setMemberOpen(false)} onSaved={(m) => setPicked((ids) => [...ids, m.id])} />
    </>
  )
}
