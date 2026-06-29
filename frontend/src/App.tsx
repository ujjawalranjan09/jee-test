import { useState, useEffect, useCallback } from "react";
import { useQuizSession } from "./hooks/useQuizSession";
import { useTheme } from "./hooks/useTheme";
import { getHealth } from "./api/client";
import { scoreQuiz } from "./utils/scoring";
import { getStreak } from "./utils/streaks";
import { hasSharedQuiz, decodeSharedQuiz } from "./utils/shareQuiz";
import { loadNotebook, type NotebookEntry } from "./utils/notebook";
import type { Quiz, QuizSession } from "./types";
import { UploadView } from "./components/Upload/UploadView";
import { QuizOptions } from "./components/Quiz/QuizOptions";
import { QuizPlayer } from "./components/Quiz/QuizPlayer";
import { ScoreView } from "./components/Score/ScoreView";
import { ReviewView } from "./components/Review/ReviewView";
import { HistoryView } from "./components/History/HistoryView";
import { LeaderboardView } from "./components/Leaderboard/LeaderboardView";
import { NotebookView } from "./components/Notebook/NotebookView";
import { AdminPanel } from "./components/Admin/AdminPanel";
import { PwaInstallPrompt } from "./components/PwaInstallPrompt";
import "./App.css";

type View =
  | "setup"
  | "quiz"
  | "score"
  | "review"
  | "history"
  | "leaderboard"
  | "notebook"
  | "admin";

