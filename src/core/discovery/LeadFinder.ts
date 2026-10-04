import type { SourceRecord } from "../types/contracts.js";
import { QUESTIONS, type SemanticJudgment } from "../semantic/questions.js";
import type { SemanticJudge } from "../semantic/SemanticJudge.js";
import type { Lead } from "../graph/contracts.js";

const textOf = (r: SourceRecord): string => {
  const p = r.payload as Record<string, unknown>;
  for (const k of ["content", "text", "statement", "stdout", "command", "output"]) if (typeof p[k] === "string" && p[k]) return p[k] as string;
  return JSON.stringify(p).slice(0, 400);
};

/** Probability that the question's answer is "true", whichever way the model answered. */
export const pTrue = (j: SemanticJudgment | null): number => (j ? (j.answer === true || j.answer === "true" ? j.probability : 1 - j.probability) : 0);

const IDENT = /([\w./-]+\.(?:csv|json|txt|md|py|zip|html|pdf|log|yaml|yml|sql)|https?:\/\/[^\s)]+|#\d{2,})/gi;
const WINDOW_MS = 15 * 60_000;

export interface LeadResult {
  leads: Lead[];
  judgments: Array<SemanticJudgment & { recordText: string }>;
  stats: { statements: number; judged: number; skippedByCap: number } & Record<string, number>;
}

/**
 * Hybrid Lead Finder. Every route has two stages: an exact structural pre-filter
 * (agent, order, time window, record type, identifier match), then fixed
 * versioned questions to the Semantic Judge on the rows that survived.
 * Routes built: 1 completion claim, 2 failure then claim, 3 cross-agent handoff
 * (no model), 4 correction signal, 6 silent failure. Route 5 (goal divergence)
 * needs session goals and is not built.
 */
export async function findLeads(records: SourceRecord[], judge: SemanticJudge, cap = 60): Promise<LeadResult> {
  const sorted = [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const episode = "EP-1";
  const leads: Lead[] = [];
  const log: LeadResult["judgments"] = [];
  const text = new Map(sorted.map((r) => [String(r.recordId), textOf(r)]));
  const ask = async (q: (typeof QUESTIONS)[keyof typeof QUESTIONS], rows: SourceRecord[]) => {
    const used = rows.slice(0, cap);
    const js = await judge.judge(q, used.map((r) => ({ text: text.get(String(r.recordId))!, recordIds: [String(r.recordId)] })));
    const byId = new Map<string, SemanticJudgment | null>();
    used.forEach((r, i) => { byId.set(String(r.recordId), js[i]); if (js[i]) log.push({ ...js[i]!, recordText: text.get(String(r.recordId))!.slice(0, 160) }); });
    return { byId, skipped: Math.max(0, rows.length - cap) };
  };

  const statements = sorted.filter((r) => r.role === "STATEMENT" && text.get(String(r.recordId))!.length > 3);
  const actions = sorted.filter((r) => r.role === "OBSERVATION");
  const claimQ = await ask(QUESTIONS.Q_CLAIMS_COMPLETION, statements);
  const failQ = await ask(QUESTIONS.Q_ACTION_FAILED, actions);
  const probQ = await ask(QUESTIONS.Q_REPORTS_PROBLEM, statements);
  const claim = (r: SourceRecord) => pTrue(claimQ.byId.get(String(r.recordId)) ?? null);
  const failed = (r: SourceRecord) => pTrue(failQ.byId.get(String(r.recordId)) ?? null);
  const problem = (r: SourceRecord) => pTrue(probQ.byId.get(String(r.recordId)) ?? null);
  const snippet = (r: SourceRecord) => text.get(String(r.recordId))!.replace(/\s+/g, " ").slice(0, 110);
  let seq = 0;
  const add = (l: Omit<Lead, "id" | "episode" | "passed">, threshold: number) => leads.push({ ...l, id: `L-${String(++seq).padStart(2, "0")}`, episode, passed: l.score >= threshold });

  // Route 1: completion claim.
  for (const r of statements) {
    const s = claim(r);
    if (s >= 0.1) add({ route: 1, routeName: "Completion claim", score: s, summary: `${r.agentId}: "${snippet(r)}"`, sql: "role = STATEMENT AND agent IS NOT NULL", questions: ["Q_CLAIMS_COMPLETION@2"] }, 0.6);
  }
  // Route 2: failed observation, then a completion claim by the same agent within 15 minutes or 3 turns.
  for (const o of actions) {
    const f = failed(o);
    if (f <= 0) continue;
    const idx = sorted.indexOf(o);
    const t0 = Date.parse(o.timestamp);
    const next = sorted.slice(idx + 1, idx + 1 + 3 * 3).filter((r) => r.role === "STATEMENT" && r.agentId === o.agentId && Date.parse(r.timestamp) - t0 <= WINDOW_MS).slice(0, 3);
    for (const c of next) {
      const s = f * claim(c);
      if (s >= 0.1) add({ route: 2, routeName: "Failure then claim", score: s, summary: `Failed result "${snippet(o)}" then ${c.agentId}: "${snippet(c)}"`, sql: "OBSERVATION then STATEMENT, same agent, ≤15 min / 3 turns", questions: ["Q_ACTION_FAILED@3", "Q_CLAIMS_COMPLETION@2"] }, 0.5);
    }
  }
  // Route 3: cross-agent handoff by exact identifier. No model involved.
  const seen = new Map<string, SourceRecord>();
  for (const r of sorted) {
    for (const id of new Set(textOf(r).match(IDENT) ?? [])) {
      const prev = seen.get(id);
      if (prev && prev.agentId !== r.agentId && Date.parse(r.timestamp) - Date.parse(prev.timestamp) <= 60 * 60_000) {
        add({ route: 3, routeName: "Cross-agent handoff", score: 1, summary: `${id} passed from ${prev.agentId} to ${r.agentId}`, sql: "identifier in agent X record AND agent Y later record, ≤60 min", questions: ["exact match only"] }, 0.5);
      }
      if (!prev) seen.set(id, r);
    }
  }
  // Route 4: correction signals after the first claim.
  const firstClaim = statements.find((r) => claim(r) > 0.5);
  if (firstClaim) {
    for (const r of statements.filter((x) => x.timestamp > firstClaim.timestamp)) {
      const s = problem(r);
      if (s >= 0.1) add({ route: 4, routeName: "Correction signal", score: s, summary: `${r.agentId}: "${snippet(r)}"`, sql: "STATEMENT after the first claim, any agent", questions: ["Q_REPORTS_PROBLEM@1"] }, 0.5);
    }
  }
  // Route 6: silent failure. A failed observation with no later success on the same target.
  for (const o of actions) {
    const f = failed(o);
    if (f <= 0) continue;
    const target = (textOf(o).match(IDENT) ?? [])[0];
    const later = actions.filter((x) => x.timestamp > o.timestamp && (!target || textOf(x).includes(target)));
    if (!later.some((x) => failed(x) < 0.3 && failQ.byId.get(String(x.recordId)))) {
      add({ route: 6, routeName: "Silent failure", score: f, summary: `No later success for "${snippet(o)}"`, sql: "OBSERVATION judged failed, no later success on the same target", questions: ["Q_ACTION_FAILED@3"] }, 0.5);
    }
  }
  leads.sort((a, b) => b.score - a.score);
  return { leads, judgments: log, stats: { statements: statements.length, judged: log.length, skippedByCap: claimQ.skipped + failQ.skipped + probQ.skipped } };
}
