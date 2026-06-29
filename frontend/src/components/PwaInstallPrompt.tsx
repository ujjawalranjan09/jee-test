import { useEffect, useState } from "react";
import "./PwaInstallPrompt.css";

/**
 * Android/Chrome `beforeinstallprompt` listener — shows a small toast at the
 * bottom of the screen offering "Install QuizForge". When the user taps
 * Install, we call `prompt()` on the deferred event, which resolves with the
 * user's choice (accepted | dismissed). On iOS this API is not available —
 * users must use Safari's "Add to Home Screen" share sheet instead, so we
 * surface an iOS-specific helper banner.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const STORAGE_KEY = "qf_pwa_install_dismissed_v1";
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function PwaInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [iosBanner, setIosBanner] = useState(false);
  const [visible, setVisible] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // The user already dismissed the toast recently — don't pester.
    try {
      const ts = localStorage.getItem(STORAGE_KEY);
      if (ts && Date.now() - Number(ts) < DISMISS_DURATION_MS) return;
    } catch {
      /* localStorage unavailable; show the prompt */
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // Detect iOS Safari — these devices don't fire beforeinstallprompt
    // but still support "Add to Home Screen" from the share sheet.
    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    let standalone = false;
    if (typeof window.matchMedia === "function") {
      standalone = window.matchMedia("(display-mode: standalone)").matches;
    }
    // Safari-only navigator.standalone (set when launched from Home Screen).
    const nav = window.navigator as Navigator & { standalone?: boolean };
    if (nav.standalone === true) standalone = true;
    if (isIos && !standalone) setIosBanner(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setVisible(false);
    setIosBanner(false);
  };

  const onInstall = async () => {
    if (!deferred) return;
    setVisible(false);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
    } catch (err) {
      console.warn("[QuizForge] install prompt failed:", err);
    } finally {
      setDeferred(null);
    }
  };

  if (!visible && !iosBanner) return null;

  return (
    <>
      {visible && (
        <div className="pwa-install" role="region" aria-label="Install app">
          <div className="pwa-install__inner">
            <img
              src="/icon-192.png"
              alt=""
              className="pwa-install__icon"
              width={48}
              height={48}
            />
            <div className="pwa-install__body">
              <p className="pwa-install__title">Install QuizForge</p>
              <p className="pwa-install__hint">
                Add to your home screen for full-screen quizzes and offline
                access.
              </p>
            </div>
            <button
              type="button"
              className="btn-secondary pwa-install__install"
              onClick={onInstall}
            >
              Install
            </button>
            <button
              type="button"
              className="pwa-install__close"
              onClick={dismiss}
              aria-label="Dismiss install prompt"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {iosBanner && (
        <div className="pwa-install" role="region" aria-label="Install app">
          <div className="pwa-install__inner">
            <img
              src="/icon-192.png"
              alt=""
              className="pwa-install__icon"
              width={48}
              height={48}
            />
            <div className="pwa-install__body">
              <p className="pwa-install__title">Add to Home Screen</p>
              <p className="pwa-install__hint">
                Tap <strong>Share</strong> then
                <strong> Add to Home Screen</strong> to install.
              </p>
            </div>
            <button
              type="button"
              className="pwa-install__close"
              onClick={dismiss}
              aria-label="Dismiss install hint"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}