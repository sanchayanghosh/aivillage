import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { investigate } from "../../core/investigate.js";
import { findLeads } from "../../core/discovery/LeadFinder.js";
import { buildEpisodes } from "../../core/episodes/EpisodeBuilder.js";
import { rankQueue } from "../../core/ranker/QueueRanker.js";
import { QUESTIONS, type QuestionId } from "../../core/semantic/questions.js";
import { computeMetrics, sampleRows, MIN_LABELS, MAX_LABELS } from "../../core/eval/Evaluation.js";
import { SemanticJudge } from "../../core/semantic/SemanticJudge.js";
import { auditStore, judgeSetup } from "../context.js";
import type { LeadsPayload } from "../../core/graph/contracts.js";

type Send = (res: ServerResponse, status: number, body: unknown) => void;
const NO_JUDGE = { error: "No Semantic Judge is configured. Set TYPESAFE_API_KEY (Jev) or OPENAI_API_KEY on the server.", code: "NO_JUDGE" };

function loadRaw(body: { transcript?: string; fixture?: string }, fixtureDir: string): string | null {
  if (body.transcript) return body.transcript;
  if (body.fixture && !body.fixture.includes("/") && !body.fixture.includes("..")) return readFileSync(join(fixtureDir, body.fixture), "utf8");
  return null;
}

