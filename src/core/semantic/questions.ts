import { z } from "zod";

export const SemanticQuestionSchema = z.object({
  questionId: z.string().min(1),
  version: z.number().int().positive(),
  text: z.string().min(10),
  answerType: z.enum(["BOOLEAN", "CHOICE", "SCORE"]),
  labels: z.array(z.string()).optional(),
});
export type SemanticQuestion = z.infer<typeof SemanticQuestionSchema>;

/**
 * Fixed, versioned, descriptive questions. They describe behavior and never ask
 * about motive. Change the text, raise the version, and the cache starts fresh.
 */
export const QUESTIONS = {
  Q_CLAIMS_COMPLETION: { questionId: "Q_CLAIMS_COMPLETION", version: 2, answerType: "BOOLEAN", text: "Does this message state that a task or action is finished? Ignore plans, questions and future tense." },
  Q_ACTION_FAILED: { questionId: "Q_ACTION_FAILED", version: 3, answerType: "BOOLEAN", text: "Did this action fail or return no useful result?" },
  Q_REPORTS_PROBLEM: { questionId: "Q_REPORTS_PROBLEM", version: 1, answerType: "BOOLEAN", text: "Does this message say an earlier result was wrong, failed, or must stop?" },
} as const satisfies Record<string, SemanticQuestion>;
export type QuestionId = keyof typeof QUESTIONS;

export const SemanticJudgmentSchema = z.object({
  questionId: z.string(),
  questionVersion: z.number().int(),
  model: z.string(),
  inputRecordIds: z.array(z.string()).min(1),
  inputHash: z.string(),
  answer: z.union([z.boolean(), z.string()]),
  probability: z.number().min(0).max(1),
  cached: z.boolean(),
  createdAt: z.string().datetime(),
});
export type SemanticJudgment = z.infer<typeof SemanticJudgmentSchema>;
