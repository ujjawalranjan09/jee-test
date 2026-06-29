import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary for the QuizForge app.
 *
 * Without this, any uncaught render error inside <App /> unmounts the entire
 * React tree and leaves the user staring at a blank page with no clue what
 * went wrong. This boundary catches the error, displays the message + a
 * one-click "Start Over" button, and keeps the page chrome (header) visible
 * so the user always has a way back to the upload screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error("[QuizForge] Uncaught render error:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
    // Best-effort: clear any sessionStorage state that may have put us here.
    try {
      sessionStorage.removeItem("qf_timer_enabled");
      sessionStorage.removeItem("qf_timer_duration");
    } catch {
      // ignore
    }
    // Reload to fully reset all hooks/state. Cheap and reliable.
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="app" data-testid="error-boundary">
          <header className="app-header">
            <div className="app-header__logo">QuizForge</div>
          </header>
          <main className="app-main">
            <div className="container">
              <div
                className="card upload-view__error-card"
                role="alert"
                style={{ marginTop: "2rem" }}
              >
                <h2 style={{ marginTop: 0 }}>Something went wrong</h2>
                <p>
                  The quiz player hit an unexpected error and had to stop.
                  Your PDF and selections are fine — this is a UI bug.
                </p>
                <pre
                  style={{
                    background: "var(--bg-elevated, #1e293b)",
                    padding: "0.75rem 1rem",
                    borderRadius: "0.5rem",
                    overflow: "auto",
                    maxHeight: "12rem",
                    fontSize: "0.85rem",
                  }}
                >
                  {this.state.error.message}
                </pre>
                <button
                  className="btn-primary"
                  onClick={this.handleReset}
                  style={{ marginTop: "1rem" }}
                >
                  Start over
                </button>
              </div>
            </div>
          </main>
        </div>
      );
    }
    return this.props.children;
  }
}