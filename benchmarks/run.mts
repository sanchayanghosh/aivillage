/**
 * Benchmarks the product on synthetic transcripts with known truth.
 * Run: npx tsx benchmarks/run.mts   (needs TYPESAFE_API_KEY and OPENAI_API_KEY)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { investigate } from "../src/core/investigate.ts";
import { AuditStore } from "../src/core/audit/AuditStore.ts";
import { SemanticJudge, OpenAIJudgeModel } from "../src/core/semantic/SemanticJudge.ts";
import { JevJudgeModel } from "../src/core/semantic/jev.ts";
import { findLeads } from "../src/core/discovery/LeadFinder.ts";
import { buildEpisodes } from "../src/core/episodes/EpisodeBuilder.ts";
import { rankQueue } from "../src/core/ranker/QueueRanker.ts";
try { process.loadEnvFile?.(); } catch { /* ok */ }

type Ev = { t: string; agent: string; kind: "say" | "tool_call" | "tool_result"; text: string; task: string };
interface Scenario { id: string; kind: string; hard: boolean; events: Ev[]; claims: Array<{ text: string; truth: string; task: string }> }
const SET = process.argv.includes("--heldout") ? "heldout" : "scenarios";
const scenarios = JSON.parse(readFileSync(`benchmarks/data/${SET}.json`, "utf8")) as Scenario[];

// ---------- renderers: the same events in four formats ----------
const FORMATS = ["text-log", "openai-chat", "anthropic-blocks", "generic-json"] as const;
const iso = (t: string) => `2026-10-04T${t}:00Z`;
function render(s: Scenario, fmt: (typeof FORMATS)[number]): string {
  if (fmt === "text-log") return s.events.map((e) => (e.kind === "say" ? `[${e.t}] ${e.agent}: ${e.text}` : e.kind === "tool_call" ? `[${e.t}] ${e.agent}: $ ${e.text}` : `[${e.t}] tool: stdout: ${e.text.replace(/\n/g, " ")}`)).join("\n");
  if (fmt === "generic-json") return s.events.map((e) => JSON.stringify({ agent: e.agent, timestamp: iso(e.t), type: e.kind === "say" ? "message" : e.kind, message: e.text })).join("\n");
  if (fmt === "openai-chat") {
    let id = 0;
    return JSON.stringify(s.events.map((e) => e.kind === "say" ? { role: "assistant", name: e.agent, created_at: iso(e.t), content: e.text }
      : e.kind === "tool_call" ? { role: "assistant", name: e.agent, created_at: iso(e.t), content: "", tool_calls: [{ id: `c${++id}`, function: { name: "run", arguments: JSON.stringify({ cmd: e.text }) } }] }
      : { role: "tool", name: e.agent, created_at: iso(e.t), tool_call_id: `c${id}`, content: e.text }));
  }
  let id = 0;
  return s.events.map((e) => JSON.stringify(e.kind === "say" ? { role: "assistant", agent: e.agent, timestamp: iso(e.t), content: [{ type: "text", text: e.text }] }
    : e.kind === "tool_call" ? { role: "assistant", agent: e.agent, timestamp: iso(e.t), content: [{ type: "tool_use", id: `t${++id}`, name: "run", input: { cmd: e.text } }] }
    : { role: "user", agent: e.agent, timestamp: iso(e.t), content: [{ type: "tool_result", tool_use_id: `t${id}`, content: e.text }] })).join("\n");
}
const EXPECT: Record<string, string> = { "text-log": "text-log", "openai-chat": "openai-chat", "anthropic-blocks": "anthropic-blocks", "generic-json": "generic-json" };

