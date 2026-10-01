import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useGameStore } from './stores/gameStore'
import { useUIStore } from './stores/uiStore'
import { colyseusService } from './services/ColyseusService'
import { usePendingStore } from './game/pendingAction'
import { useValidActionsStore } from './game/validActions'
import { warmUpAudio } from './audio/sfx'

// 浏览器要求 AudioContext 必须在用户手势中创建/恢复。
// 首次交互时建好，避免第一声音效有延迟或被丢掉。
window.addEventListener('pointerdown', warmUpAudio, { once: true })
window.addEventListener('keydown', warmUpAudio, { once: true })

// 仅开发构建：把 store 挂到 window，便于在控制台直接跳到任意局面调试。
// 生产构建里 import.meta.env.DEV 为 false，这段会被 tree-shake 掉。
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__game = useGameStore
  ;(window as unknown as Record<string, unknown>).__ui = useUIStore
  // 网络服务也挂上：调试联网问题时可以直接在控制台发指令 / 存读局面
  ;(window as unknown as Record<string, unknown>).__svc = colyseusService
  ;(window as unknown as Record<string, unknown>).__pending = usePendingStore
  ;(window as unknown as Record<string, unknown>).__valid = useValidActionsStore
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
