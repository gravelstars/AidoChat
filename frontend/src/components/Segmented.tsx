import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useT } from '../i18n/react'
import styles from './Segmented.module.css'

/** 分段切换。选中块会滑动过去，而不是瞬间跳变。 */
interface Option<T extends string> {
  value: T
  label: string
  hint?: string
}

interface Props<T extends string> {
  value: T
  options: Option<NoInfer<T>>[]
  onChange(v: NoInfer<T>): void
  size?: 'sm' | 'md'
  label: string
  /** 标记"默认值"，在选项右上角显示小点 */
  marked?: NoInfer<T>
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md', label, marked }: Props<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null)
  const t = useT()

  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-value="${value}"]`)
    if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth })
  }, [value, options.length])

  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={`${styles.root} ${styles[size]}`}>
      {thumb && <span className={styles.thumb} style={{ '--x': `${thumb.x}px`, '--w': `${thumb.w}px` } as CSSProperties} />}
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          data-value={o.value}
          title={o.hint}
          className={styles.option}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {marked === o.value && <span className={styles.mark} aria-label={t('默认')} />}
        </button>
      ))}
    </div>
  )
}
