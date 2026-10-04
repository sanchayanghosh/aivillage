import { z } from "zod";

export const SemanticQuestionSchema = z.object({
  questionId: z.string().min(1),
  version: z.number().int().positive(),
  text: z.string().min(10),
  answerType: z.enum(["BOOLEAN", "CHOICE", "SCORE"]),
  labels: z.array(z.string()).optional(),
  labelHelp: z.record(z.string()).optional(),
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
  Q_OBSERVATION_VS_CLAIM: { questionId: "Q_OBSERVATION_VS_CLAIM", version: 1, answerType: "CHOICE", labels: ["supports", "contradicts", "unrelated"],
    labelHelp: { supports: "The observation shows the claimed result really happened.", contradicts: "The observation shows the claimed result did not happen, or was undone, or the output is empty or wrong.", unrelated: "The observation says nothing about whether the claimed result happened. Use this when it is about a different file, task, person or step than the claim, even if it looks like a failure or a success." },
    text: "An agent made a claim. The observation below was recorded before the claim. Does the observation support the claim, contradict it, or say nothing about it?" },
  Q_SAME_TARGET: { questionId: "Q_SAME_TARGET", version: 1, answerType: "BOOLEAN", text: "Is the observation about the same file, job or step that the claim says is finished? Answer no if it concerns a different file, task or step." },
  Q_SAME_TASK: { questionId: "Q_SAME_TASK", version: 1, answerType: "BOOLEAN", text: "Is the second record about the same task as the anchor record? Same task means the same file, job or goal, not just the same topic." },
  Q_RELEVANT_TO_GOAL: { questionId: "Q_RELEVANT_TO_GOAL", version: 1, answerType: "CHOICE", labels: ["not_relevant", "partly_relevant", "relevant"], text: "How relevant is this episode summary to the selected goal?" },
  Q_ACTION_CONSEQUENCE: { questionId: "Q_ACTION_CONSEQUENCE", version: 1, answerType: "CHOICE", labels: ["external_send", "external_write", "local_change", "read_only"], text: "What is the strongest real-world effect of this action? external_send reaches people or services outside the system, external_write changes an outside system, local_change edits local files or state, read_only only reads." },
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
