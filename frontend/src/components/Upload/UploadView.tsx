import { useState, useEffect, useRef, useCallback, type DragEvent } from "react";
import { uploadPdf, uploadMultiplePdfs, generateQuiz, extractQuiz } from "../../api/client";
import type { Quiz, Diagram } from "../../types";
import "./UploadView.css";

interface Props {
  onQuizReady: (quiz: Quiz) => void;
  onShowHistory?: () => void;
  onShowLeaderboard?: () => void;
  /** "exact" = call /quiz/extract (verbatim from PDF).
   *  "generate" = call /quiz/generate (LLM synthesises new MCQs). */
  generationMode: "exact" | "generate";
  /** Optional callback to switch the question source without leaving
   *  the upload screen — surfaced as a recovery button when "exact"
   *  fails on a metadata-only PDF. */
  onChangeGenerationMode?: (next: "exact" | "generate") => void;
}

const MAX_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES = 10;

export type NumQuestionsInputProps = {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  defaultValue?: number;
};

export function NumQuestionsInput({
  value,
  onChange,
  min = 1,
  max = 500,
  defaultValue = 10,
}: NumQuestionsInputProps) {
  // The "All" sentinel (-1) bypasses the clamp so the value reaches
  // the backend intact. We render it as the placeholder text instead
  // of as a literal "-1".
  const isAll = value === -1;
  const [draft, setDraft] = useState<string>(isAll ? "" : String(value));

  // Keep the visible draft in sync if the value changes externally
  // (e.g. when a parent resets it on a new upload, or toggles "All").
  useEffect(() => {
    setDraft(isAll ? "" : String(value));
  }, [value, isAll]);
  const commit = (raw: string) => {
    // Allow empty / non-numeric to fall back to the default.
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      onChange(defaultValue);
      setDraft(String(defaultValue));
      return;
    }
    const clamped = Math.max(min, Math.min(max, parsed));
    if (clamped !== value) onChange(clamped);
    // Snap the visible text back to the clamped value so the user sees
    // what was actually accepted (e.g. "9999" → "500").
    if (String(clamped) !== raw) setDraft(String(clamped));
  };
  const step = (delta: number) => {
    // Stepping from "All" lands on defaultValue + delta (so users get
    // a concrete number to edit instead of getting stuck at -1).
    const base = value === -1 ? defaultValue : value || defaultValue;
    const next = Math.max(min, Math.min(max, base + delta));
    onChange(next);
    setDraft(String(next));
  };

  return (
    <div className="upload-view__num-input">
      <button
        type="button"
        className="upload-view__num-btn"
        onClick={() => step(-1)}
        disabled={value <= min}
        aria-label="Decrease number of questions"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        className="upload-view__num-field"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label="Number of questions"
        placeholder={isAll ? "All" : String(defaultValue)}
      />
      <button
        type="button"
        className="upload-view__num-btn"
        onClick={() => step(1)}
        disabled={value >= max}
        aria-label="Increase number of questions"
      >
        +
      </button>
    </div>
  );
}