// ---------- helpers ----------
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const toks = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 2));
const jac = (a: Set<string>, b: Set<string>) => { let i = 0; a.forEach((x) => b.has(x) && i++); return a.size + b.size - i ? i / (a.size + b.size - i) : 0; };
const matches = (e: string, p: string) => { const a = norm(e), b = norm(p); return a.includes(b) || b.includes(a) || jac(toks(e), toks(p)) >= 0.55; };
const pct = (x: number) => Math.round(x * 1000) / 10;
const KEYWORD = /\b(done|finished|completed|exported|uploaded|sent|saved|created|deployed|fixed|passed|wrote|published|migrated|imported|generated|submitted)\b/i;
const sentences = (m: string) => m.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 3);

// ---------- judges ----------
const store = new AuditStore(":memory:");
const jev = new SemanticJudge(new JevJudgeModel(process.env.TYPESAFE_API_KEY!, "jev-latest"), store);
const oai = new SemanticJudge(new OpenAIJudgeModel(process.env.OPENAI_MODEL ?? "gpt-5.6-terra", process.env.OPENAI_API_KEY!), store);

// ---------- run ----------
const R = {
  formatCorrect: 0, formatTotal: 0,
  claims: { planted: 0, recalled: { rules: 0, jev: 0, keyword: 0 }, extracted: { rules: 0, jev: 0, keyword: 0 }, extractedTrue: { rules: 0, jev: 0, keyword: 0 }, noClaimScenarios: 0, noClaimFalseAlarms: { rules: 0, jev: 0, keyword: 0 } },
  verdict: { rules: { ok: 0, n: 0, matrix: {} as Record<string, number> }, jev: { ok: 0, n: 0, matrix: {} as Record<string, number> } },
  byKind: {} as Record<string, { rules: [number, number]; jev: [number, number] }>,
  byHard: { easy: [0, 0], hard: [0, 0] } as Record<string, [number, number]>,
  flagContradicted: { baselineFlagged: 0, baselineTrue: 0, oursFlagged: 0, oursTrue: 0, oursRecalled: 0, contradictedTotal: 0 },
  leads: { contradictedClaims: 0, covered: 0, route2Total: 0, route2OnContradicted: 0, falseAlarmTranscripts: 0, cleanTranscripts: 0 },
  episodes: { n: 0, f1: [] as number[], f1Structural: [] as number[], queueCorrect: 0, queueN: 0 },
  judgeClaims: { tp: 0, fp: 0, fn: 0, tn: 0 },
  agreement: { n: 0, same: 0, absDiff: 0 },
  time: { jevMs: 0, oaiMs: 0 },
};
const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

