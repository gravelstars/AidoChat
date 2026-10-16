import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import styles from './Field.module.css'

/** 表单字段：标签在上、说明在下、错误替换说明。所有表单都用它，不要自己拼。 */
export function Field({
  label,
  hint,
  error,
  children,
  aside,
}: {
  label: string
  hint?: string
  error?: string
  aside?: ReactNode
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {aside}
      </div>
      {children(id)}
      {error ? <p className={styles.error}>{error}</p> : hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  )
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={[styles.input, className].filter(Boolean).join(' ')} {...rest} />
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={[styles.input, styles.area, className].filter(Boolean).join(' ')} {...rest} />
})

/** 原生下拉，套用与输入框一致的边框与高度（TASK-007/008 的模型服务选择）。 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...rest },
  ref,
) {
  return <select ref={ref} className={[styles.input, styles.select, className].filter(Boolean).join(' ')} {...rest} />
})
