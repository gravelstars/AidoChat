import { useEffect, useRef, useState, type DragEvent } from 'react'
import { backend, type Avatar, type GroupSummary, type Member, type Pigment } from '../../backend'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { Field, TextInput } from '../../components/Field'
import { Seal } from '../../components/Seal'
import { Segmented } from '../../components/Segmented'
import { PIGMENTS, avatarOf } from '../../lib/avatar'
import { useChat } from '../../state/store'
import styles from './AvatarEditor.module.css'

/**
 * 头像编辑。两种作用范围：
 *   group   —— 只改这个成员在某个群里的样子（群内覆盖），可以"恢复默认"
 *   default —— 改成员的默认头像（TASK-007 成员编辑器复用）
 * 图片原样保存，动图保留动画、始终播放。
 */
type Scope = { kind: 'group'; group: GroupSummary } | { kind: 'default' }

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'

export function AvatarEditor({ open, onClose, member, scope }: { open: boolean; onClose(): void; member: Member; scope: Scope }) {
  const setGroupAvatar = useChat((s) => s.setGroupAvatar)
  const setMemberAvatar = useChat((s) => s.setMemberAvatar)
  const current = scope.kind === 'group' ? avatarOf(member, scope.group)! : member.avatar
  const overridden = scope.kind === 'group' && !!scope.group.memberAvatars[member.id]

  const [mode, setMode] = useState<'seal' | 'image'>(current.image ? 'image' : 'seal')
  const [glyph, setGlyph] = useState(current.glyph)
  const [color, setColor] = useState<Pigment>(current.color)
  const [image, setImage] = useState(current.image ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setMode(current.image ? 'image' : 'seal')
    setGlyph(current.glyph)
    setColor(current.color)
    setImage(current.image ?? '')
    setError('')
  }, [open])

  const draft: Avatar = { glyph: Array.from(glyph.trim())[0] ?? Array.from(member.name)[0], color, image: mode === 'image' && image ? image : undefined }

  const upload = async (file: File | undefined) => {
    if (!file) return
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('只支持 PNG、JPG、GIF、WebP')
      return
    }
    setError('')
    setBusy(true)
    try {
      setImage(await backend.uploadAvatar(file))
      setMode('image')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void upload(e.dataTransfer.files[0])
  }

  const save = async () => {
    if (mode === 'image' && !image) {
      setError('先选一张图片')
      return
    }
    setBusy(true)
    try {
      if (scope.kind === 'group') await setGroupAvatar(scope.group.id, member.id, draft)
      else await setMemberAvatar(member.id, draft)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (scope.kind !== 'group') return
    setBusy(true)
    try {
      await setGroupAvatar(scope.group.id, member.id, null)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={scope.kind === 'group' ? `${member.name}在本群的样子` : `${member.name}的默认头像`}
      description={scope.kind === 'group' ? `只影响「${scope.group.title}」，在其他群里仍是默认头像。` : '没有单独设置过的群都会使用这个头像。'}
      width={500}
      footer={
        <>
          {overridden && (
            <Button variant="quiet" className={styles.reset} onClick={() => void reset()} disabled={busy}>
              恢复默认
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            保存
          </Button>
        </>
      }
    >
      <div className={styles.preview}>
        <Seal avatar={draft} size="xl" />
        <div className={styles.sizes}>
          <Seal avatar={draft} size="md" />
          <Seal avatar={draft} size="sm" />
          <Seal avatar={draft} size="xs" />
          <span className={styles.sizesNote}>消息 · 菜单 · 列表</span>
        </div>
      </div>

      <div className={styles.modeRow}>
        <Segmented
          label="头像类型"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'seal', label: '印章' },
            { value: 'image', label: '图片' },
          ]}
        />
      </div>

      {mode === 'seal' ? (
        <>
          <Field label="印面" hint="一个字，默认取名字的第一个字。">
            {(id) => <TextInput id={id} value={glyph} onChange={(e) => setGlyph(e.target.value)} maxLength={2} className={styles.glyphInput} />}
          </Field>
          <Field label="颜料">
            {() => (
              <div className={styles.pigments} role="radiogroup" aria-label="颜料">
                {PIGMENTS.map((p) => (
                  <button key={p.id} role="radio" aria-checked={color === p.id} className={styles.pigment} onClick={() => setColor(p.id)} title={p.name}>
                    <Seal avatar={{ glyph: draft.glyph, color: p.id }} size="md" />
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>
            )}
          </Field>
        </>
      ) : (
        <Field label="图片" error={error} hint="支持 PNG、JPG、GIF、WebP，动图会一直播放。图片会裁成方形显示。">
          {() => (
            <div
              className={styles.drop}
              data-dragging={dragging || undefined}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              {image ? <img src={image} alt="" className={styles.dropImg} /> : <span className={styles.dropEmpty}>把图片拖到这里</span>}
              <Button variant="ghost" size="sm" onClick={() => input.current?.click()} disabled={busy}>
                {image ? '换一张' : '选择图片'}
              </Button>
              <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => void upload(e.target.files?.[0])} />
            </div>
          )}
        </Field>
      )}
      {mode === 'seal' && error && <p className={styles.error}>{error}</p>}
    </Dialog>
  )
}
