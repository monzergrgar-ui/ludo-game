import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import InstallPrompt from './components/InstallPrompt.tsx'
import UpdatePrompt from './components/UpdatePrompt.tsx'
import { initVoice } from './game/voice.ts'

// Recorded commentary listens on the same events the text layer used.
initVoice()

// The service worker is registered by UpdatePrompt's useRegisterSW hook, so
// the "new version ready" event has somewhere to surface.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Both banners share one bottom slot so they can never overlap. */}
    <div className="bottom-stack">
      <UpdatePrompt />
      <InstallPrompt />
    </div>
  </StrictMode>,
)
