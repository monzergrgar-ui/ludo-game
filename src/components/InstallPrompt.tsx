import { useEffect, useState } from 'react';
import './InstallPrompt.css';

/** The non-standard event Chromium fires when the app is installable. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * "Add to Home Screen" banner using the standard beforeinstallprompt pattern.
 *
 * Deliberately not naggy: it appears once per session, only when the browser
 * says the app is actually installable, and dismissing it (or installing)
 * hides it for good. Nothing is persisted, so a later visit may offer it
 * again — that is the most a session-scoped, storage-free app can do.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // keep the browser's own mini-infobar out of the way
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!deferred || dismissed) return null;

  const install = async () => {
    setDismissed(true);
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      // The prompt can only be shown once; ignore a late/duplicate call.
    }
    setDeferred(null);
  };

  return (
    <div className="install-prompt" role="dialog" aria-label="Install Ludo">
      <img src="/pwa-192.png" alt="" className="install-icon" width={44} height={44} />
      <div className="install-text">
        <strong>Install Ludo</strong>
        <small>Add it to your home screen — plays offline.</small>
      </div>
      <button className="install-yes" onClick={install}>
        Install
      </button>
      <button
        className="install-no"
        onClick={() => setDismissed(true)}
        aria-label="Not now"
      >
        ✕
      </button>
    </div>
  );
}
