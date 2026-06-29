/**
 * Tests for the wire-format normalizer in src/api/client.ts.
 *
 * Backend sends snake_case (`correct_answer_id`, `correct_answer_ids`,
 * `numerical_answer`, etc.). Frontend expects camelCase. Without this
 * normalisation, every newly-generated quiz renders with `correctAnswerId=""`
 * (and missing `type`/`correctAnswerIds`/`numericalAnswer`), causing the
 * QuizPlayer to either grade everything wrong or crash on the missing
 * `enabled` access in the timer hook.
 */

import { describe, it, expect } from "vitest";

import {
  // normalizeQuestion and normalizeQuiz are not exported — test through
  // the public functions that use them, or import via the internal path.
  __test__normalizeQuestion,
  __test__normalizeQuiz,
} from "../api/client";

describe("normalizeQuestion — wire format (snake_case → camelCase)", () => {
  it("translates a single-correct snake_case question", () => {
    const out = __test__normalizeQuestion({
      id: "q1",
      prompt: "Capital of France?",
      options: [{ id: "A", text: "Paris" }],
      type: "single",
      correct_answer_id: "A",
      diagram_ids: ["d1"],
      topic: "Geography",
      source_mode: "generated",
      page_number: 3,
    });
    expect(out.id).toBe("q1");
    expect(out.type).toBe("single");
    expect(out.correctAnswerId).toBe("A");
    expect(out.diagramIds).toEqual(["d1"]);
    expect(out.topic).toBe("Geography");
    expect(out.sourceMode).toBe("generated");
    expect(out.pageNumber).toBe(3);
    expect(out.correctAnswerIds).toBeUndefined();
    expect(out.numericalAnswer).toBeUndefined();
  });

  it("translates a multi-correct snake_case question", () => {
    const out = __test__normalizeQuestion({
      id: "q2",
      prompt: "Select all that apply",
      options: [{ id: "A", text: "a" }, { id: "B", text: "b" }],
      type: "multiple",
      correct_answer_ids: ["A", "C", "D"],
    });
    expect(out.type).toBe("multiple");
    expect(out.correctAnswerIds).toEqual(["A", "C", "D"]);
    expect(out.correctAnswerId).toBe("");
  });

  it("translates a numerical snake_case question", () => {
    const out = __test__normalizeQuestion({
      id: "q3",
      prompt: "Find x.",
      options: [],
      type: "numerical",
      numerical_answer: 25,
      numerical_tolerance: 0.01,
    });
    expect(out.type).toBe("numerical");
    expect(out.numericalAnswer).toBe(25);
    expect(out.numericalTolerance).toBe(0.01);
    expect(out.options).toEqual([]);
  });

  it("infers 'numerical' from numerical_answer when type is omitted", () => {
    const out = __test__normalizeQuestion({
      id: "q",
      prompt: "Find x.",
      options: [],
      numerical_answer: 5,
    });
    expect(out.type).toBe("numerical");
    expect(out.numericalAnswer).toBe(5);
  });

  it("infers 'multiple' from correct_answer_ids when type is omitted", () => {
    const out = __test__normalizeQuestion({
      id: "q",
      prompt: "Which are prime?",
      options: [{ id: "A", text: "2" }],
      correct_answer_ids: ["A", "C"],
    });
    expect(out.type).toBe("multiple");
    expect(out.correctAnswerIds).toEqual(["A", "C"]);
  });

  it("defaults to 'single' when type is omitted and there's no key", () => {
    const out = __test__normalizeQuestion({
      id: "q",
      prompt: "Capital of France?",
      options: [{ id: "A", text: "Paris" }],
      correct_answer_id: "A",
    });
    expect(out.type).toBe("single");
    expect(out.correctAnswerId).toBe("A");
  });

  it("aliases 'multi' / 'select_all' to 'multiple'", () => {
    expect(__test__normalizeQuestion({ type: "multi" }).type).toBe("multiple");
    expect(
      __test__normalizeQuestion({ type: "select_all" }).type,
    ).toBe("multiple");
    expect(
      __test__normalizeQuestion({ type: "multi-select" }).type,
    ).toBe("multiple");
  });

  it("aliases 'numeric' / 'integer' / 'decimal' to 'numerical'", () => {
    expect(
      __test__normalizeQuestion({ type: "numeric" }).type,
    ).toBe("numerical");
    expect(
      __test__normalizeQuestion({ type: "integer" }).type,
    ).toBe("numerical");
    expect(
      __test__normalizeQuestion({ type: "decimal" }).type,
    ).toBe("numerical");
  });

  it("handles a legacy single-correct question without any type/extra fields", () => {
    // Backwards-compat: a quiz generated before the schema change.
    const out = __test__normalizeQuestion({
      id: "legacy",
      prompt: "x",
      options: [{ id: "A", text: "yes" }],
      correct_answer_id: "A",
    });
    expect(out.type).toBe("single");
    expect(out.correctAnswerId).toBe("A");
    expect(out.diagramIds).toEqual([]);
  });

  it("never throws on a completely empty / malformed input", () => {
    // Defensive — should produce a single with empty defaults, not crash.
    const out = __test__normalizeQuestion(undefined);
    expect(out.type).toBe("single");
    expect(out.id).toBeUndefined();
    expect(out.options).toEqual([]);
    expect(out.diagramIds).toEqual([]);
  });

  it("survives a backend that sends mixed snake + camel in the same payload", () => {
    const out = __test__normalizeQuestion({
      id: "q",
      prompt: "x",
      options: [],
      // backend used the wrong field name — should still pick it up
      numericalAnswer: 7, // camelCase, not snake_case
      type: "numerical",
    });
    expect(out.numericalAnswer).toBe(7);
  });
});

describe("normalizeQuiz — diagram + questions normalisation", () => {
  it("normalises every question in a mixed-type quiz", () => {
    const out = __test__normalizeQuiz({
      id: "quiz-1",
      diagrams: [],
      questions: [
        {
          id: "q1",
          prompt: "single",
          options: [{ id: "A", text: "x" }],
          type: "single",
          correct_answer_id: "A",
        },
        {
          id: "q2",
          prompt: "multi",
          options: [{ id: "A", text: "x" }],
          type: "multiple",
          correct_answer_ids: ["A", "B"],
        },
        {
          id: "q3",
          prompt: "num",
          options: [],
          type: "numerical",
          numerical_answer: 42,
        },
      ],
    });
    expect(out.questions).toHaveLength(3);
    expect(out.questions[0].type).toBe("single");
    expect(out.questions[1].type).toBe("multiple");
    expect(out.questions[2].type).toBe("numerical");
    expect(out.questions[1].correctAnswerIds).toEqual(["A", "B"]);
    expect(out.questions[2].numericalAnswer).toBe(42);
  });

  it("returns an empty quiz on empty input", () => {
    const out = __test__normalizeQuiz({});
    expect(out.questions).toEqual([]);
    expect(out.diagrams).toEqual({});
  });
});