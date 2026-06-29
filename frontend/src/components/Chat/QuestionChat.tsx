import { useState, useRef, useEffect, useCallback, type FormEvent } from "react";
import { chatQuestion } from "../../api/client";
import type { Question, Diagram, ChatMessage } from "../../types";
import { Markdown } from "../../utils/markdown";
import "./QuestionChat.css";

interface Props {
  question: Question;
  diagramMap: Record<string, Diagram>;
}

// Per-question message history (persists while page is open)
const chatHistory = new Map<string, ChatMessage[]>();

export function QuestionChat({ question, diagramMap }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    chatHistory.get(question.id) ?? [],
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Persist history
  useEffect(() => {
    chatHistory.set(question.id, messages);
  }, [question.id, messages]);

  const handleSend = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError("");

      const trimmed = input.trim();
      if (!trimmed || trimmed.length > 4000) {
        setError("Message must be between 1 and 4000 characters.");
        return;
      }

      const userMsg: ChatMessage = {
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };

      const newMessages = [...messages, userMsg];
      setMessages(newMessages);
      setInput("");
      setLoading(true);

      try {
        // Send last 20 messages
        const recent = newMessages.slice(-20).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const diagrams = question.diagramIds
          .map((dId) => diagramMap[dId])
          .filter((d): d is Diagram => Boolean(d));

        const result = await chatQuestion(
          question.prompt,
          question.options,
          diagrams,
          recent,
          trimmed,
        );

        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: result.reply,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err: unknown) {
        if (err instanceof Error) {
          if (err.name === "AbortError") {
            setError("Request timed out. Please try again.");
          } else {
            setError(err.message);
          }
        } else {
          setError("Failed to get response.");
        }
      } finally {
        setLoading(false);
      }
    },
    [input, messages, question, diagramMap],
  );

  // Keep input visible when keyboard opens
  const handleFocus = () => {
    setTimeout(() => {
      inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
  };

  return (
    <div className="question-chat">
      <div className="question-chat__messages" role="log" aria-label="Chat messages">
        {messages.length === 0 && (
          <p className="question-chat__empty">
            Ask a follow-up question about this problem.
          </p>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`question-chat__msg question-chat__msg--${msg.role}`}
          >
            <div className="question-chat__msg-content">
              {/* User messages are plain text (what they typed);
                  assistant messages may contain markdown + LaTeX. */}
              {msg.role === "assistant" ? (
                <Markdown source={msg.content} />
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="question-chat__msg question-chat__msg--assistant question-chat__msg--loading">
            <div className="spinner" />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="question-chat__error" role="alert">
          {error}
          <button className="btn-ghost" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}

      <form className="question-chat__form" onSubmit={handleSend}>
        <textarea
          ref={inputRef}
          className="question-chat__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={handleFocus}
          placeholder="Ask about this question…"
          rows={2}
          maxLength={4000}
          disabled={loading}
          aria-label="Type your follow-up question"
        />
        <button
          type="submit"
          className="btn-primary question-chat__send"
          disabled={loading || !input.trim()}
          aria-label="Send message"
        >
          Send
        </button>
      </form>
    </div>
  );
}