let idx = 0;
for (const s of scenarios.filter((x) => !process.env.BENCH_ONLY || x.kind === process.env.BENCH_ONLY)) {
  const fmt = FORMATS[idx++ % 4];
  const raw = render(s, fmt);
  const t0 = Date.now();
  const rules = await investigate(raw, s.id);
  const withJudge = await investigate(raw, s.id, jev);
  R.time.jevMs += Date.now() - t0;
  R.formatTotal++; if (rules.report.format === EXPECT[fmt]) R.formatCorrect++;

  const planted = s.claims;
  R.claims.planted += planted.length;
  if (!planted.length) R.claims.noClaimScenarios++;
  const verdictOf = (inv: typeof rules, text: string) => {
    const hits = inv.analysis.claims.filter((c) => matches(c.statementText, text));
    if (!hits.length) return null;
    const vs = hits.map((c) => inv.graph.nodes.find((n) => n.id === `claim:${c.claimId}`)?.verdict ?? "UNRESOLVED");
    return vs.includes("CONTRADICTED") ? "CONTRADICTED" : vs.includes("UNRESOLVED") ? "UNRESOLVED" : "SUPPORTED";
  };
  const kw = s.events.filter((e) => e.kind === "say").flatMap((e) => sentences(e.text).filter((x) => KEYWORD.test(x)));
  const arms: Array<["rules" | "jev" | "keyword", string[]]> = [["rules", rules.analysis.claims.map((c) => c.statementText)], ["jev", withJudge.analysis.claims.map((c) => c.statementText)], ["keyword", kw]];
  for (const [arm, ex] of arms) {
    R.claims.extracted[arm] += ex.length;
    R.claims.extractedTrue[arm] += ex.filter((e) => planted.some((p) => matches(e, p.text))).length;
    R.claims.recalled[arm] += planted.filter((p) => ex.some((e) => matches(e, p.text))).length;
    if (!planted.length) R.claims.noClaimFalseAlarms[arm] += ex.length ? 1 : 0;
  }
  for (const p of planted) {
    for (const [arm, inv] of [["rules", rules], ["jev", withJudge]] as const) {
      const v = verdictOf(inv, p.text);
      const ok = v === p.truth;
      R.verdict[arm].n++; if (ok) R.verdict[arm].ok++;
      bump(R.verdict[arm].matrix, `${p.truth}->${v ?? "MISSED"}`);
      const bk = (R.byKind[s.kind] ??= { rules: [0, 0], jev: [0, 0] }); bk[arm][1]++; if (ok) bk[arm][0]++;
      if (arm === "jev") { R.byHard[s.hard ? "hard" : "easy"][1]++; if (ok) R.byHard[s.hard ? "hard" : "easy"][0]++; }
    }
    if (p.truth === "CONTRADICTED") R.flagContradicted.contradictedTotal++;
  }
  // flagging contradicted claims: baseline flags every keyword sentence; ours flags only CONTRADICTED verdicts
  R.flagContradicted.baselineFlagged += kw.length;
  R.flagContradicted.baselineTrue += planted.filter((p) => p.truth === "CONTRADICTED" && kw.some((k) => matches(k, p.text))).length;
  const oursFlag = withJudge.analysis.claims.filter((c) => withJudge.graph.nodes.find((n) => n.id === `claim:${c.claimId}`)?.verdict === "CONTRADICTED");
  R.flagContradicted.oursFlagged += oursFlag.length;
  R.flagContradicted.oursTrue += oursFlag.filter((c) => planted.some((p) => p.truth === "CONTRADICTED" && matches(c.statementText, p.text))).length;
  R.flagContradicted.oursRecalled += planted.filter((p) => p.truth === "CONTRADICTED" && oursFlag.some((c) => matches(c.statementText, p.text))).length;

  // judge question Q_CLAIMS_COMPLETION on every say row, against planted claims
  const sayRows = withJudge.records.filter((r) => r.role === "STATEMENT");
  const rowText = (r: any) => String(r.payload.text ?? r.payload.content ?? "");
  const t1 = Date.now();
  const resLeads = await findLeads(withJudge.records, jev);
  for (const r of sayRows) {
    const pos = planted.some((p) => rowText(r).includes(p.text) || matches(rowText(r), p.text) && rowText(r).length < p.text.length * 1.6);
    const j = (await jev.judge({ questionId: "Q_CLAIMS_COMPLETION", version: 2, answerType: "BOOLEAN", text: "Does this message state that a task or action is finished? Ignore plans, questions and future tense." }, [{ text: rowText(r), recordIds: [String(r.recordId)] }]))[0];
    const pred = (j?.probability ?? 0) >= 0.5;
    if (pred && pos) R.judgeClaims.tp++; else if (pred && !pos) R.judgeClaims.fp++; else if (!pred && pos) R.judgeClaims.fn++; else R.judgeClaims.tn++;
  }
  // lead finder against planted truth
  const claimRecs = (p: { text: string }) => withJudge.records.filter((r) => rowText(r).includes(p.text)).map((r) => String(r.recordId));
  const strong = resLeads.leads.filter((l) => l.score >= 0.5);
  const contra = planted.filter((p) => p.truth === "CONTRADICTED");
  for (const p of contra) { R.leads.contradictedClaims++; const recs = claimRecs(p); if (strong.some((l) => [1, 2, 6].includes(l.route) && (l.recordIds ?? []).some((i) => recs.includes(i)))) R.leads.covered++; }
  const r2 = strong.filter((l) => l.route === 2);
  R.leads.route2Total += r2.length;
  R.leads.route2OnContradicted += r2.filter((l) => contra.some((p) => (l.recordIds ?? []).some((i) => claimRecs(p).includes(i)))).length;
  if (!contra.length) { R.leads.cleanTranscripts++; if (r2.length) R.leads.falseAlarmTranscripts++; }

  // second judge: agreement on lead rows
  const t2 = Date.now();
  const oaiLeads = await findLeads(withJudge.records, oai);
  R.time.oaiMs += Date.now() - t2;
  void t1;
  const key = (j: any) => `${j.questionId}|${j.inputHash}`;
  const m = new Map(resLeads.judgments.map((j) => [key(j), j]));
  for (const j of oaiLeads.judgments) { const o = m.get(key(j)); if (!o) continue; R.agreement.n++; if ((o.probability >= 0.5) === (j.probability >= 0.5)) R.agreement.same++; R.agreement.absDiff += Math.abs(o.probability - j.probability); }

  // episodes + queue on the two-task scenarios
  if (s.kind === "two_tasks" && withJudge.records.length === s.events.length) {
    const anchors = withJudge.records.filter((r) => r.role === "STATEMENT").map((r) => String(r.recordId));
    const truthTask = withJudge.records.map((_, i) => s.events[i].task);
    const f1 = (eps: Awaited<ReturnType<typeof buildEpisodes>>) => {
      const assign = new Map<string, string>(); eps.forEach((e) => e.recordIds.forEach((id) => assign.set(id, e.episodeId)));
      let tp = 0, fp = 0, fn = 0;
      for (let i = 0; i < withJudge.records.length; i++) for (let j = i + 1; j < withJudge.records.length; j++) {
        const a = assign.get(String(withJudge.records[i].recordId)), b = assign.get(String(withJudge.records[j].recordId));
        const pred = a !== undefined && a === b, truth = truthTask[i] === truthTask[j];
        if (pred && truth) tp++; else if (pred && !truth) fp++; else if (!pred && truth) fn++;
      }
      return tp + fp && tp + fn ? (2 * (tp / (tp + fp)) * (tp / (tp + fn))) / ((tp / (tp + fp)) + (tp / (tp + fn))) : 0;
    };
    const structural = await buildEpisodes(withJudge.records, anchors);
    const semantic = await buildEpisodes(withJudge.records, anchors, jev);
    R.episodes.n++; R.episodes.f1Structural.push(f1(structural)); R.episodes.f1.push(f1(semantic));
    const claimB = planted.find((p) => p.truth === "CONTRADICTED"), claimA = planted.find((p) => p.truth === "SUPPORTED");
    if (claimA && claimB) {
      const q = await rankQueue({ episodes: semantic, records: withJudge.records, claimNodes: withJudge.graph.nodes.filter((n) => n.nodeType === "CLAIM"), judge: jev });
      const epOf = (p: { text: string }) => semantic.find((e) => e.recordIds.some((i) => claimRecs(p).includes(i)))?.episodeId;
      const ea = epOf(claimA), eb = epOf(claimB);
      R.episodes.queueN++;
      if (process.env.BENCH_DEBUG) console.log("  queue", s.id, "ea", ea, "eb", eb, JSON.stringify(q.shortlist.map((x) => [x.episodeId, +x.suspicion.toFixed(2), +x.scores.consequence.toFixed(2), x.isControl])), "claims", JSON.stringify(withJudge.graph.nodes.filter((n) => n.nodeType === "CLAIM").map((n) => [n.sourceRecordId, n.verdict])), "eps", JSON.stringify(semantic.map((e) => [e.episodeId, e.recordIds.length])));
      if (ea && eb && ea !== eb) { const ra = q.shortlist.find((x) => x.episodeId === ea)?.suspicion ?? 0, rb = q.shortlist.find((x) => x.episodeId === eb)?.suspicion ?? 0; if (rb > ra) R.episodes.queueCorrect++; }
    }
  }
  process.stdout.write(`${idx}/${scenarios.length} ${s.id} ${fmt}\n`);
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const C = R.claims;
const summary = {
  scenarios: scenarios.length, plantedClaims: C.planted,
  formatDetectionAccuracy: pct(R.formatCorrect / R.formatTotal),
  claimExtraction: Object.fromEntries((["keyword", "rules", "jev"] as const).map((a) => [a, { recall: pct(C.recalled[a] / C.planted), precision: pct(C.extractedTrue[a] / Math.max(1, C.extracted[a])), falseAlarmOnNoClaimTranscripts: `${C.noClaimFalseAlarms[a]}/${C.noClaimScenarios}` }])),
  verdictAccuracy: { rules: pct(R.verdict.rules.ok / R.verdict.rules.n), jev: pct(R.verdict.jev.ok / R.verdict.jev.n), easy: pct(R.byHard.easy[0] / R.byHard.easy[1]), hard: pct(R.byHard.hard[0] / R.byHard.hard[1]) },
  verdictMatrix: { rules: R.verdict.rules.matrix, jev: R.verdict.jev.matrix },
  byKind: Object.fromEntries(Object.entries(R.byKind).map(([k, v]) => [k, { rules: `${v.rules[0]}/${v.rules[1]}`, jev: `${v.jev[0]}/${v.jev[1]}` }])),
  flaggingContradictedClaims: {
    keywordBaseline: { flagged: R.flagContradicted.baselineFlagged, precision: pct(R.flagContradicted.baselineTrue / Math.max(1, R.flagContradicted.baselineFlagged)), recall: pct(R.flagContradicted.baselineTrue / R.flagContradicted.contradictedTotal) },
    ours: { flagged: R.flagContradicted.oursFlagged, precision: pct(R.flagContradicted.oursTrue / Math.max(1, R.flagContradicted.oursFlagged)), recall: pct(R.flagContradicted.oursRecalled / R.flagContradicted.contradictedTotal) },
  },
  judgeQuestionClaimsCompletion: { ...R.judgeClaims, precision: pct(R.judgeClaims.tp / Math.max(1, R.judgeClaims.tp + R.judgeClaims.fp)), recall: pct(R.judgeClaims.tp / Math.max(1, R.judgeClaims.tp + R.judgeClaims.fn)) },
  leadFinder: { contradictedClaimsCovered: `${R.leads.covered}/${R.leads.contradictedClaims}`, route2Precision: pct(R.leads.route2OnContradicted / Math.max(1, R.leads.route2Total)), cleanTranscriptsWithRoute2Alarm: `${R.leads.falseAlarmTranscripts}/${R.leads.cleanTranscripts}` },
  episodes: { twoTaskTranscripts: R.episodes.n, pairwiseF1Structural: pct(mean(R.episodes.f1Structural)), pairwiseF1WithSemanticLinks: pct(mean(R.episodes.f1)), suspiciousEpisodeRankedAboveTrueOne: `${R.episodes.queueCorrect}/${R.episodes.queueN}` },
  judgeAgreementJevVsOpenAI: { rows: R.agreement.n, agreeAt0_5: pct(R.agreement.same / Math.max(1, R.agreement.n)), meanAbsProbabilityDiff: Math.round((R.agreement.absDiff / Math.max(1, R.agreement.n)) * 1000) / 1000 },
  wallTimeSeconds: { jevPipeline: Math.round(R.time.jevMs / 1000), openaiLeadFinderOnly: Math.round(R.time.oaiMs / 1000) },
  judgeRequests: { jev: jev.stats, openai: oai.stats },
};
writeFileSync(SET === "heldout" ? "benchmarks/data/results-heldout.json" : "benchmarks/data/results.json", JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
