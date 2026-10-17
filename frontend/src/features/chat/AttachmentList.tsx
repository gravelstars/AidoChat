import { useEffect, useRef, useState } from 'react'
import { backend, type Attachment } from '../../backend'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { attachmentSize } from '../../lib/attachments'
import styles from './AttachmentList.module.css'

interface Props {
  attachments: Attachment[]
  onRemove?(id: string): void
  disabled?: boolean
}

export function AttachmentList({ attachments, onRemove, disabled = false }: Props) {
  const [preview, setPreview] = useState<Attachment | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])

  const close = () => {
    request.current++
    setPreview(null)
    setError('')
    setLoading(false)
  }

  async function inspect(attachment: Attachment) {
    const currentRequest = ++request.current
    setPreview(attachment)
    setError('')
    setLoading(true)
    try {
      const current = await backend.readAttachment(attachment.id)
      if (request.current === currentRequest) setPreview(current)
    } catch (e) {
      if (request.current === currentRequest) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (request.current === currentRequest) setLoading(false)
    }
  }

  return (
    <>
      <ul className={styles.list} aria-label={onRemove ? '待发送附件' : '消息附件'}>
        {attachments.map((attachment) => (
          <li className={styles.item} key={attachment.id}>
            {attachment.kind === 'image' && <img className={styles.thumbnail} src={attachment.url} alt="" />}
            <div className={styles.meta}>
              <span className={styles.name} title={attachment.name}>{attachment.name}</span>
              <span>{attachmentSize(attachment.size)}{attachment.pageCount ? ` · ${attachment.pageCount} 页` : ''}</span>
            </div>
            <Button variant="quiet" size="sm" aria-label={`预览附件：${attachment.name}`} onClick={() => void inspect(attachment)}>预览</Button>
            {onRemove && <Button variant="quiet" size="sm" disabled={disabled} aria-label={`移除附件：${attachment.name}`} onClick={() => onRemove(attachment.id)}>移除</Button>}
          </li>
        ))}
      </ul>
      <Dialog open={!!preview} onClose={close} title={preview?.name ?? '附件预览'} width={640}>
        {loading && <p role="status">正在读取附件</p>}
        {error && <p role="alert">{error}</p>}
        {preview?.kind === 'image'
          ? <img className={styles.image} src={preview.url} alt={preview.name} />
          : <pre className={styles.document}>{preview?.text}</pre>}
      </Dialog>
    </>
  )
}