/** Returns true when it handled the request. */
export async function studioRoutes(req: IncomingMessage, res: ServerResponse, url: URL, readBody: (r: IncomingMessage) => Promise<string>, send: Send, fixtureDir: string): Promise<boolean> {
  const p = url.pathname;
  const json = async () => (JSON.parse((await readBody(req)) || "{}") as Record<string, any>);

  if (req.method === "POST" && p === "/api/ingest") {
    const body = await json();
    if (!body.transcript) return send(res, 400, { error: "transcript is required" }), true;
    const setup = judgeSetup(req);
    const inv = await investigate(body.transcript, body.episodeId ?? "uploaded", setup?.judge);
    send(res, 200, { report: inv.report, jsonl: inv.jsonl, graph: inv.graph, claims: inv.analysis.claims.length, claimMode: inv.claimMode, provider: setup?.provider ?? null });
    return true;
  }

  if (req.method === "GET" && p.startsWith("/api/graph/")) {
    const name = p.slice("/api/graph/".length);
    if (name.includes("/") || name.includes("..") || !name.endsWith(".jsonl")) return send(res, 400, { error: "bad name" }), true;
    const inv = await investigate(readFileSync(join(fixtureDir, name), "utf8"), name.replace(/\.jsonl$/, ""));
    send(res, 200, inv.graph);
    return true;
  }

  if (req.method === "POST" && p === "/api/leads") {
    const setup = judgeSetup(req);
    if (!setup) return send(res, 503, NO_JUDGE), true;
    const body = await json();
    const raw = loadRaw(body, fixtureDir);
    if (!raw) return send(res, 400, { error: "transcript or fixture is required" }), true;
    const inv = await investigate(raw, "episode", setup.judge);
    const threshold = 0.5;
    const result = await findLeads(inv.records, setup.judge);
    const anchors = [...new Set(result.leads.filter((l) => l.score >= threshold).flatMap((l) => l.recordIds ?? []))];
    const episodes = await buildEpisodes(inv.records, anchors, setup.judge);
    const claimNodes = inv.graph.nodes.filter((n) => n.nodeType === "CLAIM");
    const queue = await rankQueue({ episodes, records: inv.records, claimNodes, judge: setup.judge, goal: body.goal });
    const store = auditStore();
    for (const route of new Set(result.leads.map((l) => l.route))) {
      const l = result.leads.find((x) => x.route === route)!;
      store.saveRule(route, l.sql, l.questions, { lead: threshold });
    }
    const roleOf = new Map<string, string>();
    const counts = new Map<string, number>();
    for (const r of inv.records) { counts.set(r.eventType, (counts.get(r.eventType) ?? 0) + 1); roleOf.set(r.eventType, r.role); }
    const payload: LeadsPayload & { graph: unknown; claimMode: string } = {
      leads: result.leads, provider: setup.provider, episodes, queue, judgments: result.judgments,
      questions: Object.values(QUESTIONS), model: setup.judge.modelName, judge: setup.judge.stats,
      coverage: [...counts].map(([eventType, count]) => ({ eventType, count, role: roleOf.get(eventType)! })),
      notBuilt: ["Route 5 goal divergence (needs session goals)", "Embedding-based diversity (token sets are used)"],
      graph: inv.graph, claimMode: inv.claimMode,
    };
    send(res, 200, payload);
    return true;
  }

  // Audit store: analyst overrides (partition 3) and status.
  if (req.method === "POST" && p === "/api/audit/finding") {
    const b = await json();
    try {
      const f = auditStore().addFinding({ claimId: String(b.claimId), claimText: String(b.claimText ?? ""), originalVerdict: String(b.originalVerdict ?? ""), overrideVerdict: String(b.overrideVerdict), justification: String(b.justification ?? ""), analyst: String(b.analyst ?? "analyst") });
      send(res, 200, f);
    } catch (e) { send(res, 400, { error: e instanceof Error ? e.message : String(e) }); }
    return true;
  }
  if (req.method === "GET" && p === "/api/audit") {
    const s = auditStore();
    send(res, 200, { findings: s.listFindings(), rules: s.listRules(), classifierOutputs: s.countOutputs() });
    return true;
  }

  // Measured detection: blind sampling, labels, metrics.
  if (p.startsWith("/api/eval/")) {
    const store = auditStore();
    const qid = (url.searchParams.get("question") ?? "") as QuestionId;
    const body = req.method === "POST" || req.method === "DELETE" ? await json() : {};
    const question = (body.question ?? qid) as QuestionId;
    if (!(question in QUESTIONS)) return send(res, 400, { error: `Unknown question ${question}` }), true;

    if (req.method === "POST" && p === "/api/eval/sample") {
      const raw = loadRaw(body, fixtureDir);
      if (!raw) return send(res, 400, { error: "transcript or fixture is required" }), true;
      const inv = await investigate(raw, "eval");
      const labelled = new Set(store.listLabels(question).map((l) => l.inputHash));
      const rows = sampleRows(question, inv.records, labelled, Math.min(MAX_LABELS, Number(body.n ?? MAX_LABELS)));
      return send(res, 200, { question, rows, labelled: labelled.size, min: MIN_LABELS, max: MAX_LABELS }), true; // no model answers: labelling is blind
    }
    if (req.method === "GET" && p === "/api/eval/labels") return send(res, 200, { labels: store.listLabels(question), min: MIN_LABELS, max: MAX_LABELS, baseline: store.getBaseline(question) }), true;
    if (req.method === "POST" && p === "/api/eval/label") {
      if (store.listLabels(question).length >= MAX_LABELS && !store.listLabels(question).some((l) => l.inputHash === body.inputHash)) return send(res, 400, { error: `An evaluation set holds at most ${MAX_LABELS} rows.` }), true;
      store.saveLabel({ questionId: question, inputHash: String(body.inputHash), text: String(body.text), label: Boolean(body.label), source: "sample" });
      return send(res, 200, { ok: true, labels: store.listLabels(question).length }), true;
    }
    if (req.method === "POST" && p === "/api/eval/manual") {
      const text = String(body.text ?? "").trim();
      if (text.length < 4) return send(res, 400, { error: "Add some text for the row." }), true;
      store.saveLabel({ questionId: question, inputHash: SemanticJudge.hash(text), text, label: Boolean(body.label), source: "manual" });
      return send(res, 200, { ok: true, labels: store.listLabels(question).length }), true;
    }
    if (req.method === "DELETE" && p === "/api/eval/label") { store.deleteLabel(question, String(body.inputHash)); return send(res, 200, { ok: true }), true; }
    if (req.method === "POST" && p === "/api/eval/metrics") {
      const setup = judgeSetup(req);
      if (!setup) return send(res, 503, NO_JUDGE), true;
      const m = await computeMetrics(store, setup.judge, question, Number(body.threshold ?? 0.5));
      if (body.setBaseline && m.status === "measured" && m.precision !== null && m.recall !== null) { store.setBaseline(question, m.precision, m.recall, m.labels, m.model); m.baseline = store.getBaseline(question); m.regression = false; }
      return send(res, 200, m), true;
    }
    if (req.method === "GET" && p === "/api/eval/export") {
      res.writeHead(200, { "Content-Type": "application/x-ndjson", "Content-Disposition": `attachment; filename="${question}.jsonl"` });
      res.end(store.listLabels(question).map((l) => JSON.stringify({ questionId: l.questionId, inputHash: l.inputHash, text: l.text, label: l.label, source: l.source })).join("\n"));
      return true;
    }
  }
  return false;
}
