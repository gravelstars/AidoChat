import { isDemo } from '../../demo/storage'
import { useEffect, useState } from 'react'
import type { Avatar, Member, Pigment } from '../../backend'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { Field, Select, TextArea, TextInput } from '../../components/Field'
import { Seal } from '../../components/Seal'
import { PIGMENTS } from '../../lib/avatar'
import { getLanguage, translateError } from '../../i18n'
import { useT } from '../../i18n/react'
import { useChat } from '../../state/store'
import { AvatarEditor } from './AvatarEditor'
import { ProviderDialog } from '../settings/ProviderDialog'
import styles from './MemberEditor.module.css'

const firstRune = (s: string) => Array.from(s.trim())[0] ?? (getLanguage() === 'en' ? 'N' : '新')

/**
 * 成员的新建与编辑（TASK-007）。表单结构照 CreateGroupDialog；
 * 头像编辑直接复用 AvatarEditor（编辑已有成员时可打开）。
 */
export function MemberEditor({ open, onClose, member, onSaved }: { open: boolean; onClose(): void; member?: Member; onSaved?(member: Member): void }) {
  const members = useChat((s) => s.members)
  const retiredIds = useChat((s) => s.retiredIds)
  const providers = useChat((s) => s.providers)
  const saveMember = useChat((s) => s.saveMember)
  const deleteMember = useChat((s) => s.deleteMember)

  const isNew = !member
  const [name, setName] = useState('')
  const [color, setColor] = useState<Pigment>('shiqing')
  const [brief, setBrief] = useState('')
  const [rolePrompt, setRolePrompt] = useState('')
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [supportsImages, setSupportsImages] = useState(false)
  const [contextTokens, setContextTokens] = useState(16000)
  const [temperature, setTemperature] = useState('')
  const [errors, setErrors] = useState<{ name?: string; provider?: string; model?: string; form?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [providerOpen, setProviderOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<typeof providers[number] | undefined>()
  const t = useT()

  useEffect(() => {
    if (!open) return
    setErrors({})
    setConfirmDelete(false)
    setAvatarOpen(false)
    setProviderOpen(false)
    if (member) {
      setName(member.name)
      setColor(member.avatar.color)
      setBrief(member.brief)
      setRolePrompt(member.rolePrompt)
      setProviderId(member.providerId)
      setModel(member.model)
      setSupportsImages(member.supportsImages ?? false)
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
      setSupportsImages(false)
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
    if (!name.trim()) errs.name = t('给成员起个名字')
    else if (name.trim().length > 12) errs.name = t('名字不能超过 12 个字')
    else if (/\s|@/.test(name.trim())) errs.name = t('名字里不能有空格或 @')
    const conflict = Object.values(members).some((m) => m.id !== member?.id && !retiredIds.includes(m.id) && m.name === name.trim())
    if (conflict) errs.name = t('已经有叫这个名字的成员了')
    if (!provider) errs.provider = providers.length ? t('先选择一个模型服务') : t('先新建模型服务，再选择模型')
    if (!model.trim()) errs.model = t('填写这个服务实际可用的模型名')
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSubmitting(true)
    try {
      const temp = temperature.trim() === '' ? undefined : Number(temperature)
      const saved = await saveMember({
        id: member?.id ?? '',
        name: name.trim(),
        avatar: currentMember?.avatar ?? { glyph: firstRune(name), color },
        brief: brief.trim(),
        rolePrompt,
        providerId,
        model: model.trim(),
        supportsImages,
        temperature: temp != null && Number.isFinite(temp) ? temp : undefined,
        contextTokens: contextTokens || 16000,
      })
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setErrors({ form: translateError(e) })
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
        title={isNew ? t('新建成员') : t('编辑「{name}」', { name: member.name })}
        description={t('每位成员都是你请进群的一位 AI。他没有个人记忆，进入哪个群，就只知道哪个群的事。')}
        width={560}
        footer={
          <>
            {member && (
              <Button variant="quiet" className={confirmDelete ? styles.danger : undefined} onClick={() => void remove()} disabled={submitting}>
                {confirmDelete ? t('再点一次确认删除') : t('删除成员')}
              </Button>
            )}
            <span style={{ flex: 1 }} />
            <Button variant="ghost" onClick={onClose}>
              {t('取消')}
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={submitting}>
              {isNew ? t('创建') : t('保存')}
            </Button>
          </>
        }
      >
        <div className={styles.head}>
          <div className={styles.headText}>
            <Field label={t('名字')} error={errors.name} hint={t('1–12 个字，不能有空格或 @，全局唯一。')}>
              {(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('例如：青砚、阿墨、小满')} autoFocus maxLength={12} />}
            </Field>
          </div>
          <button
            type="button"
            className={styles.sealButton}
            aria-disabled={isNew || undefined}
            title={isNew ? t('保存后可以设置头像') : t('设置默认头像')}
            onClick={() => !isNew && setAvatarOpen(true)}
          >
            <Seal avatar={draftAvatar} size="xl" />
          </button>
        </div>
        {isNew && <p className={styles.sealHint}>{t('印面取名字首字，颜料自动分配；保存后可以换图片头像。')}</p>}

        <Field label={t('一句话认识他')} hint={isDemo ? t('保存成员简介；演示版回复固定，不会读取简介。') : t('让其他人快速记住他：一个特点、一句口头禅，或者他擅长的事。')} aside={<span className={styles.sealHint}>{brief.length}/30</span>}>
          {(id) => <TextInput id={id} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t('例如：总在半夜冒出怪点子')} maxLength={30} />}
        </Field>

        <Field label={t('角色设定')} hint={isDemo ? t('可编辑并保存在浏览器中；演示版不会执行角色设定。') : t('只影响他和你的对话。写性格、说话方式、在意的事，或者一句你喜欢的话都行。')}>
          {(id) => <TextArea id={id} value={rolePrompt} onChange={(e) => setRolePrompt(e.target.value)} rows={4} placeholder={t('例如：你是一位温和但爱较真的朋友，喜欢先问清楚再给建议，偶尔讲个冷笑话。')} maxLength={4000} />}
        </Field>

        <div className={styles.row}>
          <Field label={t('模型服务')} error={errors.provider} hint={isDemo ? t('仅保存演示配置，不会连接服务。') : providers.length ? undefined : t('还没有模型服务。先填写服务地址，再为成员选择模型。')}>
            {(id) => (
              <>
                <Select id={id} value={providerId} disabled={!providers.length} onChange={(e) => setProviderId(e.target.value)}>
                  <option value="">{t('选择服务')}</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                {/* 服务操作跟在选择框下方，与右侧模型字段的说明文字同一条基线。 */}
                <div className={styles.providerActions}>
                  <Button variant="quiet" size="sm" onClick={() => { setEditingProvider(undefined); setProviderOpen(true) }}>{t('新建模型服务')}</Button>
                  {provider && <Button variant="quiet" size="sm" onClick={() => { setEditingProvider(provider); setProviderOpen(true) }}>{t('编辑当前服务')}</Button>}
                </div>
              </>
            )}
          </Field>
          <Field label={t('模型')} error={errors.model} hint={isDemo ? t('填写演示模型名即可，回复始终为预设内容。') : t('可自由填写模型名，不限于示例；请以服务商后台实际可用的模型名为准。')}>
            {(id) => (
              <TextInput id={id} value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
            )}
          </Field>
        </div>
        {!isDemo && provider && !provider.hasKey && (
          <p className={styles.noteRow}>
            {provider.kind === 'anthropic' ? t('此服务尚未保存 API Key，请编辑服务补充。') : t('此服务未保存 Key。免 Key 的本地服务可直接使用；云端服务请编辑服务补充。')}
          </p>
        )}

        <Field label={t('图片输入')} hint={isDemo ? t('用于体验图片输入开关；演示版不会识别图片内容。') : t('仅在服务商确认该模型支持视觉输入时开启。勾选不会赋予纯文本模型看图能力；关闭时，点名此成员发送图片会提示更换模型。')}>
          {(id) => <label className={styles.imageCapability} htmlFor={id}><input id={id} type="checkbox" checked={supportsImages} onChange={(e) => setSupportsImages(e.target.checked)} /> {t('该模型支持图片输入')}</label>}
        </Field>
        <div className={styles.fieldRow}>
          <Field label={t('上下文预算')} hint={t('该模型可用的 token 上限。')}>
            {(id) => <TextInput id={id} type="number" min={1000} step={1000} value={contextTokens} onChange={(e) => setContextTokens(Number(e.target.value))} />}
          </Field>
          <Field label={t('温度')} hint={t('留空表示用默认。')}>
            {(id) => <TextInput id={id} type="number" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder={t('默认')} />}
          </Field>
        </div>
        {errors.form && <p className={styles.warnRow} role="alert">{errors.form}</p>}
      </Dialog>

      <ProviderDialog open={open && providerOpen} provider={editingProvider} suggestedModel={editingProvider ? model : undefined} onClose={() => setProviderOpen(false)} onSaved={(saved, testedModel) => {
        setProviderId(saved.id)
        if (!model.trim() && testedModel) setModel(testedModel)
        setErrors((e) => ({ ...e, provider: undefined }))
      }} />
      {currentMember && <AvatarEditor open={avatarOpen} onClose={() => setAvatarOpen(false)} member={currentMember} scope={{ kind: 'default' }} />}
    </>
  )
}