export function App() {
  const session = useQuizSession();
  const { theme, toggleTheme } = useTheme();
  const [view, setView] = useState<View>("setup");
  const [score, setScore] = useState<ReturnType<typeof scoreQuiz> | null>(null);
  const [completedSession, setCompletedSession] = useState<QuizSession | null>(null);
  const [, setServerReady] = useState<boolean | null>(null);
  const [streak, setStreak] = useState(0);
  const [notebookEntries, setNotebookEntries] = useState<NotebookEntry[]>(() =>
    loadNotebook(),
  );
  const refreshNotebook = useCallback(
    () => setNotebookEntries(loadNotebook()),
    [],
  );

  // Load streak
  useEffect(() => {
    setStreak(getStreak());
  }, []);

  // Warm up backend on load
  useEffect(() => {
    getHealth()
      .then(() => setServerReady(true))
      .catch(() => setServerReady(false));
  }, []);

  // Detect admin URL route (e.g. http://localhost:5173/#admin) on load +
  // hashchange (so navigating via the browser URL bar / link works).
  useEffect(() => {
    const apply = () => {
      if (window.location.hash === "#admin") {
        setView("admin");
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  // Detect shared quiz in URL — run with default config (no lives / no timer).
  useEffect(() => {
    if (hasSharedQuiz()) {
      const sharedQuiz = decodeSharedQuiz();
              if (sharedQuiz) {
                // Shared quizzes use a minimal "no-lives, no-timer" config —
                // the sharer chose the settings, the receiver just answers.
                session.startSession(sharedQuiz, {
                  lives: { enabled: false, total: 3 },
                  timePerQuestion: { enabled: false, durationMinutes: 2 },
                  overallTime: { enabled: false, totalMinutes: 30 },
                  generationMode: "generate",
                });
                setView("quiz");
              }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleQuizReady = useCallback(
    (quiz: Quiz) => {
      session.startSession(quiz, session.config);
      setView("quiz");
    },
    [session],
  );

  // Auto-submit when lives run out.
  useEffect(() => {
    session.onSubmit(() => {
      if (session.session) {
        setCompletedSession(session.session);
        const result = scoreQuiz(session.session);
        setScore(result);
        setView("score");
      }
    });
  }, [session]);

  const handleSubmitQuiz = useCallback(() => {
    session.endSession();
    // Give React a tick to update session status
    setTimeout(() => {
      const currentSession = session.session;
      if (currentSession) {
        const endedSession: QuizSession = { ...currentSession, status: "ended" };
        setCompletedSession(endedSession);
        const result = scoreQuiz(endedSession);
        setScore(result);
        setView("score");
        // Refresh streak after quiz completion
        setStreak(getStreak());
      }
    }, 50);
  }, [session]);

  const handleReview = useCallback(() => {
    setView("review");
  }, []);

  const handleNewQuiz = useCallback(() => {
    setView("setup");
    setScore(null);
    setCompletedSession(null);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
            <path d="M8 7h6" />
            <path d="M8 11h8" />
          </svg>
          QuizForge
        </div>
        <nav className="app-header__nav">
          {/* Streak counter */}
          {streak > 0 && (
            <span className="app-header__streak" title={`${streak} day streak`}>
              🔥 {streak}
            </span>
          )}

          {/* Theme toggle */}
          <button
            className="btn-ghost app-header__theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          {/* Notebook entry — always visible so the user can browse their
              saved questions at any time, not just from Review.
              We deliberately do NOT show a numeric count badge here:
              the notebook is a destination, not a notification, and a
              red number makes it feel like an unread-message alarm. */}
          <button
            className="btn-ghost app-header__notebook-btn"
            onClick={() => setView("notebook")}
            aria-label="Open notebook"
            title="Notebook"
          >
            📓
          </button>

          {view !== "setup" && (
            <button className="btn-ghost" onClick={handleNewQuiz}>
              ← New Quiz
            </button>
          )}
        </nav>
      </header>

      <main className="app-main">
        {view === "setup" && (
          <div className="container">
            <QuizOptions
              config={session.config}
              onChange={session.updateConfig}
            />
            <UploadView
              onQuizReady={handleQuizReady}
              onShowHistory={() => setView("history")}
              onShowLeaderboard={() => setView("leaderboard")}
              generationMode={session.config.generationMode}
              onChangeGenerationMode={(mode) =>
                session.updateConfig({ generationMode: mode })
              }
            />
          </div>
        )}

        {view === "quiz" && session.session && (
          <QuizPlayer
            session={session.session}
            currentIdx={session.currentIdx}
            answers={session.session.answers}
            timerRemaining={session.timer.remaining}
            timerEnabled={session.session.config.timePerQuestion.enabled}
            overallTimerRemaining={session.overallTimer.remaining}
            overallTimerEnabled={session.session.config.overallTime.enabled}
            livesTotal={session.session.config.lives.enabled ? session.session.config.lives.total : 0}
            livesRemaining={session.livesRemaining}
            questionsAnswered={session.questionsAnswered}
            getQuestionStatus={session.getQuestionStatus}
            onSelectAnswer={session.selectAnswer}
            onSelectMultiple={session.selectMultipleAnswers}
            onSelectNumerical={session.selectNumericalAnswer}
            onToggleMark={session.toggleMarkForReview}
            onGoTo={session.goToQuestion}
            onNext={session.nextQuestion}
            onPrev={session.prevQuestion}
            onSubmit={handleSubmitQuiz}
          />
        )}

        {view === "score" && score && completedSession && (
          <ScoreView
            score={score}
            session={completedSession}
            onReview={handleReview}
            onNewQuiz={handleNewQuiz}
          />
        )}

        {view === "review" && completedSession && (
          <ReviewView
            session={completedSession}
            onNewQuiz={handleNewQuiz}
            onNotebookChanged={refreshNotebook}
            onOpenNotebook={() => setView("notebook")}
          />
        )}

        {view === "history" && (
          <HistoryView onBack={() => setView("setup")} />
        )}

        {view === "leaderboard" && (
          <LeaderboardView onBack={() => setView("setup")} />
        )}

        {view === "notebook" && (
          <NotebookView
            entries={notebookEntries}
            onBack={() => setView("setup")}
            onChange={setNotebookEntries}
          />
        )}

        {view === "admin" && (
          <AdminPanel onBack={() => setView("setup")} />
        )}
      </main>

      {/* PWA install toast — listens for beforeinstallprompt (Android/Chrome)
          and surfaces an iOS share-sheet hint for Safari users. */}
      <PwaInstallPrompt />
    </div>
  );
}
