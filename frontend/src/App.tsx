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
  return (
    <div className={styles.welcome}>
      <span className={styles.welcomeMark}>议</span>
      <p className={styles.welcomeTitle}>把 AI 拉进同一个群</p>
      <p className={styles.welcomeText}>从左侧新建一个群，邀请几位成员，用 @ 点名开始讨论。</p>
    </div>
  )
}
