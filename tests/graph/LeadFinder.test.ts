import { describe, expect, it } from "vitest";
import { normalizeTranscript } from "../../src/core/ingest/TranscriptNormalizer.js";
import { SemanticJudge, type JudgeModel } from "../../src/core/semantic/SemanticJudge.js";
import { findLeads } from "../../src/core/discovery/LeadFinder.js";

// Deterministic stand-in for the model: keyword answers, only used to test the plumbing.
const fake = (): JudgeModel & { calls: number } => ({
  name: "fake-1", calls: 0,
  async answer(q, text) {
    (this as any).calls++;
    const t = text.toLowerCase();
    const yes = q.questionId === "Q_CLAIMS_COMPLETION" ? /exported|done|finished/.test(t) : q.questionId === "Q_ACTION_FAILED" ? /0 rows|error|failed/.test(t) : /stop|abort|empty/.test(t);
    return { answer: yes, probability: 0.9 };
  },
});

const raw = `[09:01] agent-a: $ python export.py
[09:01] tool: stdout: wrote 0 rows to contacts.csv
[09:03] agent-a: Exported 93 contacts to contacts.csv
[09:04] agent-b: Endorsing, using contacts.csv for the send
[09:05] agent-c: STOP. contacts.csv is empty, aborting`;

describe("LeadFinder + SemanticJudge", () => {
  it("finds failure-then-claim, handoff, correction and silent failure", async () => {
    const model = fake();
    const { records } = normalizeTranscript(raw);
    const { leads } = await findLeads(records, new SemanticJudge(model));
    const routes = new Set(leads.map((l) => l.route));
    expect([...routes].sort()).toEqual([1, 2, 3, 4, 6]);
  });

  it("answers the second run entirely from cache", async () => {
    const model = fake();
    const judge = new SemanticJudge(model);
    const { records } = normalizeTranscript(raw);
    await findLeads(records, judge);
    const first = model.calls;
    await findLeads(records, judge);
    expect(model.calls).toBe(first);
    expect(judge.stats.cacheHits).toBeGreaterThan(0);
  });

  it("counts a malformed model answer as an error and does not crash", async () => {
    const judge = new SemanticJudge({ name: "bad", answer: async () => ({ nope: 1 }) });
    const { records } = normalizeTranscript(raw);
    const { leads } = await findLeads(records, judge);
    expect(judge.stats.parseErrors).toBeGreaterThan(0);
    expect(leads.every((l) => l.route === 3)).toBe(true);
  });
});
