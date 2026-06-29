/**
 * Secret admin panel — live LLM key rotation + provider switch.
 *
 * URL: http://localhost:5173/#admin
 *
 * No auth — this is a local dev tool. The "secret" is the URL.
 *
 * Backed by 4 backend endpoints:
 *   GET  /api/admin/overview     — current provider + masked keys
 *   PUT  /api/admin/keys         — replace key (persists to backend/.env
 *                                  AND hot-reloads the running process)
 *   POST /api/admin/provider     — switch provider
 *   POST /api/admin/test         — verify a key works without saving it
 */

import { useCallback, useEffect, useState } from "react";
import {
  getAdminOverview,
  updateAdminKey,
  switchAdminProvider,
  testAdminKey,
  type AdminOverview,
  type AdminKeyView,
} from "../../api/client";
import "./AdminPanel.css";

interface Props {
  onBack: () => void;
}

type Provider = "gemini" | "minimax";

export function AdminPanel({ onBack }: Props) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Provider | null>(null);
  const [testing, setTesting] = useState<Provider | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const [keyDraft, setKeyDraft] = useState<Record<Provider, string>>({
    gemini: "",
    minimax: "",
  });

  // Load current config on mount.
  useEffect(() => {
    let cancelled = false;
    getAdminOverview()
      .then((data) => {
        if (!cancelled) {
          setOverview(data);
          setLoadError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(String(err?.message ?? err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = useCallback(
    async (provider: Provider) => {
      const value = keyDraft[provider].trim();
      if (!value) {
        setFeedback({ kind: "err", text: "Key value cannot be empty." });
        return;
      }
      setSaving(provider);
      setFeedback(null);
      try {
        await updateAdminKey(provider, value);
        // Refresh overview to show the new masked key.
        const fresh = await getAdminOverview();
        setOverview(fresh);
        // Clear the draft so the field is empty for the next paste.
        setKeyDraft((prev) => ({ ...prev, [provider]: "" }));
        setFeedback({
          kind: "ok",
          text: `${providerLabel(provider)} key saved. Next quiz call uses it.`,
        });
      } catch (err) {
        setFeedback({
          kind: "err",
          text: `Save failed: ${errMsg(err)}`,
        });
      } finally {
        setSaving(null);
      }
    },
    [keyDraft],
  );

  const handleTest = useCallback(
    async (provider: Provider) => {
      const value = keyDraft[provider].trim();
      if (!value) {
        setFeedback({ kind: "err", text: "Type a key first to test it." });
        return;
      }
      setTesting(provider);
      setFeedback(null);
      try {
        const res = await testAdminKey(provider, value);
        if (res.ok) {
          setFeedback({
            kind: "ok",
            text: `Key works. (${res.message})`,
          });
        } else {
          setFeedback({
            kind: "err",
            text: `Key failed: ${res.message}`,
          });
        }
      } catch (err) {
        setFeedback({ kind: "err", text: `Test failed: ${errMsg(err)}` });
      } finally {
        setTesting(null);
      }
    },
    [keyDraft],
  );

  const handleSwitchProvider = useCallback(
    async (provider: Provider) => {
      setFeedback(null);
      try {
        await switchAdminProvider(provider);
        const fresh = await getAdminOverview();
        setOverview(fresh);
        setFeedback({
          kind: "ok",
          text: `Switched to ${providerLabel(provider)}.`,
        });
      } catch (err) {
        setFeedback({ kind: "err", text: `Switch failed: ${errMsg(err)}` });
      }
    },
    [],
  );

  if (loadError) {
    return (
      <div className="admin-panel">
        <header className="admin-panel__header">
          <h2 className="admin-panel__title">Admin · API keys</h2>
          <button className="btn-ghost" onClick={onBack}>
            ← Back
          </button>
        </header>
        <div className="admin-panel__error">
          Could not reach backend: <code>{loadError}</code>
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="admin-panel">
        <header className="admin-panel__header">
          <h2 className="admin-panel__title">Admin · API keys</h2>
          <button className="btn-ghost" onClick={onBack}>
            ← Back
          </button>
        </header>
        <div className="admin-panel__loading">Loading…</div>
      </div>
    );
  }

  const activeProvider = overview.active_provider;
  const providers: Provider[] = ["gemini", "minimax"];

  return (
    <div className="admin-panel">
      <header className="admin-panel__header">
        <h2 className="admin-panel__title">Admin · API keys</h2>
        <button className="btn-ghost" onClick={onBack}>
          ← Back
        </button>
      </header>

      <p className="admin-panel__intro">
        Rotate the LLM API key without restarting the backend. Changes are
        written to <code>backend/.env</code> and applied to the running process
        immediately. Pick a single key, or comma-separate multiple keys to
        rotate across them on rate-limit.
      </p>

      <section className="admin-panel__provider-bar">
        <span className="admin-panel__provider-label">Active provider:</span>
        <div className="admin-panel__provider-buttons">
          {providers.map((p) => {
            const isActive = p === activeProvider;
            return (
              <button
                key={p}
                className={`btn-ghost admin-panel__provider-btn ${
                  isActive ? "admin-panel__provider-btn--active" : ""
                }`}
                disabled={isActive}
                onClick={() => handleSwitchProvider(p)}
                title={
                  isActive
                    ? "Currently active"
                    : `Click to switch to ${providerLabel(p)}`
                }
              >
                {providerLabel(p)} {isActive && "✓"}
              </button>
            );
          })}
        </div>
      </section>

      {providers.map((p) => {
        const view = overview[p];
        const draft = keyDraft[p];
        const isSaving = saving === p;
        const isTesting = testing === p;
        const isActive = p === activeProvider;
        return (
          <section
            key={p}
            className={`admin-panel__card ${
              isActive ? "admin-panel__card--active" : ""
            }`}
          >
            <div className="admin-panel__card-head">
              <h3>{providerLabel(p)}</h3>
              <span className="admin-panel__card-meta">
                {view.key_count} key{view.key_count === 1 ? "" : "s"} ·{" "}
                {isActive ? "active" : "inactive"}
              </span>
            </div>

            <div className="admin-panel__current">
              <span className="admin-panel__current-label">Current</span>
              <code className="admin-panel__current-value">
                {view.masked_key || <em>(empty)</em>}
              </code>
            </div>

            <label className="admin-panel__field">
              <span className="admin-panel__field-label">
                New key (paste one, or comma-separate multiple)
              </span>
              <input
                type="password"
                className="admin-panel__input"
                placeholder={`Paste new ${providerLabel(p)} key…`}
                value={draft}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) =>
                  setKeyDraft((prev) => ({ ...prev, [p]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isSaving) {
                    void handleSave(p);
                  }
                }}
              />
            </label>

            <div className="admin-panel__actions">
              <button
                className="btn-secondary"
                disabled={isTesting || !draft.trim()}
                onClick={() => handleTest(p)}
              >
                {isTesting ? "Testing…" : "Test"}
              </button>
              <button
                className="btn-primary"
                disabled={isSaving || !draft.trim()}
                onClick={() => handleSave(p)}
              >
                {isSaving ? "Saving…" : "Save & use"}
              </button>
            </div>
          </section>
        );
      })}

      {feedback && (
        <div
          className={`admin-panel__feedback admin-panel__feedback--${feedback.kind}`}
          role={feedback.kind === "err" ? "alert" : "status"}
        >
          {feedback.text}
        </div>
      )}
    </div>
  );
}

function providerLabel(p: Provider): string {
  return p === "gemini" ? "Gemini" : "MiniMax (Xiaomi MiMo)";
}

function errMsg(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

// Helper used in tests — silence the unused warning when not in tests.
export type { AdminKeyView };