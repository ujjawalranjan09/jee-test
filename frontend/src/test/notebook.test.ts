import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  splitTopic,
  makeEntry,
  saveQuestion,
  removeEntry,
  isSaved,
  loadNotebook,
  clearAll,
  groupBySubjectAndChapter,
  type NotebookEntry,
} from "../utils/notebook";
import type { Quiz } from "../types";

const STORAGE_KEY = "qf_notebook_v1";

const mockQuiz: Quiz = {
  id: "quiz-1",
  questions: [
    {
      id: "q1",
      prompt: "What is 2 + 2?",
      options: [
        { id: "a", text: "3" },
        { id: "b", text: "4" },
        { id: "c", text: "5" },
      ],
      correctAnswerId: "b",
      diagramIds: [],
      topic: "Algebra › Linear Equations › Practice",
    },
    {
      id: "q2",
      prompt: "Capital of France?",
      options: [
        { id: "a", text: "London" },
        { id: "b", text: "Paris" },
        { id: "c", text: "Berlin" },
      ],
      correctAnswerId: "b",
      diagramIds: [],
      topic: "Geography › Europe",
    },
    {
      id: "q3",
      prompt: "No topic question",
      options: [{ id: "a", text: "x" }],
      correctAnswerId: "a",
      diagramIds: [],
    },
  ],
  diagrams: {},
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("splitTopic — derives subject + chapter from LLM topic strings", () => {
  it("uses '›' as the primary separator (LLM convention)", () => {
    expect(splitTopic("Algebra › Linear Equations")).toEqual({
      subject: "Algebra",
      chapter: "Linear Equations",
    });
  });

  it("accepts > as an alternate separator", () => {
    expect(splitTopic("Physics > Mechanics > Kinematics")).toEqual({
      subject: "Physics",
      chapter: "Mechanics",
    });
  });

  it("treats a single segment as both subject and chapter", () => {
    expect(splitTopic("Geometry")).toEqual({
      subject: "Geometry",
      chapter: "Geometry",
    });
  });

  it("falls back to 'General' when topic is missing", () => {
    expect(splitTopic(undefined)).toEqual({
      subject: "General",
      chapter: "General",
    });
    expect(splitTopic("")).toEqual({ subject: "General", chapter: "General" });
    expect(splitTopic("   ")).toEqual({
      subject: "General",
      chapter: "General",
    });
  });
});

describe("saveQuestion + isSaved + removeEntry", () => {
  it("saves a question and reports it as saved", () => {
    saveQuestion(mockQuiz, mockQuiz.questions[0]!);
    expect(isSaved(mockQuiz.id, "q1")).toBe(true);
    expect(loadNotebook()).toHaveLength(1);
  });

  it("is idempotent — saving the same question twice updates, doesn't duplicate", () => {
    saveQuestion(mockQuiz, mockQuiz.questions[0]!);
    saveQuestion(mockQuiz, mockQuiz.questions[0]!);
    expect(loadNotebook()).toHaveLength(1);
  });

  it("can save multiple questions to the same quiz", () => {
    saveQuestion(mockQuiz, mockQuiz.questions[0]!);
    saveQuestion(mockQuiz, mockQuiz.questions[1]!);
    expect(loadNotebook()).toHaveLength(2);
    expect(isSaved("quiz-1", "q1")).toBe(true);
    expect(isSaved("quiz-1", "q2")).toBe(true);
  });

  it("removes a saved entry", () => {
    saveQuestion(mockQuiz, mockQuiz.questions[0]!);
    removeEntry(`quiz-1:q1`);
    expect(isSaved("quiz-1", "q1")).toBe(false);
    expect(loadNotebook()).toHaveLength(0);
  });

  it("preserves the question's options and correct answer", () => {
    saveQuestion(mockQuiz, mockQuiz.questions[0]!);
    const [entry] = loadNotebook();
    expect(entry?.options).toHaveLength(3);
    expect(entry?.correctAnswerId).toBe("b");
    expect(entry?.prompt).toBe("What is 2 + 2?");
  });

  it("derives subject + chapter from the question's topic", () => {
    saveQuestion(mockQuiz, mockQuiz.questions[0]!);
    const [entry] = loadNotebook();
    expect(entry?.subject).toBe("Algebra");
    expect(entry?.chapter).toBe("Linear Equations");
  });

  it("falls back to 'General' for topicless questions", () => {
    saveQuestion(mockQuiz, mockQuiz.questions[2]!);
    const [entry] = loadNotebook();
    expect(entry?.subject).toBe("General");
    expect(entry?.chapter).toBe("General");
  });

  it("survives localStorage round-trip with full metadata", () => {
    saveQuestion(mockQuiz, mockQuiz.questions[0]!);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(1);
    expect(parsed.entries).toHaveLength(1);
  });
});

describe("makeEntry — pure builder", () => {
  it("produces a stable id from quiz + question ids", () => {
    const entry = makeEntry(mockQuiz, mockQuiz.questions[0]!);
    expect(entry.id).toBe("quiz-1:q1");
  });

  it("captures provenance when sourceMode is set", () => {
    const entry = makeEntry(
      mockQuiz,
      { ...mockQuiz.questions[0]!, sourceMode: "extracted", pageNumber: 7 },
    );
    expect(entry.sourceMode).toBe("extracted");
    expect(entry.pageNumber).toBe(7);
  });
});

describe("groupBySubjectAndChapter", () => {
  it("groups entries by subject, then chapter, with counts", () => {
    saveQuestion(mockQuiz, mockQuiz.questions[0]!); // Algebra › Linear Equations
    saveQuestion(mockQuiz, mockQuiz.questions[1]!); // Geography › Europe
    saveQuestion(mockQuiz, mockQuiz.questions[2]!); // General › General

    const groups = groupBySubjectAndChapter(loadNotebook());
    expect(groups).toHaveLength(3);
    // Sort is alphabetical: Algebra, General, Geography
    expect(groups[0]?.subject).toBe("Algebra");
    expect(groups[0]?.chapters[0]?.chapter).toBe("Linear Equations");
    expect(groups[0]?.totalCount).toBe(1);
    expect(groups[1]?.subject).toBe("General");
    expect(groups[2]?.subject).toBe("Geography");
  });

  it("returns an empty array when the notebook is empty", () => {
    expect(groupBySubjectAndChapter([])).toEqual([]);
  });

  it("merges multiple questions in the same chapter", () => {
    saveQuestion(mockQuiz, mockQuiz.questions[0]!);
    saveQuestion(mockQuiz, mockQuiz.questions[0]!); // idempotent — still 1 entry
    const groups = groupBySubjectAndChapter(loadNotebook());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.chapters).toHaveLength(1);
  });
});

describe("clearAll", () => {
  it("removes the notebook entry from localStorage", () => {
    saveQuestion(mockQuiz, mockQuiz.questions[0]!);
    clearAll();
    expect(loadNotebook()).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});