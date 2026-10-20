import { useEffect, useState } from 'react'
import { App } from '../App'
import { Button } from '../components/Button'
import { useT } from '../i18n/react'
import { useChat } from '../state/store'
import { DEMO_PREFIX, resetDemo } from './storage'
import styles from './DemoRoot.module.css'

const desktopWidth = '(min-width: 900px)'
let initializing: Promise<void> | undefined
const downloads = 'https://github.com/gravelstars/AidoChat#下载--download'

function readDismissed(key: string) {
  try { return localStorage.getItem(`${DEMO_PREFIX}${key}`) === '1' } catch { return false }
}

export function DemoRoot() {
  const [wide, setWide] = useState(() => matchMedia(desktopWidth).matches)
  const [banner, setBanner] = useState(() => !readDismissed('banner-dismissed'))
  const [hint, setHint] = useState(() => !readDismissed('hint-dismissed'))
  const t = useT()
  useEffect(() => {
    const query = matchMedia(desktopWidth)
    const changed = () => setWide(query.matches)
    query.addEventListener('change', changed)
    return () => query.removeEventListener('change', changed)
  }, [])
  useEffect(() => {
    if (!wide || useChat.getState().ready) return
    initializing ??= useChat.getState().init().then(async () => {
      if (useChat.getState().groups.some(g => g.id === 'g1' && !g.archived)) await useChat.getState().open('g1')
    })
    void initializing
  }, [wide])
  const dismiss = (key: string, update: (value: boolean) => void) => {
    localStorage.setItem(`${DEMO_PREFIX}${key}`, '1'); update(false)
  }
  if (!wide) return <main className={styles.mobile}>
    <h1>{t('这个应用为电脑设计，请用电脑打开')}</h1>
    <p>{t('AidoChat · 把 AI 拉进同一个群，用 @ 点名讨论，给纪要盖章。')}</p>
    <img src={`${import.meta.env.BASE_URL}showcase/main-day.png`} alt={t('AidoChat 宣纸主题：左侧群聊、中央消息、右侧群纪要')} />
    <a className={styles.link} href={downloads}>{t('查看桌面版下载说明')}</a>
  </main>
  return <div className={styles.demo}>
    <div className={styles.top}>
      {banner && <span role="note">{t('演示版：回复是预设内容，不会调用任何模型，数据只保存在你的浏览器里。')}</span>}
      <span className={styles.actions}>
        <Button variant="quiet" size="sm" onClick={() => { resetDemo(); location.reload() }}>{t('重置演示')}</Button>
        {banner && <Button variant="quiet" size="sm" aria-label={t('关闭演示提示')} onClick={() => dismiss('banner-dismissed', setBanner)}>{t('关闭提示')}</Button>}
        <a className={styles.link} href={downloads}>{t('下载桌面版')}</a>
      </span>
    </div>
    {hint && <div className={styles.hint}>
      <span>{t('试试：用 @ 点名成员，发一条消息，再给纪要盖个章')}</span>
      <Button variant="quiet" size="sm" aria-label={t('关闭试用提示')} onClick={() => dismiss('hint-dismissed', setHint)}>{t('知道了')}</Button>
    </div>}
    <div className={styles.application}><App /></div>
  </div>
}
