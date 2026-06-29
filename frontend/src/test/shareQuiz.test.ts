import { describe, it, expect, beforeEach } from "vitest";
import {
  encodeQuizForShare,
  buildShareUrl,
  hasSharedQuiz,
  decodeSharedQuiz,
} from "../utils/shareQuiz";
import type { Quiz } from "../types";

const mockQuiz: Quiz = {
  id: "quiz-1",
  questions: [
    {
      id: "q1",
      prompt: "What is 2+2?",
      options: [
        { id: "A", text: "3" },
        { id: "B", text: "4" },
        { id: "C", text: "5" },
        { id: "D", text: "6" },
      ],
      correctAnswerId: "B",
      diagramIds: ["d1"],
    },
    {
      id: "q2",
      prompt: "Capital of France?",
      options: [
        { id: "A", text: "London" },
        { id: "B", text: "Paris" },
        { id: "C", text: "Berlin" },
        { id: "D", text: "Madrid" },
      ],
      correctAnswerId: "B",
      diagramIds: [],
    },
  ],
  diagrams: {
    d1: { id: "d1", page: 1, imageData: "base64data..." },
  },
};

beforeEach(() => {
  window.location.hash = "";
});

describe("shareQuiz", () => {
  describe("encodeQuizForShare", () => {
    it("returns a non-empty string", () => {
      const encoded = encodeQuizForShare(mockQuiz);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it("strips diagram image data", () => {
      const encoded = encodeQuizForShare(mockQuiz);
      const json = decodeURIComponent(escape(atob(encoded)));
      const parsed = JSON.parse(json);
      expect(Object.keys(parsed.quiz.diagrams)).toHaveLength(0);
    });

    it("preserves question content", () => {
      const encoded = encodeQuizForShare(mockQuiz);
      const json = decodeURIComponent(escape(atob(encoded)));
      const parsed = JSON.parse(json);
      expect(parsed.quiz.questions).toHaveLength(2);
      expect(parsed.quiz.questions[0].prompt).toBe("What is 2+2?");
    });
  });

  describe("buildShareUrl", () => {
    it("returns a URL with quiz hash", () => {
      const url = buildShareUrl(mockQuiz);
      expect(url).toContain("#quiz=");
      expect(url).toContain(window.location.origin);
    });
  });

  describe("hasSharedQuiz", () => {
    it("returns false when no hash", () => {
      expect(hasSharedQuiz()).toBe(false);
    });

    it("returns true when hash starts with #quiz=", () => {
      window.location.hash = "#quiz=abc123";
      expect(hasSharedQuiz()).toBe(true);
    });
  });

  describe("decodeSharedQuiz", () => {
    it("returns null when no hash", () => {
      expect(decodeSharedQuiz()).toBeNull();
    });

    it("returns null for invalid hash", () => {
      window.location.hash = "#quiz=not-valid-base64!!!";
      expect(decodeSharedQuiz()).toBeNull();
    });

    it("roundtrips encode -> decode", () => {
      const encoded = encodeQuizForShare(mockQuiz);
      window.location.hash = `#quiz=${encoded}`;
      const decoded = decodeSharedQuiz();
      expect(decoded).not.toBeNull();
      expect(decoded!.questions).toHaveLength(2);
      expect(decoded!.questions[0].prompt).toBe("What is 2+2?");
    });

    it("clears hash after decoding", () => {
      const encoded = encodeQuizForShare(mockQuiz);
      window.location.hash = `#quiz=${encoded}`;
      decodeSharedQuiz();
      expect(window.location.hash).toBe("");
    });
  });
});
