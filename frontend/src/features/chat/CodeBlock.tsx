import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { highlight } from '../../lib/highlight'
import styles from './CodeBlock.module.css'

/**
 * 代码块（TASK-011）。流式输出中（streaming）先按纯文本显示，闭合（消息结束）后再高亮，
 * 避免每帧重算；右上角悬停出现复制按钮。
 */
export function CodeBlock({ code, lang, streaming }: { code: string; lang: string; streaming: boolean }) {
  const html = useHighlighted(code, lang, !streaming)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => {})
  }

  return (
    <div className={styles.block} data-lang={lang}>
      <div className={styles.bar}>
        <span className={styles.lang}>{lang || 'text'}</span>
        <button className={`${styles.copy} inlineAction`} data-copied={copied} onClick={copy} aria-label="复制代码">
          <Icon name={copied ? 'check' : 'panel'} size={13} />
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      {html ? (
        <div className={styles.pre} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className={styles.pre}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}

function useHighlighted(code: string, lang: string, enabled: boolean): string | null {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled || !lang) {
      setHtml(null)
      return
    }
    let alive = true
    void highlight(code, lang).then((h) => {
      if (alive) setHtml(h)
    })
    return () => {
      alive = false
    }
  }, [code, lang, enabled])
  return html
}
