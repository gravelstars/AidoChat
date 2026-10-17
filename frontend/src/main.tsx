import { isDemo } from './demo/storage'
import { DemoRoot } from './demo/DemoRoot'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/base.css'
import { App } from './App'
import { useChat } from './state/store'

if (isDemo) {
  const policy = document.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "connect-src 'self'; img-src 'self' data: blob:; media-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'"
  document.head.append(policy)
} else void useChat.getState().init()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDemo ? <DemoRoot /> : <App />}
  </StrictMode>,
)
