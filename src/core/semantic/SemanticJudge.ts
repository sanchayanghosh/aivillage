import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { SemanticJudgmentSchema, type SemanticJudgment, type SemanticQuestion } from "./questions.js";

export interface JudgeInput { text: string; recordIds: string[] }

/** The seam: anything that can answer one fixed question about one text. */
export interface JudgeModel {
  readonly name: string;
  answer(q: SemanticQuestion, text: string): Promise<unknown>;
}

const RawAnswer = z.object({ answer: z.union([z.boolean(), z.string()]), probability: z.number().min(0).max(1) });

export interface JudgeStats { asked: number; cacheHits: number; parseErrors: number; modelErrors: number }

/**
 * Structure in SQL, meaning in questions, verdicts in evidence: this judge only
 * answers questions. A judgment can create a lead or propose a link and never
 * sets a verdict. Cache key = (questionId, questionVersion, model, inputHash).
 */
export class SemanticJudge {
  private cache = new Map<string, SemanticJudgment>();
  readonly stats: JudgeStats = { asked: 0, cacheHits: 0, parseErrors: 0, modelErrors: 0 };

  constructor(private model: JudgeModel, private cachePath?: string) {
    if (cachePath && existsSync(cachePath)) {
      try { for (const j of JSON.parse(readFileSync(cachePath, "utf8")) as SemanticJudgment[]) this.cache.set(this.key(j.questionId, j.questionVersion, j.model, j.inputHash), j); } catch { /* start empty */ }
    }
  }

  private key = (q: string, v: number, m: string, h: string) => `${q}@${v}|${m}|${h}`;
  static hash = (text: string) => "sha256:" + createHash("sha256").update(text).digest("hex").slice(0, 16);

  async judge(q: SemanticQuestion, inputs: JudgeInput[], concurrency = 6): Promise<Array<SemanticJudgment | null>> {
    const out: Array<SemanticJudgment | null> = new Array(inputs.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < inputs.length) {
        const i = next++;
        out[i] = await this.one(q, inputs[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, worker));
    this.persist();
    return out;
  }

  private async one(q: SemanticQuestion, input: JudgeInput): Promise<SemanticJudgment | null> {
    this.stats.asked++;
    const inputHash = SemanticJudge.hash(input.text);
    const hit = this.cache.get(this.key(q.questionId, q.version, this.model.name, inputHash));
    if (hit) { this.stats.cacheHits++; return { ...hit, cached: true, inputRecordIds: input.recordIds }; }
    let raw: unknown;
    try { raw = await this.model.answer(q, input.text); } catch { this.stats.modelErrors++; return null; }
    const parsed = RawAnswer.safeParse(raw);
    if (!parsed.success) { this.stats.parseErrors++; return null; }
    const judgment = SemanticJudgmentSchema.parse({
      questionId: q.questionId, questionVersion: q.version, model: this.model.name, inputRecordIds: input.recordIds.length ? input.recordIds : ["unknown"],
      inputHash, answer: parsed.data.answer, probability: parsed.data.probability, cached: false, createdAt: new Date().toISOString(),
    });
    this.cache.set(this.key(q.questionId, q.version, this.model.name, inputHash), judgment);
    return judgment;
  }

  private persist() {
    if (!this.cachePath) return;
    try { mkdirSync(dirname(this.cachePath), { recursive: true }); writeFileSync(this.cachePath, JSON.stringify([...this.cache.values()])); } catch { /* cache is best effort */ }
  }
}

/** OpenAI-compatible JSON-mode model. Temperature 0 so a re-run gives the same leads. */
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
          { role: "system", content: `You classify text from an AI agent transcript. Answer one fixed question about behavior, never about motive. Reply with JSON only: {"answer": <${labels}>, "probability": <0..1 confidence that your answer is right>}.` },
          { role: "user", content: `Question: ${q.text}\n\nText:\n"""\n${text.slice(0, 2000)}\n"""` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`judge model ${res.status}`);
    const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return JSON.parse(body.choices[0].message.content);
  }
}
