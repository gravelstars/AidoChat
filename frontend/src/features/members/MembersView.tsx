import { useState, type CSSProperties } from 'react'
import type { Member } from '../../backend'
import { Button } from '../../components/Button'
import { Seal } from '../../components/Seal'
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

  return (
    <section className={styles.page}>
      <header className={`${styles.head} drag`} data-edge="right">
        <div className={styles.headRow}>
          <div>
            <h1 className={styles.title}>成员</h1>
            <p className={styles.sub}>每位成员是一个配置好的 AI。他们没有个人记忆，进入哪个群，就只知道哪个群的事。</p>
          </div>
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            新建成员
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
                  <dt>模型</dt>
                  <dd>{m.model}</dd>
                  <dt>服务</dt>
                  <dd>
                    {p?.name ?? '未配置'}
                    {p && !p.hasKey && <span className={styles.warn}> · 缺少 Key</span>}
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
