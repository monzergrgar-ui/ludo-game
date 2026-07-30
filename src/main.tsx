import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import InstallPrompt from './components/InstallPrompt.tsx'

// Precached app shell; picks up a new build on the next visit.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <InstallPrompt />
  </StrictMode>,
)
