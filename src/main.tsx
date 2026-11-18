import './i18n'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { registerSW } from 'virtual:pwa-register'

// A new version reloads the page as soon as it is installed; look for one whenever the app comes back to the screen
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update() })
    setInterval(() => reg.update(), 60 * 60 * 1000)
  },
})

// Chip rows scroll sideways: with a mouse wheel the vertical turn moves them left and right
// (the category row, the Looking for filter, mini item lists and segment bars)
const SIDEWAYS = '.cat-row, .chips, .mini-list, .seg'
document.addEventListener('wheel', e => {
  const row = (e.target as Element | null)?.closest?.(SIDEWAYS) as HTMLElement | null
  if (!row || row.scrollWidth <= row.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
  const max = row.scrollWidth - row.clientWidth
  if ((e.deltaY < 0 && row.scrollLeft <= 0) || (e.deltaY > 0 && row.scrollLeft >= max)) return
  row.scrollLeft += e.deltaY
  e.preventDefault()
}, { passive: false })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
