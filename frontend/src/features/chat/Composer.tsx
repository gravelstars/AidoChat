import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Member, ReplyMode } from '../../backend'
import { Button } from '../../components/Button'
import { Seal } from '../../components/Seal'
import { Segmented } from '../../components/Segmented'
import { avatarOf } from '../../lib/avatar'
import { activeMentionQuery, parseMentions, planTargets } from '../../lib/mention'
import { useChat, type GroupState } from '../../state/store'
import styles from './Composer.module.css'

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
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [mode, setMode] = useState<ReplyMode | null>(null) // null = 跟随群默认
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuClosed, setMenuClosed] = useState(false)
  const [shaking, setShaking] = useState(false) // 忙碌时按 Enter 的抖动提示
  const composing = useRef(false)

  // 切换群时清空本地状态
  useEffect(() => {
    setText('')
    setMode(null)
    area.current?.focus()
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

  const submit = async () => {
    const content = text.trim()
    if (!content) return
    if (busy) {
      setShaking(false)
      requestAnimationFrame(() => setShaking(true))
      return
    }
    setText('')
    setMode(null)
    try {
      await send(content, mode ?? undefined)
    } catch {
      setText(content) // 发送失败：内容还给用户
    }
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
    <div className={styles.dock}>
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
            <Button variant="accent" size="sm" icon="send" onClick={() => void submit()} disabled={!text.trim()}>
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
