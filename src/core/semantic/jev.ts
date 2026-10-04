import type { SemanticQuestion } from "./questions.js";
import type { JudgeModel } from "./SemanticJudge.js";

/**
 * Jev (TypeSafe System One) as the Semantic Judge model. One request carries a
 * state and a map of typed questions; every question is answered in parallel
 * against the same state, so asking several questions per row costs about the
 * same as asking one. Noul returns the probability of "yes" directly.
 * Docs: https://docs.typesafe.ai/api
 */
export class JevJudgeModel implements JudgeModel {
  readonly name: string;
  constructor(private apiKey: string, model = "jev-latest", private baseUrl = "https://api.typesafe.ai", private fetchImpl: typeof fetch = fetch) {
    this.name = model;
  }

  private async call(state: string, questions: Record<string, unknown>): Promise<Record<string, any>> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ state: state.slice(0, 12000), model: this.name, questions }),
    });
    if (!res.ok) throw new Error(`jev ${res.status}`);
    const body = (await res.json()) as { answers: Record<string, any> };
    return body.answers;
  }

  private build(q: SemanticQuestion) {
    if (q.answerType === "BOOLEAN") return { type: "noul", instructions: q.text };
    const labels = q.labels ?? [];
    return { type: "choice", instructions: q.text, criteria: Object.fromEntries(labels.map((l) => [l, q.labelHelp?.[l] ?? null])) };
  }

  private read(q: SemanticQuestion, a: any): { answer: boolean | string; probability: number } {
    if (a?.type === "noul") return { answer: a.noul >= 0.5, probability: a.noul };
    if (a?.type === "choice") return { answer: a.choice, probability: a.probabilities?.[a.choice] ?? a.confidence ?? 0 };
    throw new Error(`unexpected jev answer for ${q.questionId}`);
  }

  async answer(q: SemanticQuestion, text: string) {
    const answers = await this.call(text, { [q.questionId]: this.build(q) });
    return this.read(q, answers[q.questionId]);
  }

  /** Several questions about the same text in one request. */
  async answerMany(qs: SemanticQuestion[], text: string) {
    const answers = await this.call(text, Object.fromEntries(qs.map((q) => [q.questionId, this.build(q)])));
    return Object.fromEntries(qs.map((q) => [q.questionId, this.read(q, answers[q.questionId])]));
  }
}
