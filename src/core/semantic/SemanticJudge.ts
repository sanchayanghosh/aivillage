import { createHash } from "node:crypto";
import { z } from "zod";
import { SemanticJudgmentSchema, type SemanticJudgment, type SemanticQuestion } from "./questions.js";
import type { AuditStore } from "../audit/AuditStore.js";

export interface JudgeInput { text: string; recordIds: string[] }

/**
 * The seam: anything that can answer a fixed question about a text.
 * For BOOLEAN questions `probability` is the probability the answer is yes.
 */
export interface JudgeModel {
  readonly name: string;
  answer(q: SemanticQuestion, text: string): Promise<unknown>;
  /** Optional: several questions about one text in a single request (Jev). */
  answerMany?(qs: SemanticQuestion[], text: string): Promise<Record<string, unknown>>;
}

const RawAnswer = z.object({ answer: z.union([z.boolean(), z.string()]), probability: z.number().min(0).max(1) });

export interface JudgeStats { asked: number; cacheHits: number; parseErrors: number; modelErrors: number; requests: number }

/**
 * Structure in SQL, meaning in questions, verdicts in evidence: this judge only
 * answers questions. A judgment can create a lead or propose a link and never
 * sets a verdict. Cache key = (questionId, questionVersion, model, inputHash),
 * stored in the audit store's classifier_outputs partition when one is given.
 */
export class SemanticJudge {
  private memory = new Map<string, SemanticJudgment>();
  readonly stats: JudgeStats = { asked: 0, cacheHits: 0, parseErrors: 0, modelErrors: 0, requests: 0 };

  constructor(private model: JudgeModel, private store?: AuditStore) {}

  get modelName() { return this.model.name; }
  private key = (q: SemanticQuestion, h: string) => `${q.questionId}@${q.version}|${this.model.name}|${h}`;
  static hash = (text: string) => "sha256:" + createHash("sha256").update(text).digest("hex").slice(0, 16);

  private lookup(q: SemanticQuestion, hash: string): SemanticJudgment | null {
    const hit = this.memory.get(this.key(q, hash));
    if (hit) return hit;
    const row = this.store?.getOutput(q.questionId, q.version, this.model.name, hash);
    if (!row) return null;
    const j: SemanticJudgment = { questionId: row.questionId, questionVersion: row.questionVersion, model: row.model, inputRecordIds: row.inputRecordIds, inputHash: row.inputHash, answer: row.answer === "true" ? true : row.answer === "false" ? false : row.answer, probability: row.probability, cached: true, createdAt: new Date(row.createdAt.replace(" ", "T") + "Z").toISOString() };
    this.memory.set(this.key(q, hash), j);
    return j;
  }

  private record(q: SemanticQuestion, input: JudgeInput, hash: string, raw: unknown): SemanticJudgment | null {
    const parsed = RawAnswer.safeParse(raw);
    if (!parsed.success) { this.stats.parseErrors++; return null; }
    const j = SemanticJudgmentSchema.parse({
      questionId: q.questionId, questionVersion: q.version, model: this.model.name, inputRecordIds: input.recordIds.length ? input.recordIds : ["unknown"],
      inputHash: hash, answer: parsed.data.answer, probability: parsed.data.probability, cached: false, createdAt: new Date().toISOString(),
    });
    this.memory.set(this.key(q, hash), j);
    this.store?.putOutput({ questionId: q.questionId, questionVersion: q.version, model: this.model.name, inputHash: hash, inputRecordIds: j.inputRecordIds, answer: String(j.answer), probability: j.probability, createdAt: j.createdAt });
    return j;
  }

  /** One question over many inputs. */
  async judge(q: SemanticQuestion, inputs: JudgeInput[], concurrency = 6): Promise<Array<SemanticJudgment | null>> {
    const many = await this.judgeMany([q], inputs, concurrency);
    return many.map((m) => m[q.questionId] ?? null);
  }

  /** Several questions over many inputs. With Jev, uncached questions for a row share one request. */
  async judgeMany(qs: SemanticQuestion[], inputs: JudgeInput[], concurrency = 6): Promise<Array<Record<string, SemanticJudgment | null>>> {
    const out: Array<Record<string, SemanticJudgment | null>> = inputs.map(() => ({}));
    let next = 0;
    const worker = async () => {
      while (next < inputs.length) {
        const i = next++;
        const input = inputs[i];
        const hash = SemanticJudge.hash(input.text);
        const missing: SemanticQuestion[] = [];
        for (const q of qs) {
          this.stats.asked++;
          const hit = this.lookup(q, hash);
          if (hit) { this.stats.cacheHits++; out[i][q.questionId] = { ...hit, cached: true, inputRecordIds: input.recordIds }; }
          else missing.push(q);
        }
        if (!missing.length) continue;
        try {
          if (this.model.answerMany && missing.length > 1) {
            this.stats.requests++;
            const raw = await this.model.answerMany(missing, input.text);
            for (const q of missing) out[i][q.questionId] = this.record(q, input, hash, raw[q.questionId]);
          } else {
            for (const q of missing) {
              this.stats.requests++;
              out[i][q.questionId] = this.record(q, input, hash, await this.model.answer(q, input.text));
            }
          }
        } catch {
          this.stats.modelErrors++;
          for (const q of missing) out[i][q.questionId] ??= null;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, inputs.length)) }, worker));
    return out;
  }
}

/** OpenAI-compatible JSON-mode fallback judge. */
export class OpenAIJudgeModel implements JudgeModel {
  constructor(readonly name: string, private apiKey: string, private baseUrl = "https://api.openai.com/v1") {}
  async answer(q: SemanticQuestion, text: string): Promise<unknown> {
    const labels = q.answerType === "BOOLEAN" ? "true or false" : (q.labels ?? []).join(" / ");
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.name, response_format: { type: "json_object" },
        ...(this.name.startsWith("gpt-5") ? { reasoning_effort: "none" } : { temperature: 0 }),
        messages: [
          { role: "system", content: `You classify text from an AI agent transcript. Answer one fixed question about behavior, never about motive. Reply with JSON only: {"answer": <${labels}>, "probability": <0..1 probability that the answer to the question is yes${q.answerType === "BOOLEAN" ? "" : " (for choices: confidence in your pick)"}>}.` },
          { role: "user", content: `Question: ${q.text}\n\nText:\n"""\n${text.slice(0, 2000)}\n"""` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`judge model ${res.status}`);
    const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return JSON.parse(body.choices[0].message.content);
  }
}
