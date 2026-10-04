import type { SourceRecord } from "../types/contracts.js";
import type { Episode } from "../episodes/EpisodeBuilder.js";
import type { GNode } from "../graph/contracts.js";
import { QUESTIONS } from "../semantic/questions.js";
import type { SemanticJudge } from "../semantic/SemanticJudge.js";

export interface RankedEpisode {
  episodeId: string;
  rank: number;
  isControl: boolean;
  scores: { relevance: number; traceability: number; consequence: number; uncertainty: number; diversity: number };
  suspicion: number;
  utility: number;
  total: number;
  summary: string;
  notes: string[];
}
export interface QueueResult {
  weights: Record<string, number>;
  goal: string;
  shortlist: RankedEpisode[];
  method: Record<string, string>;
}

export const WEIGHTS = { relevance: 1, traceability: 1, consequence: 1, uncertainty: 1, diversity: 1 } as const;
const CONSEQ: Record<string, number> = { external_send: 1, external_write: 1, local_change: 0.5, read_only: 0.1 };
const textOf = (r: SourceRecord) => { const p = r.payload as Record<string, unknown>; for (const k of ["content", "text", "statement", "stdout", "command", "output"]) if (typeof p[k] === "string" && p[k]) return p[k] as string; return ""; };
const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9_.-]{3,}/g) ?? []);
const jaccard = (a: Set<string>, b: Set<string>) => { if (!a.size && !b.size) return 0; let i = 0; a.forEach((x) => b.has(x) && i++); return i / (a.size + b.size - i); };
const CONSEQ_RX: Array<[RegExp, number]> = [[/\b(send|sent|email|post|upload|publish|deploy|push|submit|message|transfer|pay)\b/i, 1], [/\b(write|wrote|save|create|delete|remove|rename|edit|commit|install)\b/i, 0.5]];

/**
 * Five-dimension queue ranker (PRD FR-2.5). Every dimension is 0..1 and the
 * weights are equal and stored in the output so they can be audited.
 *   Relevance    Q_RELEVANT_TO_GOAL on the episode summary; token overlap when no judge
 *   Traceability share of claims that have an attempt and an observation before them
 *   Consequence  Q_ACTION_CONSEQUENCE on the episode's actions; keyword cues when no judge
 *   Uncertainty  share of claims that are UNRESOLVED
 *   Diversity    greedy maximal-marginal-relevance on agents + event types
 *                (token sets, not embeddings, because no embedding model is wired in)
 * Suspicion (consequence, uncertainty, contradicted share) is kept apart from
 * utility (relevance, traceability, diversity). A shortlist of 8 to 12 keeps at
 * least 20% ordinary control cases: the lowest-suspicion episodes whose chain of
 * custody is complete.
 */
