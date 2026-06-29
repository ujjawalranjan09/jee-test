import { useState } from "react";
import type { Quiz } from "../../types";
import { buildShareUrl, copyToClipboard } from "../../utils/shareQuiz";
import "./ShareQuiz.css";

interface Props {
  quiz: Quiz;
}

export function ShareQuiz({ quiz }: Props) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const handleShare = async () => {
    setError("");
    const url = buildShareUrl(quiz);

    const ok = await copyToClipboard(url);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } else {
      setError("Could not copy to clipboard. URL is in the address bar.");
      // At least update the address bar
      window.location.hash = url.split("#")[1] ?? "";
    }
  };

  const questionCount = quiz.questions.length;

  return (
    <div className="share-quiz">
      <button
        className="btn-secondary share-quiz__btn"
        onClick={handleShare}
        title="Copy a shareable link to this quiz"
      >
        {copied ? "✓ Link Copied!" : "🔗 Share Quiz"}
      </button>
      {copied && (
        <span className="share-quiz__note">
          Link copied! Anyone can take this quiz ({questionCount} questions, no diagrams).
        </span>
      )}
      {error && (
        <span className="share-quiz__error">{error}</span>
      )}
    </div>
  );
}
