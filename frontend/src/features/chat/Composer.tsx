import { isDemo } from '../../demo/storage'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { backend, type Attachment, type Member, type ReplyMode } from '../../backend'
import { Button } from '../../components/Button'
import { Seal } from '../../components/Seal'
import { Segmented } from '../../components/Segmented'
import { avatarOf } from '../../lib/avatar'
import { activeMentionQuery, parseMentions, planTargets } from '../../lib/mention'
import { useChat, type GroupState } from '../../state/store'
import { AttachmentList } from './AttachmentList'
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENTS, remainingDraft, toBase64, validateAttachment, validateDocument, validateImage } from '../../lib/attachments'
import { extractPDF } from '../../lib/pdf'
import styles from './Composer.module.css'

const textDrafts = new Map<string, string>()

export interface ComposerHandle {
  insertMention(name: string): void
  focus(): void
}

interface Props {
  state: GroupState
  members: Record<string, Member>
}

interface Candidate {
  key: string
  name: string
  member?: Member
}

const MODE_OPTIONS: { value: ReplyMode; label: string; hint: string }[] = [
  { value: 'serial', label: '依次', hint: '按 @ 的顺序一个接一个回答，后面的能看到前面的' },
  { value: 'parallel', label: '同时', hint: '同时回答，互相看不到本轮的回答' },
]

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ state, members }, ref) {
  const { group, busy } = state
  const send = useChat((s) => s.send)
  const stop = useChat((s) => s.stop)
  const area = useRef<HTMLTextAreaElement>(null)
  const [text, setTextState] = useState(textDrafts.get(group.id) ?? '')
  const textRef = useRef(text)
  const setText = (value: string) => { textRef.current = value; textDrafts.set(group.id, value); setTextState(value) }
  const [attachments,setAttachments] = useState<Attachment[]>([])
  const attachmentRef = useRef<Attachment[]>([])
  const epoch = useRef(0)
  const pendingImports = useRef(0)
  const importControllers = useRef(new Set<AbortController>())
  const [importing,setImporting] = useState(false)
  const [sending,setSending] = useState(false)
  const sendingRef = useRef(false)
  const inFlightIds = useRef(new Set<string>())
  const [attachmentError,setAttachmentError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const [caret, setCaret] = useState(0)
  const [mode, setMode] = useState<ReplyMode | null>(null) // null = 跟随群默认
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuClosed, setMenuClosed] = useState(false)
  const [shaking, setShaking] = useState(false) // 忙碌时按 Enter 的抖动提示
  const composing = useRef(false)

  // 群间保留文本草稿；未发送附件只属于当前输入会话。
  useEffect(() => {
    const draft = textDrafts.get(group.id) ?? ''
    textRef.current=draft;setTextState(draft)
    setAttachments([]);attachmentRef.current=[];setAttachmentError('');setSending(false);sendingRef.current=false
    setMode(null)
    area.current?.focus()
    return () => {
      epoch.current++
      for(const ctrl of importControllers.current) ctrl.abort()
      importControllers.current.clear()
      for(const a of attachmentRef.current) if(!inFlightIds.current.has(a.id)) void backend.removeDraftAttachment(a.id).catch(()=>{})
      attachmentRef.current=[]
    }
  }, [group.id])

  const groupMembers = useMemo(() => group.memberIds.map((id) => members[id]).filter(Boolean), [group.memberIds, members])
  const parsed = useMemo(() => parseMentions(text, groupMembers), [text, groupMembers])
  const targets = useMemo(() => planTargets(group.memberIds, parsed), [group.memberIds, parsed])
  const effectiveMode = mode ?? group.defaultMode

  // ---- @ 候选 ----
  const query = activeMentionQuery(text, caret)
  const candidates: Candidate[] = useMemo(() => {
    if (!query) return []
    const q = query.query.toLowerCase()
    const list: Candidate[] = [{ key: '__all', name: '所有人' }, ...groupMembers.map((m) => ({ key: m.id, name: m.name, member: m }))]
    return list.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.key === '__all' && 'all'.startsWith(q)))
  }, [query?.query, query?.start, groupMembers])
  const menuOpen = !!query && candidates.length > 0 && !menuClosed

  useEffect(() => {
    setMenuIndex(0)
    setMenuClosed(false)
  }, [query?.start])

  const resize = useCallback(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
  }, [])
  useEffect(resize, [text, resize])

  const replaceRange = (start: number, end: number, insert: string) => {
    const next = text.slice(0, start) + insert + text.slice(end)
    setText(next)
    const pos = start + insert.length
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(pos, pos)
      setCaret(pos)
    })
  }

  const pick = (c: Candidate) => {
    if (!query) return
    replaceRange(query.start, caret, `@${c.name} `)
  }

  useImperativeHandle(ref, () => ({
    insertMention(name) {
      const el = area.current
      const at = el?.selectionStart ?? text.length
      const before = text.slice(0, at)
      const pad = before && !/\s$/.test(before) ? ' ' : ''
      replaceRange(at, at, `${pad}@${name} `)
    },
    focus() {
      area.current?.focus()
    },
  }))

  const removeAttachment = async (id:string) => {
    if(sendingRef.current) return
    const session=epoch.current
    try {
      await backend.removeDraftAttachment(id)
      if(session!==epoch.current) return
      attachmentRef.current=remainingDraft(attachmentRef.current,[id]);setAttachments(attachmentRef.current)
    } catch(e) {if(session===epoch.current)setAttachmentError(e instanceof Error?e.message:String(e))}
  }

  const addFiles = async (files:File[]) => {
    if(sendingRef.current || !files.length) return
    const session=epoch.current
    const controller=new AbortController();importControllers.current.add(controller)
    pendingImports.current++ ; setImporting(true);setAttachmentError('')
    try {
      for(const file of files) {
        if(session!==epoch.current) break
        const format=validateAttachment(file,attachmentRef.current.length)
        const bytes=new Uint8Array(await file.arrayBuffer())
        let text='', pageCount=0
        if(format.extract==='image') {
          const url=URL.createObjectURL(file)
          try { await new Promise<void>((resolve,reject)=> { const image=new Image();image.onload=()=>{try{validateImage(image.naturalWidth,image.naturalHeight);resolve()}catch(e){reject(e)}};image.onerror=()=>reject(new Error('图片无法读取，请更换有效的 PNG、JPEG 或 WebP'));image.src=url }) }
          finally {URL.revokeObjectURL(url)}
        } else if(format.extract==='pdf') { ({text,pageCount}=await extractPDF(bytes,controller.signal)) }
        else if(format.extract==='text') {
          try {text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)} catch {throw new Error('文本必须使用 UTF-8 编码，请转换后添加')}
          if(file.name.toLowerCase().endsWith('.json')) { try { JSON.parse(text) } catch { throw new Error('JSON 文件格式无效') } }
          validateDocument(text)
        }
        // Office 文件不在这里解码：Go 服务会校验真实 ZIP 结构并提取正文。
        if(session!==epoch.current) break
        const attachment=await backend.importAttachment({groupId:group.id,name:file.name,mime:format.mime,base64:toBase64(bytes),text,pageCount})
        if(session!==epoch.current || attachmentRef.current.length>=MAX_ATTACHMENTS) {await backend.removeDraftAttachment(attachment.id);if(session===epoch.current) throw new Error('每条消息最多添加 4 份附件');break}
        attachmentRef.current=[...attachmentRef.current,attachment];setAttachments(attachmentRef.current)
      }
    } catch(e) {if(session===epoch.current) setAttachmentError(e instanceof Error?e.message:String(e))}
    finally {importControllers.current.delete(controller);pendingImports.current--;if(pendingImports.current===0) setImporting(false)}
  }

  const submit = async () => {
    const content = text.trim()
    const sent = [...attachmentRef.current]
    if ((!content && !sent.length) || sendingRef.current || pendingImports.current>0) return
    if (busy) { setShaking(false);requestAnimationFrame(() => setShaking(true));return }
    if(sent.some(a=>a.kind==='image')) {
      const unsupported=targets.filter(id=>!members[id]?.supportsImages).map(id=>members[id]?.name ?? id)
      if(unsupported.length) {setAttachmentError(`「${unsupported.join('、')}」尚未启用图片输入，请在成员设置中确认模型能力，或移除图片后发送`);return}
    }
    const session=epoch.current
    const original=textRef.current
    sendingRef.current=true;inFlightIds.current=new Set(sent.map(a=>a.id));setSending(true);setAttachmentError('')
    try {
      await send(content, mode ?? undefined, sent.map(a=>a.id))
      if(textDrafts.get(group.id)===original) textDrafts.set(group.id,'')
      if(session!==epoch.current) return
      attachmentRef.current=remainingDraft(attachmentRef.current,sent.map(a=>a.id));setAttachments(attachmentRef.current)
      if(textRef.current===original) {setText('');setMode(null)}
    } catch(e) { if(session===epoch.current) setAttachmentError(e instanceof Error?e.message:String(e));else for(const a of sent) void backend.removeDraftAttachment(a.id).catch(()=>{}) }
    finally {for(const a of sent) inFlightIds.current.delete(a.id);if(session===epoch.current){sendingRef.current=false;setSending(false)}}
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法组字期间的 Enter 是"上屏"，绝不能当发送
    if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return
    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMenuIndex((i) => (i + 1) % candidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMenuIndex((i) => (i - 1 + candidates.length) % candidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pick(candidates[menuIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMenuClosed(true)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  // 全局快捷键：Ctrl/⌘ + . 停止
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault()
        stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stop])

  return (
    <div className={styles.dock} onDragOver={(e)=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault()}} onDrop={(e)=>{if(e.dataTransfer.files.length){e.preventDefault();void addFiles(Array.from(e.dataTransfer.files))}}}>
      <div className={`${styles.composer} ${shaking ? styles.shake : ''}`} onAnimationEnd={() => setShaking(false)}>
        {menuOpen && (
          <ul className={styles.menu} role="listbox" aria-label="选择要 @ 的成员">
            {candidates.map((c, i) => (
              <li
                key={c.key}
                role="option"
                aria-selected={i === menuIndex}
                className={styles.option}
                onMouseEnter={() => setMenuIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(c)
                }}
              >
                {c.member ? (
                  <Seal avatar={avatarOf(c.member, group)} size="sm" />
                ) : (
                  <span className={styles.allSeals}>
                    {groupMembers.slice(0, 3).map((m) => (
                      <Seal key={m.id} avatar={avatarOf(m, group)} size="xs" />
                    ))}
                  </span>
                )}
                <span className={styles.optName}>{c.name}</span>
                <span className={styles.optBrief}>{c.member ? c.member.brief : `按群成员顺序，${groupMembers.length} 位都回复`}</span>
              </li>
            ))}
          </ul>
        )}

        {menuOpen ? (
          <div className={styles.strip}>↑ ↓ 选择，Enter 或 Tab 确认，Esc 取消</div>
        ) : (
          <TargetStrip group={group} targets={targets} members={members} mode={effectiveMode} hasText={!!text.trim()} busy={busy} />
        )}

        {!!attachments.length && <p className={styles.attachmentStatus}>{isDemo ? "最多 4 份；演示版每份附件 ≤512 KiB，总存储空间有限。附件只保存在当前浏览器，不会发送给模型。" : "最多 4 份；图片 ≤10 MiB，文档 ≤20 MiB。仅点名 AI 时发送给模型。"}</p>}
        {!!attachments.length && <div className={styles.attachments}><AttachmentList attachments={attachments} onRemove={(id)=>void removeAttachment(id)} disabled={sending} /></div>}
        {importing && <p className={styles.attachmentStatus} role="status">正在本地读取附件</p>}
        {attachmentError && <p className={styles.attachmentError} role="alert">{attachmentError}</p>}
        <textarea
          ref={area}
          className={styles.input}
          value={text}
          rows={1}
          placeholder={`在「${group.title}」里说点什么`}
          onChange={(e) => {
            setText(e.target.value)
            setCaret(e.target.selectionStart)
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={(e)=>{const images=Array.from(e.clipboardData.files).filter(f=>f.type.startsWith('image/'));if(images.length){e.preventDefault();void addFiles(images)}}}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={(e) => {
            composing.current = false
            setCaret(e.currentTarget.selectionStart)
          }}
          onBlur={() => setMenuClosed(true)}
          onFocus={() => setMenuClosed(false)}
          aria-label="消息"
        />

        <div className={styles.bar}>
          <input ref={fileInput} type="file" accept={ATTACHMENT_ACCEPT} multiple hidden onChange={(e)=>{void addFiles(Array.from(e.target.files??[]));e.target.value=''}} />
          <Button variant="quiet" size="sm" disabled={importing||sending||attachments.length>=MAX_ATTACHMENTS} onClick={()=>fileInput.current?.click()} aria-label="添加附件" title="最多 4 份：图片 10 MiB；PDF、Office、TXT/Markdown/CSV/JSON/代码/日志 20 MiB；文本最多 10 万字符">添加附件</Button>
          <Button variant="quiet" size="sm" className={styles.atBtn} onClick={insertAt} aria-label="插入 @">
            @
          </Button>
          <span className={styles.keys}>
            <kbd>Enter</kbd> 发送 <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行
          </span>
          <span className={styles.spacer} />
          <Segmented size="sm" label="多人回复方式" value={effectiveMode} options={MODE_OPTIONS} onChange={setMode} marked={group.defaultMode} />
          {busy ? (
            <Button variant="ghost" size="sm" icon="stop" onClick={stop} title="停止（Ctrl/⌘ + .）">
              停止
            </Button>
          ) : (
            <Button variant="accent" size="sm" icon="send" onClick={() => void submit()} disabled={(!text.trim() && !attachments.length) || importing || sending}>
              发送
            </Button>
          )}
        </div>
      </div>
    </div>
  )

  function insertAt() {
    const el = area.current
    const at = el?.selectionStart ?? text.length
    const before = text.slice(0, at)
    const pad = before && !/\s$/.test(before) ? ' ' : ''
    replaceRange(at, at, `${pad}@`)
  }
})

function TargetStrip({ group, targets, members, mode, hasText, busy }: { group: GroupState['group']; targets: string[]; members: Record<string, Member>; mode: ReplyMode; hasText: boolean; busy: boolean }) {
  if (busy) {
    return <div className={styles.strip}>本轮回复结束后才能发送下一条，<span className={styles.stripKey}>Ctrl/⌘ + .</span> 可以停止</div>
  }
  if (targets.length === 0) {
    return <div className={styles.strip}>{hasText ? '没有 @ 任何成员：这条只会记在群里，不会触发回复' : '用 @ 点名成员回答，@所有人 让全员发言'}</div>
  }
  return (
    <div className={`${styles.strip} ${styles.stripActive}`}>
      <span className={styles.stripLabel}>{targets.length > 1 ? (mode === 'serial' ? '依次回复' : '同时回复') : '回复'}</span>
      {targets.map((id, i) => {
        const m = members[id]
        return (
          <span key={id} className={styles.target}>
            {targets.length > 1 && mode === 'serial' && <span className={styles.order}>{i + 1}</span>}
            <Seal avatar={avatarOf(m, group)} size="xs" />
            {m?.name}
            {targets.length > 1 && mode === 'serial' && i < targets.length - 1 && <span className={styles.arrow}>→</span>}
          </span>
        )
      })}
    </div>
  )
}
