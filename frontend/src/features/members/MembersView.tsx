import { isDemo } from '../../demo/storage'
import { useState, type CSSProperties } from 'react'
import type { Member } from '../../backend'
import { Button } from '../../components/Button'
import { Seal } from '../../components/Seal'
import { useT } from '../../i18n/react'
import { useChat } from '../../state/store'
import { MemberEditor } from './MemberEditor'
import styles from './MembersView.module.css'

/**
 * 成员名册：新建 / 编辑 / 删除（TASK-007）。表单与头像编辑见 MemberEditor。
 */
export function MembersView() {
  const members = useChat((s) => s.members)
  const retiredIds = useChat((s) => s.retiredIds)
  const providers = useChat((s) => s.providers)
  const [editing, setEditing] = useState<Member | null>(null)
  const [creating, setCreating] = useState(false)
  const list = Object.values(members).filter((m) => !retiredIds.includes(m.id))
  const t = useT()

  return (
    <section className={styles.page}>
      <header className={`${styles.head} drag`} data-edge="right">
        <div className={styles.headRow}>
          <div>
            <h1 className={styles.title}>{t('成员')}</h1>
            <p className={styles.sub}>{t('每位成员都是你请来的一位 AI。他们不记得别的群，只知道你们在这里聊过什么。')}</p>
          </div>
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            {t('新建成员')}
          </Button>
        </div>
      </header>
      <div className={styles.grid}>
        {list.map((m) => {
          const p = providers.find((x) => x.id === m.providerId)
          return (
            <button
              key={m.id}
              type="button"
              className={styles.card}
              style={{ '--seal': `var(--pigment-${m.avatar.color})` } as CSSProperties}
              onClick={() => setEditing(m)}
            >
              <Seal avatar={m.avatar} size="xl" />
              <div className={styles.body}>
                <h2 className={styles.name}>{m.name}</h2>
                <p className={styles.brief}>{m.brief}</p>
                <dl className={styles.facts}>
                  <dt>{t('模型')}</dt>
                  <dd>{m.model}</dd>
                  <dt>{t('服务')}</dt>
                  <dd>
                    {p?.name ?? t('未配置')}
                    {isDemo && p && <span> · {t('预设回复')}</span>}
                    {!isDemo && p && !p.hasKey && (p.kind === 'anthropic' ? <span className={styles.warn}> · {t('缺少 Key')}</span> : ` · ${t('未设 Key')}`)}
                  </dd>
                </dl>
              </div>
            </button>
          )
        })}
      </div>

      <MemberEditor open={creating} onClose={() => setCreating(false)} />
      {editing && <MemberEditor open={!!editing} onClose={() => setEditing(null)} member={editing} />}
    </section>
  )
}
