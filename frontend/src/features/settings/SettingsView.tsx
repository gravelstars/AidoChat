import { isDemo } from '../../demo/storage'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Appearance, DarkPaper, LightPaper, PaperId, ProviderConfig, UserSeal as UserSealData, UserProfile } from '../../backend'
import { backend, DEFAULT_USER_SEAL } from '../../backend'
import { Button } from '../../components/Button'
import { Field, Select, TextInput } from '../../components/Field'
import { Seal, UserSeal } from '../../components/Seal'
import { Segmented } from '../../components/Segmented'
import { isCustomSeal } from '../../lib/avatar'
import { ProfileDraft, suggestSeal, validateUserProfile } from '../../lib/userProfile'
import { useChat } from '../../state/store'
import { ProviderDialog } from './ProviderDialog'
import styles from './SettingsView.module.css'

/**
 * 设置页。「纸张」「私印」「阅读」三节原有；「模型服务」「纪要整理」「数据」「关于」见 TASK-008。
 */

const PAPERS: { id: PaperId; name: string; note: string; dark?: boolean }[] = [
  { id: 'xuan', name: '宣纸', note: '暖白，安静' },
  { id: 'su', name: '素笺', note: '中性的白，不偏冷暖' },
  { id: 'ma', name: '麻纸', note: '黄褐粗纸，低眩光，久读不累' },
  { id: 'qing', name: '青笺', note: '冷灰带青，像雨天的窗' },
  { id: 'ye', name: '夜读', note: '灯下的深色纸，暖黑', dark: true },
  { id: 'wujin', name: '乌金', note: '墨锭的冷黑，带一点青', dark: true },
]

export function SettingsView() {
  return (
    <section className={styles.page}>
      <header className={`${styles.head} drag`} data-edge="right">
        <h1 className={styles.title}>设置</h1>
      </header>
      <div className={styles.body}>
        <PaperSection />
        <SealSection />
        <ReadingSection />
        <ProvidersSection />
        <MemorySection />
        <DataSection />
        <AboutSection />
      </div>
    </section>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {note && <p className={styles.sectionNote}>{note}</p>}
      {children}
    </section>
  )
}

// ---- 纸张 ----

