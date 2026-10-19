import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Seal, UserSeal } from '../../components/Seal'
import type { SharePagePlan } from '../../lib/share/paginate'
import { SHARE_WIDTH } from '../../lib/share/paginate'
import type { ShareMessage } from '../../lib/share/snapshot'
import { useT } from '../../i18n/react'
import styles from './SharePage.module.css'

/** 分享图中的消息内容：Markdown 同 GFM，但代码只保留原文并自动换行。 */
export function MessageContent({ message }: { message: ShareMessage }) {
  const t = useT()
  return (
    <>
      {message.content && (
        <div className={`prose ${styles.markdown}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
      )}
      {!!message.attachments.length && (
        <ul className={styles.attachments}>
          {message.attachments.map((a, i) =>
            a.kind === 'image' ? (
              <li key={`${a.name}-${i}`} className={styles.imageItem}>
                <img src={a.url} alt={a.name} width={a.width || undefined} height={a.height || undefined} />
                <span>{a.name}</span>
              </li>
            ) : (
              <li key={`${a.name}-${i}`} className={styles.documentItem}>
                <span className={styles.docLabel}>{t('附件')}</span>
                <span>{a.name}</span>
                {!!a.pageCount && <span className={styles.docMeta}>{t('{n} 页', { n: a.pageCount })}</span>}
              </li>
            ),
          )}
        </ul>
      )}
    </>
  )
}

export function SharePageView({ plan }: { plan: SharePagePlan }) {
  const { snapshot } = plan
  const t = useT()
  return (
    <article className={styles.page} data-paper={snapshot.paper} style={{ width: SHARE_WIDTH }}>
      <header className={styles.pageHead}>
        {snapshot.showGroupTitle ? <h1 className={styles.title}>{snapshot.groupTitle}</h1> : <span />}
        <span className={styles.date}>{snapshot.date}</span>
      </header>
      <main className={styles.body}>
        {plan.chunks.map((chunk, index) =>
          chunk.message.author.kind === 'system' ? (
            <div className={styles.system} key={`${chunk.message.seq}-${index}`} dangerouslySetInnerHTML={{ __html: chunk.contentHtml }} />
          ) : (
            <section className={styles.message} key={`${chunk.message.seq}-${index}`}>
              <div className={styles.seal}>
                {chunk.message.author.kind === 'user' ? (
                  <UserSeal seal={chunk.message.author.seal} size="lg" title={chunk.message.author.name} />
                ) : (
                  <Seal avatar={chunk.message.author.avatar} size="lg" title={chunk.message.author.name} />
                )}
              </div>
              <div className={styles.main}>
                <header className={styles.author}>
                  <span className={styles.name}>{chunk.message.author.name}</span>
                  {chunk.continuation && <span className={styles.continued}>{t('（续）')}</span>}
                  {snapshot.showTime && <time className={styles.time}>{chunk.message.time}</time>}
                </header>
                <div className={styles.content} dangerouslySetInnerHTML={{ __html: chunk.contentHtml }} />
              </div>
            </section>
          ),
        )}
      </main>
      <footer className={styles.pageFoot}>
        {snapshot.showSignature ? <span className={styles.signature}>AidoChat</span> : <span />}
        <span className={styles.pageNo}>{t('第 {index} 页 · 共 {total} 页', { index: plan.index, total: plan.total })}</span>
      </footer>
    </article>
  )
}
