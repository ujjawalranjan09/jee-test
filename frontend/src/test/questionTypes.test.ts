/**
 * Tests for the per-type grading helper and the 3-type schema parsing on
 * the frontend. Mirrors the backend tests in test_question_types.py so
 * a fix on one side forces a fix on the other.
 */

import { describe, it, expect } from "vitest";
import type { Question } from "../types";
import {
  isAnswerCorrect,
  isQuestionAnswered,
} from "../hooks/isAnswerCorrect";

function makeSingle(overrides: Partial<Question> = {}): Question {
  return {
    id: "q1",
    prompt: "Capital of France?",
    options: [
      { id: "A", text: "Paris" },
      { id: "B", text: "Berlin" },
      { id: "C", text: "Madrid" },
      { id: "D", text: "Rome" },
    ],
    type: "single",
    correctAnswerId: "A",
    diagramIds: [],
    ...overrides,
  };
}

function makeMultiple(overrides: Partial<Question> = {}): Question {
  return {
    id: "q2",
    prompt: "Which are prime? (Select all that apply)",
    options: [
      { id: "A", text: "2" },
      { id: "B", text: "4" },
      { id: "C", text: "5" },
      { id: "D", text: "7" },
    ],
    type: "multiple",
    correctAnswerId: "",
    correctAnswerIds: ["A", "C", "D"],
    diagramIds: [],
    ...overrides,
  };
}

function makeNumerical(overrides: Partial<Question> = {}): Question {
  return {
    id: "q3",
    prompt: "Find x.",
    options: [],
    type: "numerical",
    correctAnswerId: "",
    correctAnswerIds: [],
    numericalAnswer: 25,
    numericalTolerance: 0,
    diagramIds: [],
    ...overrides,
  };
}

describe("isAnswerCorrect — single", () => {
  it("matches the exact letter (case-insensitive)", () => {
    const q = makeSingle();
    expect(isAnswerCorrect(q, "A", undefined)).toBe(true);
    expect(isAnswerCorrect(q, "a", undefined)).toBe(true);
    expect(isAnswerCorrect(q, "  A  ", undefined)).toBe(true);
  });

  it("returns false on wrong letter", () => {
    const q = makeSingle();
    expect(isAnswerCorrect(q, "B", undefined)).toBe(false);
    expect(isAnswerCorrect(q, "Z", undefined)).toBe(false);
  });

  it("returns null when the user didn't pick anything", () => {
    const q = makeSingle();
    expect(isAnswerCorrect(q, null, undefined)).toBeNull();
    expect(isAnswerCorrect(q, undefined, undefined)).toBeNull();
  });

  it("returns null when there's no answer key", () => {
    const q = makeSingle({ correctAnswerId: "" });
    expect(isAnswerCorrect(q, "A", undefined)).toBeNull();
  });
});

describe("isAnswerCorrect — multiple", () => {
  it("matches the exact set (order-insensitive)", () => {
    const q = makeMultiple();
    expect(isAnswerCorrect(q, ["A", "C", "D"], undefined)).toBe(true);
    expect(isAnswerCorrect(q, ["D", "A", "C"], undefined)).toBe(true);
  });

  it("returns false on partial selection (all-or-nothing)", () => {
    const q = makeMultiple();
    expect(isAnswerCorrect(q, ["A", "C"], undefined)).toBe(false);
    expect(isAnswerCorrect(q, ["A"], undefined)).toBe(false);
    expect(isAnswerCorrect(q, ["A", "C", "D", "B"], undefined)).toBe(false);
  });

  it("returns false on completely wrong selection", () => {
    const q = makeMultiple();
    expect(isAnswerCorrect(q, ["B"], undefined)).toBe(false);
  });

  it("returns null when user hasn't picked anything", () => {
    const q = makeMultiple();
    expect(isAnswerCorrect(q, [], undefined)).toBeNull();
    expect(isAnswerCorrect(q, undefined, undefined)).toBeNull();
    expect(isAnswerCorrect(q, null, undefined)).toBeNull();
  });

  it("returns null when there's no answer key", () => {
    const q = makeMultiple({ correctAnswerIds: [] });
    expect(isAnswerCorrect(q, ["A"], undefined)).toBeNull();
  });

  it("treats single-string userPick as wrong type (defensive)", () => {
    // Defensive: passing a string to a multi-correct question is a code bug.
    // The helper returns null (can't grade) rather than crashing.
    const q = makeMultiple();
    expect(isAnswerCorrect(q, "A" as unknown as string[], undefined)).toBeNull();
  });
});

