import type { MemoryItem } from '../../backend'
import { Icon } from '../../components/Icon'
import { useT } from '../../i18n/react'
import { useChat } from '../../state/store'
import styles from './TodoCheck.module.css'

/** 待办方框：点击即完成/撤销完成（TASK-010）。乐观更新由 store 负责。 */
export function TodoCheck({ item, onComplete }: { item: MemoryItem; onComplete?(id: string): void }) {
  const complete = useChat((s) => s.completeMemory)
  const uncomplete = useChat((s) => s.uncompleteMemory)
  const done = item.status === 'done'
  const t = useT()
  return (
    <button
      type="button"
      className={styles.check}
      aria-pressed={done}
      aria-label={done ? t('撤销完成') : t('标记完成')}
      title={done ? t('撤销完成') : t('标记完成')}
      onClick={() => {
        if (done) {
          void uncomplete(item.id)
        } else {
          onComplete?.(item.id)
          void complete(item.id)
        }
      }}
    >
      {done && <Icon name="check" size={11} />}
    </button>
  )
}
