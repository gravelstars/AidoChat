import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/base.css'
import { App } from './App'
import { useChat } from './state/store'

void useChat.getState().init()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
