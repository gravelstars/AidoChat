import { useEffect, useState } from 'react'
import type { Avatar, Member, Pigment } from '../../backend'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { Field, Select, TextArea, TextInput } from '../../components/Field'
import { Seal } from '../../components/Seal'
import { PIGMENTS } from '../../lib/avatar'
import { useChat } from '../../state/store'
import { AvatarEditor } from './AvatarEditor'
import styles from './MemberEditor.module.css'

const COMMON_MODELS = ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001', 'deepseek-chat', 'deepseek-flash', 'qwen-max', 'kimi-k2', 'glm-4.6']
const firstRune = (s: string) => Array.from(s.trim())[0] ?? '新'

/**
 * 成员的新建与编辑（TASK-007）。表单结构照 CreateGroupDialog；
 * 头像编辑直接复用 AvatarEditor（编辑已有成员时可打开）。
 */
export function MemberEditor({ open, onClose, member }: { open: boolean; onClose(): void; member?: Member }) {
  const members = useChat((s) => s.members)
  const retiredIds = useChat((s) => s.retiredIds)
  const providers = useChat((s) => s.providers)
  const saveMember = useChat((s) => s.saveMember)
  const deleteMember = useChat((s) => s.deleteMember)
  const setView = useChat((s) => s.setView)

  const isNew = !member
  const [name, setName] = useState('')
  const [color, setColor] = useState<Pigment>('shiqing')
  const [brief, setBrief] = useState('')
  const [rolePrompt, setRolePrompt] = useState('')
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [contextTokens, setContextTokens] = useState(16000)
  const [temperature, setTemperature] = useState('')
  const [errors, setErrors] = useState<{ name?: string; provider?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})
    setConfirmDelete(false)
    setAvatarOpen(false)
    if (member) {
      setName(member.name)
      setColor(member.avatar.color)
      setBrief(member.brief)
      setRolePrompt(member.rolePrompt)
      setProviderId(member.providerId)
      setModel(member.model)
      setContextTokens(member.contextTokens)
      setTemperature(member.temperature != null ? String(member.temperature) : '')
    } else {
      const used = new Set(Object.values(members).filter((m) => !retiredIds.includes(m.id)).map((m) => m.avatar.color))
      setName('')
      setColor(PIGMENTS.find((p) => !used.has(p.id))?.id ?? PIGMENTS[0].id)
      setBrief('')
      setRolePrompt('')
      setProviderId(providers[0]?.id ?? '')
      setModel('')
      setContextTokens(16000)
      setTemperature('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, member])

  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(false), 3000)
    return () => clearTimeout(t)
  }, [confirmDelete])

  const provider = providers.find((p) => p.id === providerId)
  // 头像由独立对话框即时保存；外层表单仍可能持有打开时的成员快照。
  const currentMember = member ? members[member.id] ?? member : undefined
  const draftAvatar: Avatar = currentMember?.avatar ?? { glyph: firstRune(name), color }

  const submit = async () => {
    const errs: typeof errors = {}
    if (!name.trim()) errs.name = '给成员起个名字'
    else if (name.trim().length > 12) errs.name = '名字不能超过 12 个字'
    else if (/\s|@/.test(name.trim())) errs.name = '名字里不能有空格或 @'
    const conflict = Object.values(members).some((m) => m.id !== member?.id && !retiredIds.includes(m.id) && m.name === name.trim())
    if (conflict) errs.name = '已经有叫这个名字的成员了'
    if (!providerId) errs.provider = '先选择一个模型服务'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSubmitting(true)
    try {
      const temp = temperature.trim() === '' ? undefined : Number(temperature)
      await saveMember({
        id: member?.id ?? '',
        name: name.trim(),
        avatar: currentMember?.avatar ?? { glyph: firstRune(name), color },
        brief: brief.trim(),
        rolePrompt,
        providerId,
        model: model.trim(),
        temperature: temp != null && Number.isFinite(temp) ? temp : undefined,
        contextTokens: contextTokens || 16000,
      })
      onClose()
    } catch (e) {
      setErrors({ name: e instanceof Error ? e.message : String(e) })
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async () => {
    if (!member) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setSubmitting(true)
    try {
      await deleteMember(member.id)
      onClose()
    } catch (e) {
      setErrors({ name: e instanceof Error ? e.message : String(e) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={isNew ? '新建成员' : `编辑「${member.name}」`}
        description="成员是一个配置好的 AI。他没有个人记忆，进入哪个群，就只知道哪个群的事。"
        width={560}
        footer={
          <>
            {member && (
              <Button variant="quiet" className={confirmDelete ? styles.danger : undefined} onClick={() => void remove()} disabled={submitting}>
                {confirmDelete ? '再点一次确认删除' : '删除成员'}
              </Button>
            )}
            <span style={{ flex: 1 }} />
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={submitting}>
              {isNew ? '创建' : '保存'}
            </Button>
          </>
        }
      >
        <div className={styles.head}>
          <div className={styles.headText}>
            <Field label="名字" error={errors.name} hint="1–12 个字，不能有空格或 @，全局唯一。">
              {(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：青砚" autoFocus maxLength={12} />}
            </Field>
          </div>
          <button
            type="button"
            className={styles.sealButton}
            aria-disabled={isNew || undefined}
            title={isNew ? '保存后可以设置头像' : '设置默认头像'}
            onClick={() => !isNew && setAvatarOpen(true)}
          >
            <Seal avatar={draftAvatar} size="xl" />
          </button>
        </div>
        {isNew && <p className={styles.sealHint}>印面取名字首字，颜料自动分配；保存后可以换图片头像。</p>}

        <Field label="一句话简介" hint="会告诉群里其他成员这人是干什么的。" aside={<span className={styles.sealHint}>{brief.length}/30</span>}>
          {(id) => <TextInput id={id} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="例如：代码审查，挑实现上的坑" maxLength={30} />}
        </Field>

        <Field label="角色提示词" hint="只在与他对话时生效，写清楚他的专长与偏好。">
          {(id) => <TextArea id={id} value={rolePrompt} onChange={(e) => setRolePrompt(e.target.value)} rows={4} placeholder="例如：你是严格的代码审查者，优先指出实现上的风险与边界情况。" maxLength={4000} />}
        </Field>

        <div className={styles.row}>
          <Field label="模型服务" error={errors.provider}>
            {(id) => (
              <Select id={id} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                <option value="">选择服务</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="模型" hint="填服务商提供的模型名。">
            {(id) => (
              <>
                <TextInput id={id} value={model} onChange={(e) => setModel(e.target.value)} list="agc-common-models" placeholder="例如：deepseek-chat" />
                <datalist id="agc-common-models">
                  {COMMON_MODELS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
        </div>
        {provider && !provider.hasKey && (
          <p className={styles.warnRow}>
            这个服务还没有保存 API Key。{' '}
            <button className={styles.link} onClick={() => { onClose(); setView('settings') }}>
              去设置
            </button>
          </p>
        )}

        <div className={styles.fieldRow}>
          <Field label="上下文预算" hint="该模型可用的 token 上限。">
            {(id) => <TextInput id={id} type="number" min={1000} step={1000} value={contextTokens} onChange={(e) => setContextTokens(Number(e.target.value))} />}
          </Field>
          <Field label="温度" hint="留空表示用默认。">
            {(id) => <TextInput id={id} type="number" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="默认" />}
          </Field>
        </div>
      </Dialog>

      {currentMember && <AvatarEditor open={avatarOpen} onClose={() => setAvatarOpen(false)} member={currentMember} scope={{ kind: 'default' }} />}
    </>
  )
}
