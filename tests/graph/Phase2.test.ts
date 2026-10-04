import { describe, expect, it } from "vitest";
import { AuditStore } from "../../src/core/audit/AuditStore.js";
import { JevJudgeModel } from "../../src/core/semantic/jev.js";
import { SemanticJudge, type JudgeModel } from "../../src/core/semantic/SemanticJudge.js";
import { QUESTIONS } from "../../src/core/semantic/questions.js";
import { normalizeTranscript } from "../../src/core/ingest/TranscriptNormalizer.js";
import { buildEpisodes } from "../../src/core/episodes/EpisodeBuilder.js";
import { rankQueue } from "../../src/core/ranker/QueueRanker.js";
import { computeMetrics, sampleRows } from "../../src/core/eval/Evaluation.js";
import { extractClaimsWithJudge } from "../../src/core/ledger/ClaimExtractor.js";
import { investigate } from "../../src/core/investigate.js";

const kw = (re: RegExp, name = "kw"): JudgeModel => ({ name, answer: async (_q, t) => ({ answer: re.test(t), probability: re.test(t) ? 0.95 : 0.03 }) });

describe("AuditStore", () => {
  it("caches judgments across judges by (question, version, model, input hash)", async () => {
    const store = new AuditStore();
    let calls = 0;
    const model: JudgeModel = { name: "m1", answer: async () => (calls++, { answer: true, probability: 0.9 }) };
    const input = [{ text: "Exported 93 contacts", recordIds: ["r1"] }];
    await new SemanticJudge(model, store).judge(QUESTIONS.Q_CLAIMS_COMPLETION, input);
    await new SemanticJudge(model, store).judge(QUESTIONS.Q_CLAIMS_COMPLETION, input);
    expect(calls).toBe(1);
    expect(store.countOutputs()).toBe(1);
  });
  it("refuses an override justified in fewer than 10 characters", () => {
    const store = new AuditStore();
    expect(() => store.addFinding({ claimId: "c", claimText: "t", originalVerdict: "SUPPORTED", overrideVerdict: "CONTRADICTED", justification: "short", analyst: "a" })).toThrow();
    const f = store.addFinding({ claimId: "c", claimText: "t", originalVerdict: "SUPPORTED", overrideVerdict: "CONTRADICTED", justification: "the file is empty on disk", analyst: "a" });
    expect(store.listFindings()[0].id).toBe(f.id);
  });
});

describe("Jev judge model", () => {
  it("sends typed questions and reads noul and choice answers", async () => {
    let sent: any;
    const fake = (async (_u: any, init: any) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ answers: { Q_CLAIMS_COMPLETION: { type: "noul", noul: 0.91 }, Q_RELEVANT_TO_GOAL: { type: "choice", choice: "relevant", probabilities: { relevant: 0.8, partly_relevant: 0.15, not_relevant: 0.05 }, confidence: 0.7 } } })); }) as typeof fetch;
    const jev = new JevJudgeModel("k", "jev-latest", "https://api.example", fake);
    const many = await jev.answerMany([QUESTIONS.Q_CLAIMS_COMPLETION, QUESTIONS.Q_RELEVANT_TO_GOAL], "state text");
    expect(sent.model).toBe("jev-latest");
    expect(sent.questions.Q_CLAIMS_COMPLETION.type).toBe("noul");
    expect(sent.questions.Q_RELEVANT_TO_GOAL.type).toBe("choice");
    expect(many.Q_CLAIMS_COMPLETION).toEqual({ answer: true, probability: 0.91 });
    expect(many.Q_RELEVANT_TO_GOAL).toEqual({ answer: "relevant", probability: 0.8 });
  });
  it("shares one request across questions about the same row", async () => {
    let requests = 0;
    const model: JudgeModel = { name: "j", answer: async () => ({ answer: true, probability: 1 }), answerMany: async (qs) => (requests++, Object.fromEntries(qs.map((q) => [q.questionId, { answer: true, probability: 0.9 }]))) };
    const judge = new SemanticJudge(model);
    await judge.judgeMany([QUESTIONS.Q_CLAIMS_COMPLETION, QUESTIONS.Q_REPORTS_PROBLEM], [{ text: "row", recordIds: ["r"] }]);
    expect(requests).toBe(1);
  });
});

const T = `[09:01] agent-a: $ python export.py
[09:01] tool: stdout: wrote 0 rows to contacts.csv
[09:03] agent-a: Exported 93 contacts to contacts.csv
[09:04] agent-b: Endorsing, using contacts.csv for the send
[09:30] agent-d: Finished the sponsor spreadsheet sponsors.xlsx
[09:31] agent-d: $ ls sponsors.xlsx
[09:31] tool: stdout: sponsors.xlsx 48 KB`;

