import appIcon from './assets/aidochat.svg'
import { Dialog } from './components/Dialog'
import { Button } from './components/Button'
import { ChatView } from './features/chat/ChatView'
import { MemoryPanel } from './features/memory/MemoryPanel'
import { MembersView } from './features/members/MembersView'
import { Rail } from './features/rail/Rail'
import { SettingsView } from './features/settings/SettingsView'
import { WindowControls } from './features/shell/WindowControls'
import { useActive, useChat } from './state/store'
import styles from './App.module.css'

export function App() {
  const ready = useChat((s) => s.ready)
  const error = useChat((s) => s.error)
  const view = useChat((s) => s.view)
  const members = useChat((s) => s.members)
  const memoryOpen = useChat((s) => s.memoryOpen)
  const active = useActive()

  if (error && !ready) return <div className={styles.boot}>启动失败：{error}</div>
  if (!ready) return <div className={styles.boot} aria-busy="true" />

  return (
    <div className={styles.app}>
      <Rail />
      <main className={styles.main}>
        {view === 'chat' && active && <ChatView state={active} members={members} />}
        {view === 'chat' && !active && <Welcome />}
        {view === 'members' && <MembersView />}
        {view === 'settings' && <SettingsView />}
      </main>
      {view === 'chat' && active && memoryOpen && <MemoryPanel state={active} members={members} />}
      <WindowControls />
      <Dialog open={!!error} title="操作未完成" onClose={() => useChat.setState({ error: null })}
        footer={<Button onClick={() => useChat.setState({ error: null })}>知道了</Button>}>
        <p role="alert">{error}</p>
      </Dialog>
    </div>
  )
}

function Welcome() {
  const setView = useChat((s) => s.setView)
  return (
    <div className={styles.welcome}>
      <img className={styles.welcomeMark} src={appIcon} alt="AidoChat" />
      <p className={styles.welcomeTitle}>把 AI 拉进同一个群</p>
      <p className={styles.welcomeText}>先配置模型服务和成员，再从左侧新建群，用 @ 点名开始讨论。</p>
      <div className={styles.welcomeAction}><Button variant="primary" onClick={() => setView('members')}>配置成员与模型服务</Button></div>
    </div>
  )
}