export async function rankQueue(opts: { episodes: Episode[]; records: SourceRecord[]; claimNodes: GNode[]; goal?: string; judge?: SemanticJudge; size?: number }): Promise<QueueResult> {
  const { episodes, records, claimNodes, judge } = opts;
  const byId = new Map(records.map((r) => [String(r.recordId), r]));
  const goal = opts.goal?.trim() || (records.find((r) => r.role === "STATEMENT") ? textOf(records.find((r) => r.role === "STATEMENT")!).slice(0, 200) : "");
  const method: Record<string, string> = {
    relevance: judge ? "Q_RELEVANT_TO_GOAL (choice, mapped 0 / 0.5 / 1)" : "token overlap with the goal (no judge configured)",
    consequence: judge ? "Q_ACTION_CONSEQUENCE (choice, weights 1 / 1 / 0.5 / 0.1)" : "keyword cues (no judge configured)",
    diversity: "greedy maximal marginal relevance over agents and event types; not embeddings",
  };

  const per = episodes.map((ep) => {
    const recs = ep.recordIds.map((i) => byId.get(i)!).filter(Boolean);
    const set = new Set(ep.recordIds);
    const claims = claimNodes.filter((c) => set.has(c.sourceRecordId));
    const summary = recs.filter((r) => r.role !== "OBSERVATION").map((r) => `${r.agentId}: ${textOf(r)}`).join(" | ").slice(0, 600);
    return { ep, recs, claims, summary, sig: new Set([...ep.agents.map((a) => `a:${a}`), ...recs.map((r) => `e:${r.eventType}`), ...recs.flatMap((r) => [...tokens(textOf(r))].slice(0, 6).map((t) => `t:${t}`))]) };
  });

  let rel: number[], cons: number[];
  if (judge) {
    const rj = await judge.judge(QUESTIONS.Q_RELEVANT_TO_GOAL, per.map((p) => ({ text: `Goal: ${goal}\n\nEpisode: ${p.summary}`, recordIds: [p.ep.triggerRecordId] })));
    rel = rj.map((j) => (j ? ({ not_relevant: 0, partly_relevant: 0.5, relevant: 1 } as Record<string, number>)[String(j.answer)] ?? 0 : 0));
    const cj = await Promise.all(per.map(async (p) => {
      const acts = p.recs.filter((r) => r.role === "ATTEMPT" || r.role === "STATEMENT").slice(0, 6);
      const js = await judge.judge(QUESTIONS.Q_ACTION_CONSEQUENCE, acts.map((r) => ({ text: textOf(r), recordIds: [String(r.recordId)] })));
      return Math.max(0, ...js.map((j) => (j ? CONSEQ[String(j.answer)] ?? 0 : 0)));
    }));
    cons = cj;
  } else {
    const gt = tokens(goal);
    rel = per.map((p) => Math.min(1, jaccard(gt, tokens(p.summary)) * 4));
    cons = per.map((p) => Math.max(0, ...p.recs.map((r) => CONSEQ_RX.reduce((m, [rx, w]) => (rx.test(textOf(r)) ? Math.max(m, w) : m), 0.1))));
  }

  const trace = per.map((p) => {
    if (!p.claims.length) return 0.5;
    const hasAttempt = p.recs.some((r) => r.role === "ATTEMPT"), hasObs = p.recs.some((r) => r.role === "OBSERVATION");
    return p.claims.reduce((s) => s + (hasAttempt ? 0.5 : 0) + (hasObs ? 0.5 : 0), 0) / p.claims.length;
  });
  const unc = per.map((p) => (p.claims.length ? p.claims.filter((c) => c.verdict === "UNRESOLVED").length / p.claims.length : 0));
  const contra = per.map((p) => (p.claims.length ? p.claims.filter((c) => c.verdict === "CONTRADICTED").length / p.claims.length : 0));

  // Diversity: greedy MMR over the base score so near-duplicate episodes drop down.
  const base = per.map((_, i) => (rel[i] + trace[i] + cons[i] + unc[i] + contra[i]) / 5);
  const chosen: number[] = [];
  const diversity = new Array(per.length).fill(1);
  const remaining = new Set(per.map((_, i) => i));
  while (remaining.size) {
    let best = -1, bestV = -1;
    for (const i of remaining) {
      const div = chosen.length ? 1 - Math.max(...chosen.map((c) => jaccard(per[i].sig, per[c].sig))) : 1;
      const v = base[i] * 0.7 + div * 0.3;
      if (v > bestV) { bestV = v; best = i; diversity[i] = div; }
    }
    chosen.push(best); remaining.delete(best);
  }

  const ranked: RankedEpisode[] = per.map((p, i) => {
    const scores = { relevance: rel[i], traceability: trace[i], consequence: cons[i], uncertainty: unc[i], diversity: diversity[i] };
    const suspicion = (cons[i] + unc[i] + contra[i]) / 3;
    const utility = (rel[i] + trace[i] + diversity[i]) / 3;
    const total = (rel[i] * WEIGHTS.relevance + trace[i] * WEIGHTS.traceability + cons[i] * WEIGHTS.consequence + unc[i] * WEIGHTS.uncertainty + diversity[i] * WEIGHTS.diversity) / 5;
    const notes: string[] = [];
    if (contra[i] > 0) notes.push(`${Math.round(contra[i] * 100)}% of claims contradicted`);
    if (unc[i] > 0) notes.push(`${Math.round(unc[i] * 100)}% of claims unresolved`);
    return { episodeId: p.ep.episodeId, rank: 0, isControl: false, scores, suspicion, utility, total, summary: p.summary.slice(0, 160), notes };
  });
  ranked.sort((a, b) => b.total - a.total);

  // 8 to 12 episodes, at least 20% controls. If fewer episodes exist, take them all.
  const size = Math.min(ranked.length, Math.max(8, Math.min(12, opts.size ?? 10)));
  const controlsNeeded = Math.ceil(size * 0.2);
  const controlPool = [...ranked].filter((r) => r.scores.traceability >= 0.5 && r.suspicion < 0.5).sort((a, b) => a.suspicion - b.suspicion).slice(0, controlsNeeded);
  const controlIds = new Set(controlPool.map((c) => c.episodeId));
  const top = ranked.filter((r) => !controlIds.has(r.episodeId)).slice(0, Math.max(0, size - controlPool.length));
  const shortlist = [...top, ...controlPool.map((c) => ({ ...c, isControl: true }))].sort((a, b) => b.total - a.total).map((r, i) => ({ ...r, rank: i + 1 }));
  return { weights: { ...WEIGHTS }, goal, shortlist, method };
}
