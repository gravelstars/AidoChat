import { useEffect, useState, type FormEvent } from 'react'
import type { ReplyMode } from '../../backend'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { Field, TextArea, TextInput } from '../../components/Field'
import { Seal } from '../../components/Seal'
import { Segmented } from '../../components/Segmented'
import { useChat } from '../../state/store'
import styles from './CreateGroupDialog.module.css'

/**
 * 新建群聊。这也是"表单对话框"的标准样板：
 *   Dialog + Field 组合；底部"取消（ghost）/ 主动作（primary）"；
 *   校验在提交时做，错误写在对应 Field 下方；提交中禁用主按钮。
 * 成员编辑器（TASK-007）等表单请照这个结构写。
 */
export function CreateGroupDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const members = useChat((s) => s.members)
  const createGroup = useChat((s) => s.createGroup)
  const [title, setTitle] = useState('')
  const [topic, setTopic] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [mode, setMode] = useState<ReplyMode>('serial')
  const [errors, setErrors] = useState<{ title?: string; members?: string }>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
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
    if (!title.trim()) errs.title = '给群起个名字'
    if (picked.length === 0) errs.members = '至少邀请一位成员'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSubmitting(true)
    try {
      await createGroup({ title: title.trim(), topic: topic.trim(), memberIds: picked, defaultMode: mode })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="新建群聊"
      description="一个群就是一个独立的话题，记录和纪要只属于这个群。"
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={submitting}>
            创建
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label="群名" error={errors.title}>
          {(id) => <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：首页改版评审" autoFocus maxLength={40} />}
        </Field>
        <Field label="主题" hint="会告诉每位成员这个群在讨论什么，可以不填。">
          {(id) => <TextArea id={id} value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} placeholder="例如：官网首页从三栏改为单列，评估设计与实现影响" maxLength={200} />}
        </Field>
        <Field label="邀请成员" error={errors.members} hint="点选的先后就是 @所有人 时的回复顺序。" aside={<span className={styles.count}>{picked.length} 位</span>}>
          {() => (
            <div className={styles.grid} role="group">
              {Object.values(members).map((m) => {
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
          )}
        </Field>
        <Field label="同时 @ 多位成员时" hint="发送时还可以临时切换。">
          {() => (
            <Segmented
              label="默认回复方式"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'serial', label: '依次回复' },
                { value: 'parallel', label: '同时回复' },
              ]}
            />
          )}
        </Field>
      </form>
    </Dialog>
  )
}
