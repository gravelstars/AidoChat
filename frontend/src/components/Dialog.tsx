import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import styles from './Dialog.module.css'

/**
 * 对话框：一张从案头抽出来的纸。用原生 <dialog> 获得焦点陷阱与 Esc 关闭。
 * 用法见 features/rail/CreateGroupDialog.tsx —— 所有表单类对话框照这个结构写。
 */
interface Props {
  open: boolean
  title: string
  description?: string
  onClose(): void
  children: ReactNode
  footer?: ReactNode
  width?: number
}

export function Dialog({ open, title, description, onClose, children, footer, width = 480 }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return createPortal(
    <dialog
      ref={ref}
      className={styles.dialog}
      style={{ width }}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open && (
        <div className={styles.sheet}>
          <header className={styles.head}>
            <div>
              <h2 className={styles.title}>{title}</h2>
              {description && <p className={styles.desc}>{description}</p>}
            </div>
            <Button variant="quiet" size="sm" icon="close" aria-label="关闭" onClick={onClose} />
          </header>
          <div className={styles.body}>{children}</div>
          {footer && <footer className={styles.foot}>{footer}</footer>}
        </div>
      )}
    </dialog>,
    document.body,
  )
}
