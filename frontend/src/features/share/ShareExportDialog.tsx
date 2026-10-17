import { isDemo } from '../../demo/storage'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { backend, type Member } from '../../backend'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { Field, Select } from '../../components/Field'
import { Segmented } from '../../components/Segmented'
import { toBase64 } from '../../lib/attachments'
import { SharePaginateError, SHARE_WIDTH, type SharePagePlan } from '../../lib/share/paginate'
import { paginateSnapshot, renderShareBlobs, revokeSharePages, type RenderedSharePage } from '../../lib/share/render'
import { buildShareSnapshot, shareEligible, type ShareSnapshot } from '../../lib/share/snapshot'
import { useChat, type GroupState } from '../../state/store'
import { SharePageView } from './SharePage'
import styles from './ShareExportDialog.module.css'

interface Props {
  open: boolean
  onClose(): void
  state: GroupState
  members: Record<string, Member>
}

export function ShareExportDialog({ open, onClose, state, members }: Props) {
  const userDisplayName = useChat((s) => s.userDisplayName)
  const userSeal = useChat((s) => s.userSeal)
  const appearance = useChat((s) => s.appearance)
  const night = useChat((s) => s.night)
  const eligible = useMemo(() => state.messages.filter(shareEligible), [state.messages])
  const authorName = (kind: string, id: string) =>
    kind === 'user' ? userDisplayName : kind === 'system' ? '系统' : members[id]?.name ?? '已退群成员'

  const [startSeq, setStartSeq] = useState(0)
  const [endSeq, setEndSeq] = useState(0)
  const [showGroupTitle, setShowGroupTitle] = useState(true)
  const [showTime, setShowTime] = useState(true)
  const [showSignature, setShowSignature] = useState(true)
  const [paperChoice, setPaperChoice] = useState<'current' | 'xuan'>('current')
  const [plans, setPlans] = useState<SharePagePlan[]>([])
  const [snapshot, setSnapshot] = useState<ShareSnapshot | null>(null)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const request = useRef(0)
  const session = useRef('')
  const blobs = useRef<RenderedSharePage[]>([])

  const release = () => {
    revokeSharePages(blobs.current)
    blobs.current = []
  }
  const cancelSession = () => {
    if (!session.current) return
    const id = session.current
    session.current = ''
    void backend.cancelShareExport(id).catch(() => undefined)
  }

  useEffect(() => {
    if (!open) return
    const first = eligible[0]?.seq ?? 0
    const last = eligible.at(-1)?.seq ?? 0
    setStartSeq(first)
    setEndSeq(last)
    setShowGroupTitle(true)
    setShowTime(true)
    setShowSignature(true)
    setPaperChoice('current')
    setPlans([])
    setSnapshot(null)
    setPreviewIndex(0)
    setError('')
    setSaved('')
    setProgress('')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    if (!eligible.length) {
      setPlans([])
      setSnapshot(null)
      setError('这个群还没有可分享的消息')
      return
    }
    const id = ++request.current
    const timer = setTimeout(() => {
      setChecking(true)
      setError('')
      setSaved('')
      try {
        const next = buildShareSnapshot(
          { group: state.group, messages: state.messages, members, userDisplayName, userSeal },
          {
            startSeq,
            endSeq,
            showGroupTitle,
            showTime,
            showSignature,
            paper: paperChoice === 'xuan' ? 'xuan' : night ? appearance.nightPaper : appearance.paper,
          },
        )
        void paginateSnapshot(next)
          .then((result) => {
            if (id !== request.current) return
            setSnapshot(next)
            setPlans(result)
            setPreviewIndex((i) => Math.min(i, result.length - 1))
          })
          .catch((e) => {
            if (id !== request.current) return
            setPlans([])
            setSnapshot(null)
            setError(e instanceof SharePaginateError ? e.message : e instanceof Error ? e.message : String(e))
          })
          .finally(() => {
            if (id === request.current) setChecking(false)
          })
      } catch (e) {
        setChecking(false)
        setPlans([])
        setSnapshot(null)
        setError(e instanceof Error ? e.message : String(e))
      }
    }, 160)
    return () => {
      clearTimeout(timer)
      request.current++
    }
  }, [open, eligible.length, startSeq, endSeq, showGroupTitle, showTime, showSignature, paperChoice, state.group, state.messages, members, userDisplayName, userSeal, appearance, night])

  useEffect(() => () => {
    if (session.current) void backend.cancelShareExport(session.current).catch(() => undefined)
    revokeSharePages(blobs.current)
  }, [])

  const close = () => {
    request.current++
    cancelSession()
    release()
    setSaving(false)
    onClose()
  }

  const save = async () => {
    if (saving || checking || !plans.length || !snapshot) return
    const id = ++request.current
    setSaving(true)
    setError('')
    setSaved('')
    setProgress('正在生成图片')
    try {
      const pages = await renderShareBlobs(snapshot, plans)
      if (id !== request.current) {
        revokeSharePages(pages)
        return
      }
      blobs.current = pages
      setProgress(`共 ${pages.length} 张，正在选择保存位置`)
      const begun = await backend.beginShareExport({ title: state.group.title, pageCount: pages.length })
      if (begun.cancelled) {
        release()
        setProgress('')
        return
      }
      session.current = begun.sessionId
      for (const page of pages) {
        if (id !== request.current) return
        setProgress(`正在写入第 ${page.index} / ${pages.length} 张`)
        const bytes = new Uint8Array(await page.blob.arrayBuffer())
        await backend.writeShareExportPage({ sessionId: begun.sessionId, index: page.index, pngBase64: toBase64(bytes) })
      }
      setProgress('正在保存整组图片')
      const result = await backend.commitShareExport(begun.sessionId)
      session.current = ''
      release()
      setProgress('')
      setSaved(`已保存 ${result.count} 张到「${result.folderName}」`)
    } catch (e) {
      cancelSession()
      release()
      setProgress('')
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === request.current) setSaving(false)
    }
  }

  const plan = plans[previewIndex]
  const busy = checking || saving

  return (
    <Dialog
      open={open}
      onClose={close}
      title="分享图片"
      description={isDemo ? "演示版仅预览分享排版，不保存图片。请使用桌面版导出 PNG 到本机目录。" : "选一段群聊，生成可保存到本机的长图；超过一页会自动分成多张。"}
      width={820}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={saving}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={isDemo || busy || !plans.length}>
            {saving ? '正在保存' : '保存图片'}
          </Button>
        </>
      }
    >
      <fieldset className={styles.options} disabled={saving}>
        <legend className={styles.legend}>范围</legend>
        <div className={styles.range}>
          <Field label="起点">
            {(id) => (
              <Select id={id} value={startSeq} onChange={(e) => setStartSeq(Number(e.target.value))}>
                {eligible.map((m) => (
                  <option key={m.id} value={m.seq}>#{m.seq} {authorName(m.authorKind, m.authorId)}：{m.content.slice(0, 24) || '（附件）'}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="终点">
            {(id) => (
              <Select id={id} value={endSeq} onChange={(e) => setEndSeq(Number(e.target.value))}>
                {eligible.map((m) => (
                  <option key={m.id} value={m.seq}>#{m.seq} {authorName(m.authorKind, m.authorId)}：{m.content.slice(0, 24) || '（附件）'}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className={styles.range}>
          <Field label="纸面">
            {() => (
              <Segmented
                label="分享纸面"
                size="sm"
                value={paperChoice}
                onChange={setPaperChoice}
                options={[
                  { value: 'current', label: '当前纸' },
                  { value: 'xuan', label: '宣纸' },
                ]}
              />
            )}
          </Field>
          <div className={styles.toggles}>
            <label className={styles.check}><input type="checkbox" checked={showGroupTitle} onChange={(e) => setShowGroupTitle(e.target.checked)} /> 显示群名</label>
            <label className={styles.check}><input type="checkbox" checked={showTime} onChange={(e) => setShowTime(e.target.checked)} /> 显示时间</label>
            <label className={styles.check}><input type="checkbox" checked={showSignature} onChange={(e) => setShowSignature(e.target.checked)} /> 显示 AidoChat 署名</label>
          </div>
        </div>
      </fieldset>

      <div className={styles.previewHead}>
        <span className={styles.previewTitle}>预览</span>
        {!!plans.length && (
          <span className={styles.pageControls}>
            <Button variant="quiet" size="sm" disabled={previewIndex <= 0} onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}>上一页</Button>
            <span className={styles.pageNo}>{previewIndex + 1} / {plans.length}</span>
            <Button variant="quiet" size="sm" disabled={previewIndex >= plans.length - 1} onClick={() => setPreviewIndex((i) => Math.min(plans.length - 1, i + 1))}>下一页</Button>
          </span>
        )}
        {checking && <span className={styles.hint} role="status">正在排版</span>}
        {!checking && !!plans.length && <span className={styles.hint}>共 {plans.length} 张图片</span>}
      </div>
      <div className={styles.previewBox}>
        {plan ? <PagePreview plan={plan} /> : <p className={styles.empty}>{checking ? '正在按真实版心测量分页…' : '选择范围后可预览'}</p>}
      </div>
      {progress && <p className={styles.status} role="status">{progress}</p>}
      {saved && <p className={styles.saved} role="status">{saved}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </Dialog>
  )
}

function PagePreview({ plan }: { plan: SharePagePlan }) {
  const box = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.6)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const width = box.current?.clientWidth ?? 0
    const next = width > 0 ? Math.min(1, width / SHARE_WIDTH) : 0.6
    setScale(next)
    setHeight((page.current?.offsetHeight ?? 0) * next)
  }, [plan])
  return (
    <div ref={box} className={styles.previewViewport} style={{ height: height || undefined }}>
      <div ref={page} className={styles.previewPage} style={{ width: SHARE_WIDTH, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <SharePageView plan={plan} />
      </div>
    </div>
  )
}