function PaperSection() {
  const appearance = useChat((s) => s.appearance)
  const night = useChat((s) => s.night)
  const setAppearance = useChat((s) => s.setAppearance)

  const pick = (p: (typeof PAPERS)[number]) => {
    if (p.dark) setAppearance({ nightPaper: p.id as DarkPaper, mode: appearance.mode === 'day' ? 'night' : appearance.mode })
    else setAppearance({ paper: p.id as LightPaper, mode: appearance.mode === 'night' ? 'day' : appearance.mode })
  }

  return (
    <Section title="纸张" note="换一张纸，整个界面的颜色随之校准。白昼和夜间各选一张，跟随系统时自动切换。">
      <div className={styles.modeRow}>
        <Segmented
          label="昼夜"
          value={appearance.mode}
          onChange={(mode: Appearance['mode']) => setAppearance({ mode })}
          options={[
            { value: 'day', label: '白昼' },
            { value: 'night', label: '夜间' },
            { value: 'system', label: '跟随系统' },
          ]}
        />
      </div>
      {(['白昼', '夜间'] as const).map((label) => (
        <div key={label} className={styles.paperGroup}>
          <h3 className={styles.paperGroupTitle}>{label}</h3>
          <div className={styles.papers} role="radiogroup" aria-label={`${label}纸张`}>
            {PAPERS.filter((p) => !!p.dark === (label === '夜间')).map((p) => {
              const chosen = p.dark ? appearance.nightPaper === p.id : appearance.paper === p.id
              const inUse = chosen && night === !!p.dark
              return (
                <button key={p.id} role="radio" aria-checked={chosen} className={styles.paper} onClick={() => pick(p)}>
                  <PaperSwatch id={p.id} />
                  <span className={styles.paperText}>
                    <span className={styles.paperName}>
                      {p.name}
                      {inUse && <span className={styles.inUse}>使用中</span>}
                    </span>
                    <span className={styles.paperNote}>{p.note}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </Section>
  )
}

/** 纸样：在 data-paper 作用域里画一个缩小的界面，所有颜色都来自该纸的 token。 */
function PaperSwatch({ id }: { id: PaperId }) {
  return (
    <span className={styles.swatch} data-paper={id} aria-hidden="true">
      <span className={styles.swRail}>
        <i />
        <i />
        <i />
      </span>
      <span className={styles.swMain}>
        <span className={styles.swLine}>
          <span className={styles.swSeal} style={{ background: 'var(--pigment-shiqing)' }} />
          <span className={styles.swText} style={{ width: '70%' }} />
        </span>
        <span className={styles.swLine}>
          <span className={styles.swSeal} style={{ background: 'var(--pigment-shilv)' }} />
          <span className={styles.swText} style={{ width: '52%' }} />
        </span>
        <span className={styles.swLine}>
          <span className={styles.swSeal} style={{ background: 'var(--cinnabar)' }} />
          <span className={styles.swText} style={{ width: '40%' }}>
            <span className={styles.swAt} />
          </span>
        </span>
      </span>
      <span className={styles.swMemo}>
        <span className={styles.swStamp}>定</span>
        <span className={styles.swNote} />
        <span className={styles.swNote} data-pencil />
      </span>
    </span>
  )
}

// ---- 私印 ----

export function SealSection() {
  const seal = useChat((s) => s.userSeal)
  const displayName = useChat((s) => s.userDisplayName)
  const saveProfile = useChat((s) => s.setUserProfile)
  const pending = useChat((s) => s.profileSaving)
  const model = useRef(new ProfileDraft({ displayName, seal }))
  const [profile, setProfile] = useState(model.current.value)
  const name = profile.displayName
  const { text, style } = profile.seal
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [composing, setComposing] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    model.current.sync({displayName, seal})
    setProfile(model.current.value)
  }, [displayName, seal])
  const errors = validateUserProfile(profile)
  const draft = errors.seal ? seal : profile.seal
  const suggestion = suggestSeal(name)
  const edit = (next: UserProfile) => {
    model.current.edit(next); setProfile(model.current.value)
    setError(''); setSaved(false)
  }
  const save = async () => {
    if (saving || pending || composing || errors.displayName || errors.seal) return
    setSaving(true); setError(''); setSaved(false)
    try {
      await saveProfile(profile)
      if (!mounted.current) return
      model.current.accept({...profile, displayName:profile.displayName.trim()})
      setProfile(model.current.value); setSaved(true)
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
    } finally { if (mounted.current) setSaving(false) }
  }
  return (
    <Section title="个人资料与私印" note="显示名用于聊天署名；短印文用于头像和确认纪要。两者独立保存，长姓名不会挤进印面。">
      <div className={styles.sealLayout}>
        <div className={styles.sealStage}><UserSeal seal={draft} px={112} title={name.trim() || '你'} /></div>
        <div className={styles.sealForm}>
          <Field label="显示名" hint="1–40 个字符，支持中英文和词间空格。历史发言跟随当前显示名。" error={errors.displayName}>
            {(id) => <TextInput id={id} value={name} disabled={saving} onChange={(e) => { edit({...profile, displayName:e.target.value}) }} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />}
          </Field>
          <Field label="印文" hint="1–4 个非空白字符。英文建议使用姓名首字母，例如 Sam Altman → SA。" error={errors.seal}>
            {(id) => <TextInput id={id} value={text} className={styles.sealInput} disabled={saving} onChange={(e) => { edit({...profile, seal:{...profile.seal,text:e.target.value}}) }} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} placeholder="我" />}
          </Field>
          <Button variant="quiet" size="sm" disabled={saving || !suggestion} onClick={() => { edit({...profile, seal:{...profile.seal,text:suggestion}}) }}>使用建议印文{suggestion ? `「${suggestion}」` : ''}</Button>
          <Field label="印式">
            {() => <Segmented label="印式" value={style} onChange={(next: UserSealData['style']) => { if (!saving) { edit({...profile, seal:{...profile.seal,style:next}}) } }} options={[{value:'baiwen',label:'白文',hint:'朱底纸色字，厚重'},{value:'zhuwen',label:'朱文',hint:'纸底朱色字，清秀'}]} />}
          </Field>
          <div className={styles.sealUses}>
            <span className={styles.use}><UserSeal seal={draft} px={32} title={name.trim() || '你'} /><span>聊天头像 · 32px</span></span>
            <span className={styles.use}><UserSeal seal={draft} px={64} title={name.trim() || '你'} /><span>预览 · 64px</span></span>
            <span className={styles.use}><span className={styles.useStamp}>{isCustomSeal(draft) ? <UserSeal seal={draft} px={32} /> : <span className={styles.useDing}>定</span>}</span><span>确认纪要时的印</span></span>
          </div>
          {errors.seal && <p className={styles.sectionNote}>印文无效，预览暂保留已保存的私印。</p>}
          {error && <p role="alert" className={styles.profileError}>{error}</p>}
          {saved && <p role="status" className={styles.sectionNote}>个人资料已保存。</p>}
          <div className={styles.profileActions}>
            <Button disabled={saving || pending || composing || Boolean(errors.displayName || errors.seal)} onClick={() => void save()}>{saving ? '正在保存…' : '保存个人资料'}</Button>
            <Button variant="quiet" size="sm" disabled={saving} onClick={() => { edit({...profile, seal:{...DEFAULT_USER_SEAL}}) }}>恢复默认印文</Button>
          </div>
        </div>
      </div>
    </Section>
  )
}

// ---- 阅读 ----

function ReadingSection() {
  const displayName = useChat((s) => s.userDisplayName)
  const appearance = useChat((s) => s.appearance)
  const setAppearance = useChat((s) => s.setAppearance)
  const seal = useChat((s) => s.userSeal)
  return (
    <Section title="阅读">
      <div className={styles.readingRow}>
        <Field label="正文字号">
          {() => (
            <Segmented
              label="正文字号"
              value={appearance.fontSize}
              onChange={(fontSize: Appearance['fontSize']) => setAppearance({ fontSize })}
              options={[
                { value: 's', label: '小' },
                { value: 'm', label: '中' },
                { value: 'l', label: '大' },
              ]}
            />
          )}
        </Field>
        <Field label="排版密度">
          {() => (
            <Segmented
              label="排版密度"
              value={appearance.density}
              onChange={(density: Appearance['density']) => setAppearance({ density })}
              options={[
                { value: 'comfortable', label: '舒适' },
                { value: 'compact', label: '紧凑' },
              ]}
            />
          )}
        </Field>
      </div>
      <div className={styles.sample}>
        <div className={styles.sampleMsg}>
          <UserSeal seal={seal} size="md" title={displayName} />
          <div>
            <div className={styles.sampleName} title={displayName}>{displayName}</div>
            <p className={styles.sampleText}>
              <span className={styles.sampleAt}>@墨白</span> 正文行宽多少合适？
            </p>
          </div>
        </div>
        <div className={styles.sampleMsg}>
          <Seal avatar={{ glyph: '墨', color: 'shiqing' }} size="md" />
          <div>
            <div className={styles.sampleName} style={{ color: 'var(--pigment-shiqing)' }}>
              墨白
            </div>
            <p className={styles.sampleText}>中文正文每行 36 到 40 个字读起来最舒服，大约 720px。行距不要低于字号的 1.6 倍，否则段落会显得拥挤。</p>
          </div>
        </div>
      </div>
    </Section>
  )
}

// ---- 模型服务（TASK-008）----

function ProvidersSection() {
  const providers = useChat((s) => s.providers)
  const [editing, setEditing] = useState<ProviderConfig | null>(null)
  const [creating, setCreating] = useState(false)
  return (
    <Section title="模型服务" note={isDemo ? "演示配置可自由编辑；所有回复均为预设内容，不接收 API Key。" : "成员通过这里配置的服务说话。API Key 只保存在系统钥匙串，界面不会回显。"}>
      <div className={styles.list}>
        {providers.map((p) => (
          <div key={p.id} className={styles.row}>
            <div className={styles.rowMain}>
              <p className={styles.rowName}>{p.name}</p>
              <p className={styles.rowMeta}>{p.baseUrl}</p>
            </div>
            <span className={`${styles.badge} ${isDemo ? '' : p.hasKey ? styles.ok : p.kind === 'anthropic' ? styles.bad : ''}`}>
              {isDemo ? '预设回复' : p.hasKey ? '已保存 Key' : p.kind === 'openai' ? '未设 Key' : '缺少 Key'}
            </span>
            <Button variant="quiet" size="sm" onClick={() => setEditing(p)}>
              编辑
            </Button>
          </div>
        ))}
        {providers.length === 0 && <p className={styles.empty}>还没有配置任何模型服务。先新建一个，成员才能说话。</p>}
      </div>
      <div className={styles.actionsRow}>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          新建服务
        </Button>
      </div>
      <ProviderDialog open={creating} onClose={() => setCreating(false)} />
      {editing && <ProviderDialog open={!!editing} onClose={() => setEditing(null)} provider={editing} />}
    </Section>
  )
}

// ---- 纪要整理（TASK-008）----

function MemorySection() {
  const providers = useChat((s) => s.providers)
  const memory = useChat((s) => s.memory)
  const setMemoryConfig = useChat((s) => s.setMemoryConfig)
  const [model, setModel] = useState(memory.model)
  useEffect(() => setModel(memory.model), [memory.model, memory.providerId])
  const commitModel = () => {
    if (model.trim() !== memory.model) void setMemoryConfig({ providerId: memory.providerId, model: model.trim() })
  }
  return (
    <Section title="纪要整理" note={isDemo ? "演示版从预设回复提取建议，不会向服务发送讨论。" : "整理时，新的讨论会发送给这个服务。不选则用该群第一位成员的模型。"}>
      <div className={styles.memoryRow}>
        <Field label="整理服务">
          {(id) => (
            <Select id={id} value={memory.providerId} onChange={(e) => void setMemoryConfig({ providerId: e.target.value, model: '' })}>
              <option value="">用群成员的服务</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="整理模型" hint={memory.providerId ? '填写此服务实际可用的模型名；留空则沿用群成员的模型名。' : '当前沿用群成员的服务与模型；选择整理服务后可单独配置模型。'}>
          {(id) => <TextInput id={id} value={memory.providerId ? model : ''} disabled={!memory.providerId} onChange={(e) => setModel(e.target.value)} onBlur={commitModel} placeholder="例如：deepseek-chat" />}
        </Field>
      </div>
    </Section>
  )
}

// ---- 数据（TASK-008）----

function DataSection() {
  const [dir, setDir] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    void backend.dataDir().then(setDir).catch(() => setDir(''))
  }, [])
  const openDir = () => {
    setError('')
    void backend.openDataDir().catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }
  if (isDemo) return <Section title="数据" note="演示数据只保存在当前浏览器的本地存储中。使用顶部「重置演示」恢复示例；浏览器清理站点数据也会删除这些记录。"><p>模型连接和文件目录功能请使用桌面版。</p></Section>
  return (
    <Section title="数据" note="所有群聊、纪要和设置都保存在本机这个目录里。">
      <div className={styles.pathRow}>
        <span className={styles.pathValue} title={dir}>
          {dir || '读取中…'}
        </span>
        <Button variant="ghost" onClick={openDir}>
          在文件管理器中打开
        </Button>
      </div>
      {error && <p className={`${styles.testLine} ${styles.bad}`}>{error}</p>}
    </Section>
  )
}

// ---- 关于（TASK-008）----

function AboutSection() {
  const version = useChat((s) => s.version)
  return (
    <Section title="关于" note="AidoChat · 本地运行的 AI 群聊桌面应用。">
      <p className={styles.aboutText}>
        <span className={styles.version}>版本 {version || '—'}</span>
        <br />
        {isDemo ? "这是浏览器演示版，使用预设回复，不会调用模型。真实模型连接、系统钥匙串和本机目录功能请使用桌面版。" : "你的数据保存在本机。调用云端模型时，被 @ 成员的上下文（群规则、群纪要、近期聊天记录）会发送给该成员配置的模型服务；整理纪要时，新的讨论会发送给「整理模型」所在的服务。"}
      </p>
    </Section>
  )
}
