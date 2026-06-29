import type { AnswerState, Question, QuizSession } from "../types";

export interface ScoreResult {
  correct: number;
  incorrect: number;
  unanswered: number;
  total: number;
}

export function scoreQuiz(session: QuizSession): ScoreResult {
  const { quiz, answers } = session;
  let correct = 0;
  let incorrect = 0;
  let unanswered = 0;

  for (const question of quiz.questions) {
    const answer = answers[question.id];
    if (!answer || answer.selectedOptionId === null) {
      unanswered++;
    } else if (
      normalize(answer.selectedOptionId) === normalize(question.correctAnswerId)
    ) {
      correct++;
    } else {
      incorrect++;
    }
  }

  return {
    correct,
    incorrect,
    unanswered,
    total: quiz.questions.length,
  };
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}