export function UploadView({
  onQuizReady,
  onShowHistory,
  onShowLeaderboard,
  generationMode,
  onChangeGenerationMode,
}: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  // Soft notice shown after we auto-recover from an empty "exact" extract by
  // silently retrying in "generate" mode. Cleared on the next successful
  // generate, or the next error. Lets the student know why the questions they
  // see don't exactly match the PDF.
  const [autoRecovered, setAutoRecovered] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "uploading" | "generating" | "error"
  >("idle");
  const [progress, setProgress] = useState("");
  const [dragging, setDragging] = useState(false);
  const [warmUpNotice, setWarmUpNotice] = useState(false);
  // Difficulty is always "mixed" now — the per-mode UI was removed.
  const [numQuestions, setNumQuestions] = useState<number>(10);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against an infinite auto-recover loop if "generate" ALSO returns 0
  // for the same PDF (e.g. truly empty / corrupt file). We attempt the fallback
  // once per Generate click; if it also fails we surface the error.
  const fallbackTriedRef = useRef(false);

  const validateFile = (f: File): string | null => {
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      return "Only PDF files are accepted.";
    }
    if (f.size > MAX_SIZE) {
      return `File too large (${(f.size / 1024 / 1024).toFixed(1)}MB). Maximum is 20MB.`;
    }
    return null;
  };

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    const valid: File[] = [];
    for (const f of arr) {
      const err = validateFile(f);
      if (err) {
        setError(err);
        return;
      }
      valid.push(f);
    }
    setError("");
    setFiles((prev) => {
      const combined = [...prev, ...valid];
      if (combined.length > MAX_FILES) {
        setError(`Maximum ${MAX_FILES} files allowed.`);
        return prev;
      }
      return combined;
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
      }
    },
    [addFiles],
  );

  const handleGenerate = async () => {
    if (files.length === 0) return;

    setPhase("uploading");
    setProgress(
      files.length === 1
        ? "Uploading PDF…"
        : `Uploading ${files.length} PDFs…`,
    );
    setError("");
    setAutoRecovered(false);
    fallbackTriedRef.current = false;
    setWarmUpNotice(false);

    try {
      fetch("/api/health").catch(() => {});

      let allText = "";
      let allDiagrams: Diagram[] = [];
      let allPages: string[] = [];
      let allPageLayouts: unknown[] = [];

      if (files.length === 1) {
        const { text, diagrams, pages, pageLayouts } = await uploadPdf(files[0]!);
        allText = text;
        allDiagrams = diagrams;
        allPages = pages;
        allPageLayouts = pageLayouts;
      } else {
        setProgress(`Uploading ${files.length} PDFs…`);
        const { text, diagrams } = await uploadMultiplePdfs(files);
        allText = text;
        allDiagrams = diagrams;
      }

      setPhase("generating");
      setProgress("Generating quiz questions… This may take a moment.");

      setWarmUpNotice(true);

      // Difficulty is always "mixed" now — send undefined so the backend
      // uses its default ("mixed"), which gives the student a useful mix.
      const diffParam: string | undefined = undefined;
      // Generous timeout: a large multimodal payload (e.g. 30 PDF pages as
      // images) can take several minutes to process on the LLM side. The
      // backend itself enforces PROCESSING_TIMEOUT_SECONDS as a hard ceiling.
      let quiz: Quiz;
      if (generationMode === "exact") {
        quiz = await extractQuiz(allText, allDiagrams, 600_000, numQuestions, allPages, allPageLayouts);
      } else {
        quiz = await generateQuiz(allText, allDiagrams, 600_000, diffParam, numQuestions);
      }

      // Auto-recover: if "exact" mode found no extractable MCQ text
      // (typically a metadata-only PDF like an NTA exam-paper export),
      // silently retry in "generate" mode rather than failing the user.
      // The student gets questions either way; we surface a soft amber
      // notice explaining why the questions don't match the PDF word-for-word.
      if (
        (!quiz.questions || quiz.questions.length === 0) &&
        generationMode === "exact" &&
        !fallbackTriedRef.current &&
        onChangeGenerationMode
      ) {
        fallbackTriedRef.current = true;
        onChangeGenerationMode("generate");
        setProgress("PDF had no extractable MCQ text — inventing new questions on the same topics…");
        quiz = await generateQuiz(allText, allDiagrams, 600_000, diffParam, numQuestions);
        if (quiz.questions && quiz.questions.length > 0) {
          setAutoRecovered(true);
        }
      }

      setWarmUpNotice(false);

      if (!quiz.questions || quiz.questions.length === 0) {
        // Both paths returned nothing — surface a clear, actionable error.
        // For "exact" we still offer the manual one-click switch in case the
        // user wants to try again deliberately.
        if (generationMode === "exact") {
          setPhase("error");
          setError(
            "Couldn't find any extractable MCQ text in this PDF. " +
              "The file may be a metadata-only export (question IDs and " +
              "structure without the actual question wording). Try " +
              "“Generate new” instead — the AI will invent MCQs on the " +
              "same topics.",
          );
          return;
        }
        // "generate" mode failure — surface whatever the backend told us.
        const detail =
          (quiz as unknown as { error?: { message?: string } })?.error?.message;
        throw new Error(
          detail ||
            "No questions were generated from this PDF. The backend returned an empty quiz.",
        );
      }

      onQuizReady(quiz);
    } catch (err: unknown) {
      setPhase("error");
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          setError("Request timed out. The server may be waking up — please try again.");
        } else {
          setError(err.message);
        }
      } else {
        setError("An unexpected error occurred.");
      }
    }
  };

  const isProcessing = phase === "uploading" || phase === "generating";

  return (
    <div className="upload-view">
      <div className="container">
        <div className="upload-view__hero">
          <h1 className="upload-view__title">QuizForge</h1>
          <p className="upload-view__subtitle">
            Upload PDF{files.length !== 1 ? "s" : ""} and generate an interactive quiz in seconds.
          </p>
        </div>

        {/* Action buttons */}
        <div className="upload-view__actions">
          {onShowHistory && (
            <button className="btn-secondary upload-view__action-btn" onClick={onShowHistory}>
              📊 History
            </button>
          )}
          {onShowLeaderboard && (
            <button className="btn-secondary upload-view__action-btn" onClick={onShowLeaderboard}>
              🏆 Leaderboard
            </button>
          )}
        </div>

        {/* Number of Questions — typed input with +/− steppers. In exact mode
            there's also an "All" shortcut that extracts every question in the
            PDF (capped at a safety ceiling server-side). */}
        <div className="upload-view__difficulty">
          <label className="upload-view__difficulty-label">
            Number of Questions
          </label>
          <p className="upload-view__difficulty-hint">
            {generationMode === "exact"
              ? "Type any number between 1 and 500, or click All to extract every question in the PDF."
              : "Type any number between 1 and 500."}
          </p>
          <div className="upload-view__num-row">
            <NumQuestionsInput
              value={numQuestions}
              onChange={setNumQuestions}
              min={1}
              max={500}
              defaultValue={10}
            />
            {generationMode === "exact" && (
              <button
                type="button"
                className={`upload-view__all-btn ${numQuestions === -1 ? "upload-view__all-btn--active" : ""}`}
                onClick={() => setNumQuestions(-1)}
                title="Extract every question in the PDF (capped at 200)"
                aria-pressed={numQuestions === -1}
              >
                All
              </button>
            )}
          </div>
          {numQuestions === -1 && (
            <p className="upload-view__difficulty-hint upload-view__all-hint">
              All questions in this PDF will be extracted.
            </p>
          )}
        </div>

        {/* Dropzone */}
        <div
          className={`upload-view__dropzone ${dragging ? "upload-view__dropzone--active" : ""} ${files.length > 0 ? "upload-view__dropzone--has-file" : ""}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          aria-label="Drop PDF files here or click to browse"
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf"
            multiple
            onChange={handleInputChange}
            className="sr-only"
            tabIndex={-1}
          />

          {files.length > 0 ? (
            <div className="upload-view__file-list">
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} className="upload-view__file-info">
                  <span className="upload-view__file-icon">📄</span>
                  <span className="upload-view__file-name">{f.name}</span>
                  <span className="upload-view__file-size">
                    {(f.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <button
                    className="btn-ghost upload-view__file-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(i);
                    }}
                    aria-label={`Remove ${f.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {files.length < MAX_FILES && (
                <p className="upload-view__add-more">Click or drop to add more files</p>
              )}
            </div>
          ) : (
            <div className="upload-view__prompt">
              <span className="upload-view__icon">↑</span>
              <span className="upload-view__prompt-text">
                Drop PDF here or <strong>click to browse</strong>
              </span>
              <span className="upload-view__prompt-hint">
                Maximum file size: 20MB · Up to {MAX_FILES} files
              </span>
            </div>
          )}
        </div>

        {error && (
          <div className="alert alert--error" role="alert">
            {error}
            {generationMode === "exact" && onChangeGenerationMode && (
              <button
                type="button"
                className="alert__action"
                onClick={() => {
                  setError("");
                  setAutoRecovered(false);
                  onChangeGenerationMode("generate");
                  // Auto-retry with the new mode.
                  // (Slight delay so React commits the state flip first.)
                  setTimeout(() => handleGenerate(), 50);
                }}
              >
                Switch to Generate new ↻
              </button>
            )}
          </div>
        )}

        {autoRecovered && !error && (
          <div className="alert alert--notice" role="status">
            <strong>Heads up:</strong> this PDF doesn't have readable MCQ
            text, so QuizForge invented fresh questions on the same topics
            for you. Switch to <em>Generate new</em> in the options above to
            skip the extract attempt next time.
          </div>
        )}

        {isProcessing && (
          <div className="upload-view__progress">
            <div className="spinner" />
            <span>{progress}</span>
            {warmUpNotice && (
              <p className="upload-view__warmup">
                First request may take longer while the server wakes up…
              </p>
            )}
          </div>
        )}

        <button
          className="btn-primary upload-view__generate-btn"
          disabled={files.length === 0 || isProcessing}
          onClick={handleGenerate}
        >
          {isProcessing ? "Working…" : "Generate Quiz"}
        </button>
      </div>
    </div>
  );
}