describe("isAnswerCorrect — numerical", () => {
  it("matches exact value", () => {
    const q = makeNumerical();
    expect(isAnswerCorrect(q, undefined, 25)).toBe(true);
  });

  it("returns false on wrong value", () => {
    const q = makeNumerical();
    expect(isAnswerCorrect(q, undefined, 24)).toBe(false);
    expect(isAnswerCorrect(q, undefined, 26)).toBe(false);
  });

  it("respects tolerance", () => {
    const q = makeNumerical({ numericalTolerance: 0.5 });
    expect(isAnswerCorrect(q, undefined, 24.6)).toBe(true);
    expect(isAnswerCorrect(q, undefined, 25.4)).toBe(true);
    expect(isAnswerCorrect(q, undefined, 24.4)).toBe(false);
    expect(isAnswerCorrect(q, undefined, 25.6)).toBe(false);
  });

  it("returns null when user hasn't typed anything", () => {
    const q = makeNumerical();
    expect(isAnswerCorrect(q, undefined, null)).toBeNull();
    expect(isAnswerCorrect(q, undefined, undefined)).toBeNull();
    expect(isAnswerCorrect(q, undefined, NaN)).toBeNull();
  });

  it("returns null when there's no expected answer", () => {
    const q = makeNumerical({ numericalAnswer: null });
    expect(isAnswerCorrect(q, undefined, 25)).toBeNull();
  });
});

describe("isQuestionAnswered", () => {
  it("single: true when selectedOptionId is set", () => {
    const q = makeSingle();
    expect(isQuestionAnswered(q, { selectedOptionId: "A" })).toBe(true);
    expect(isQuestionAnswered(q, { selectedOptionId: null })).toBe(false);
  });

  it("multiple: true when selectedOptionIds is non-empty", () => {
    const q = makeMultiple();
    expect(isQuestionAnswered(q, { selectedOptionIds: ["A"] })).toBe(true);
    expect(isQuestionAnswered(q, { selectedOptionIds: [] })).toBe(false);
    expect(isQuestionAnswered(q, { selectedOptionIds: undefined })).toBe(false);
  });

  it("numerical: true when numericalAnswer is a finite number", () => {
    const q = makeNumerical();
    expect(isQuestionAnswered(q, { numericalAnswer: 25 })).toBe(true);
    expect(isQuestionAnswered(q, { numericalAnswer: 0 })).toBe(true);
    expect(isQuestionAnswered(q, { numericalAnswer: null })).toBe(false);
    expect(isQuestionAnswered(q, { numericalAnswer: undefined })).toBe(false);
    expect(isQuestionAnswered(q, { numericalAnswer: NaN })).toBe(false);
  });

  it("undefined answer is always unanswered", () => {
    expect(isQuestionAnswered(makeSingle(), undefined)).toBe(false);
    expect(isQuestionAnswered(makeMultiple(), undefined)).toBe(false);
    expect(isQuestionAnswered(makeNumerical(), undefined)).toBe(false);
  });
});

describe("Question schema — backwards compat", () => {
  it("treats a question without a type field as 'single'", () => {
    // Simulates old data in localStorage / a quiz generated before the field
    // existed. isAnswerCorrect should treat it as single-correct.
    const legacy: Question = {
      id: "q1",
      prompt: "x",
      options: [
        { id: "A", text: "yes" },
        { id: "B", text: "no" },
      ],
      // no type field
      correctAnswerId: "A",
      diagramIds: [],
    };
    expect(isAnswerCorrect(legacy, "A", undefined)).toBe(true);
    expect(isAnswerCorrect(legacy, "B", undefined)).toBe(false);
  });
});