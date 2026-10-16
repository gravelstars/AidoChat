import { backend } from '../../backend'
import { Icon } from '../../components/Icon'
import { useChat } from '../../state/store'
import styles from './WindowControls.module.css'

/**
 * Windows / Linux 的窗口按钮（无边框窗口需要自己画）。macOS 用系统红绿灯，这里不渲染。
 * 关闭按钮悬停变红是平台惯例，这是全应用唯一允许出现"非朱"红色的地方。
 */
export function WindowControls() {
  const platform = useChat((s) => s.platform)
  if (platform === 'mac') return null
  return (
    <div className={styles.controls}>
      <button className={styles.btn} onClick={backend.window.minimise} aria-label="最小化">
        <Icon name="minimise" size={14} />
      </button>
      <button className={styles.btn} onClick={backend.window.toggleMaximise} aria-label="最大化">
        <Icon name="maximise" size={13} />
      </button>
      <button className={`${styles.btn} ${styles.close}`} onClick={backend.window.close} aria-label="关闭">
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
