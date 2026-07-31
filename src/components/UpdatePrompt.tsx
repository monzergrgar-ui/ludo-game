import { useRegisterSW } from 'virtual:pwa-register/react';
import './UpdatePrompt.css';

/**
 * "New version available" banner.
 *
 * The service worker is registered in `prompt` mode, so a freshly deployed
 * build installs but stays in the waiting state rather than swapping itself in
 * mid-game. This surfaces that moment: tapping activates the waiting worker
 * (skipWaiting) and reloads, so the player doesn't have to force-close the app.
 *
 * Ignoring it costs nothing — the waiting worker takes over by itself once
 * every tab/window is closed, so the next launch is already up to date.
 */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <button
      className="update-prompt"
      onClick={() => updateServiceWorker(true)}
      aria-live="polite"
    >
      <span className="update-dot" aria-hidden="true" />
      <span className="update-text">
        New version available — <strong>tap to update</strong>
      </span>
    </button>
  );
}