describe("EpisodeBuilder", () => {
  it("splits two tasks by shared identifiers and records why", async () => {
    const { records } = normalizeTranscript(T);
    const claimRec = records.find((r) => String(r.payload.text).includes("Exported 93"))!;
    const sponsorRec = records.find((r) => String(r.payload.text).includes("sponsor spreadsheet"))!;
    const eps = await buildEpisodes(records, [String(claimRec.recordId), String(sponsorRec.recordId)]);
    expect(eps).toHaveLength(2);
    const mail = eps.find((e) => e.recordIds.includes(String(claimRec.recordId)))!;
    expect(mail.agents.sort()).toEqual(["agent-a", "agent-b"]);
    expect(mail.basisCounts.IDENTIFIER_MATCH).toBeGreaterThan(0);
    expect(mail.justification).toMatch(/shared identifier/);
  });
  it("adds model-inferred links only when Q_SAME_TASK passes the threshold, and labels them", async () => {
    const raw = "[10:00] a: I started the upload\n[10:02] b: working on the same upload now";
    const { records } = normalizeTranscript(raw);
    const judge = new SemanticJudge({ name: "s", answer: async () => ({ answer: true, probability: 0.9 }) });
    const eps = await buildEpisodes(records, [String(records[0].recordId)], judge);
    expect(eps[0].recordIds).toHaveLength(2);
    expect(eps[0].basisCounts.SEMANTIC_LINK).toBe(1);
  });
});

describe("QueueRanker", () => {
  it("returns a shortlist that keeps at least 20% ordinary controls", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 12; i++) {
      const f = `file${i}.csv`;
      lines.push(`[09:${String(i * 4).padStart(2, "0")}] agent-${i % 3}: $ make ${f}`, `[09:${String(i * 4).padStart(2, "0")}] tool: stdout: ${i % 2 ? "wrote 0 rows" : "wrote 40 rows"} to ${f}`, `[09:${String(i * 4 + 1).padStart(2, "0")}] agent-${i % 3}: Exported 40 rows to ${f}`);
    }
    const inv = await investigate(lines.join("\n"), "q");
    const anchors = inv.records.filter((r) => r.role === "STATEMENT").map((r) => String(r.recordId));
    const eps = await buildEpisodes(inv.records, anchors);
    const q = await rankQueue({ episodes: eps, records: inv.records, claimNodes: inv.graph.nodes.filter((n) => n.nodeType === "CLAIM") });
    expect(q.shortlist.length).toBeGreaterThanOrEqual(8);
    expect(q.shortlist.length).toBeLessThanOrEqual(12);
    expect(q.shortlist.filter((s) => s.isControl).length / q.shortlist.length).toBeGreaterThanOrEqual(0.2);
    expect(q.weights.relevance).toBe(1);
  });
});

describe("Measured detection", () => {
  it("reports precision and recall only after 30 labels, and flags a >10 point regression", async () => {
    const store = new AuditStore();
    const judge = new SemanticJudge(kw(/exported|finished/i), store);
    const rows = Array.from({ length: 32 }, (_, i) => ({ text: i % 2 ? `Exported ${i} rows to f${i}.csv` : `Plan: I will check f${i}.csv`, label: i % 2 === 1 }));
    rows.slice(0, 10).forEach((r, i) => store.saveLabel({ questionId: "Q_CLAIMS_COMPLETION", inputHash: SemanticJudge.hash(r.text + i), text: r.text, label: r.label, source: "sample" }));
    let m = await computeMetrics(store, judge, "Q_CLAIMS_COMPLETION");
    expect(m.status).toBe("need_more_labels");
    rows.slice(10).forEach((r, i) => store.saveLabel({ questionId: "Q_CLAIMS_COMPLETION", inputHash: SemanticJudge.hash(r.text + (i + 10)), text: r.text, label: r.label, source: "manual" }));
    m = await computeMetrics(store, judge, "Q_CLAIMS_COMPLETION");
    expect(m.status).toBe("measured");
    expect(m.precision).toBe(1); expect(m.recall).toBe(1);
    store.setBaseline("Q_CLAIMS_COMPLETION", 1, 1, 32, "kw");
    const worse = await computeMetrics(store, new SemanticJudge(kw(/zzz/, "kw-worse"), store), "Q_CLAIMS_COMPLETION");
    expect(worse.regression).toBe(true);
  });
  it("samples blind: rows carry no model answer", () => {
    const { records } = normalizeTranscript(T);
    const rows = sampleRows("Q_CLAIMS_COMPLETION", records, new Set());
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0]).sort()).toEqual(["inputHash", "recordIds", "text"]);
  });
});

describe("Model-assisted claim extraction", () => {
  it("keeps only sentences the judge says state completion, as exact substrings", async () => {
    const { records } = normalizeTranscript("[09:00] a: Plan: check the file. Exported 93 contacts and verified the hash. Will send later.");
    const judge = new SemanticJudge(kw(/exported/i));
    const { claims, modelAssisted } = await extractClaimsWithJudge(records, judge);
    expect(claims.map((c) => c.statementText.toLowerCase())).toEqual(["exported 93 contacts", "verified the hash"]);
    expect(modelAssisted.size).toBe(2);
    const msg = String(records[0].payload.text).toLowerCase();
    claims.forEach((c) => expect(msg).toContain(c.statementText.toLowerCase().replace(/^i /, "")));
  });
});
