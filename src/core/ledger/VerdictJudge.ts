import type { AtomicClaim, SourceRecord } from "../types/contracts.js";
import { QUESTIONS } from "../semantic/questions.js";
import type { SemanticJudge } from "../semantic/SemanticJudge.js";
import type { Verdict } from "../graph/contracts.js";

export interface JudgedVerdict { verdict: Verdict; decisiveRecordId?: string; probability?: number }

const IDENT = /([\w./-]+\.(?:csv|json|txt|md|py|zip|html|pdf|log|yaml|yml|sql|xlsx|gz|tar)|https?:\/\/[^\s)"']+)/gi;
const idents = (s: string) => new Set((s.match(IDENT) ?? []).map((x) => x.toLowerCase()));

const textOf = (r: SourceRecord): string => {
  const p = r.payload as Record<string, unknown>;
  for (const k of ["content", "text", "statement", "stdout", "command", "output"]) if (typeof p[k] === "string" && p[k]) return p[k] as string;
  return JSON.stringify(p).slice(0, 400);
};

/**
 * Verdicts with a fixed rule and a model that only classifies pairs.
 * Relevance is structural first: an observation is a candidate when it shares an
 * exact identifier (file name, URL) with the claim, directly or through the
 * command that produced it. Only when nothing matches exactly do the latest
 * observations become candidates and the judge decides relevance.
 * For each claim, look at the candidate observations recorded BEFORE it, newest first.
 * The judge answers one fixed question per pair: does this observation
 * support the claim, contradict it, or say nothing about it? The first
 * observation that is not "unrelated" decides the verdict. If none is related,
 * the claim is UNRESOLVED. Later observations never count. The model never
 * decides the verdict, it only labels the relation the rule reads.
 */
export async function judgeVerdicts(claims: AtomicClaim[], records: SourceRecord[], judge: SemanticJudge, perClaim = 6, minP = 0.5): Promise<Map<string, JudgedVerdict>> {
  const sorted = [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const index = new Map(sorted.map((r, i) => [String(r.recordId), i]));
  const out = new Map<string, JudgedVerdict>();
  // The command that produced an observation: the nearest earlier attempt by the same agent.
  const producerOf = new Map<string, string>();
  sorted.forEach((r, i) => { if (r.role !== "OBSERVATION") return; for (let j = i - 1; j >= 0 && j >= i - 6; j--) if (sorted[j].role === "ATTEMPT" && sorted[j].agentId === r.agentId) { producerOf.set(String(r.recordId), textOf(sorted[j])); break; } });
  const producer = (o: SourceRecord) => producerOf.get(String(o.recordId)) ?? "";
  const jobs: Array<{ claim: AtomicClaim; obs: SourceRecord[] }> = [];
  for (const c of claims) {
    const at = index.get(String(c.sourceRecordId));
    if (at === undefined) { out.set(String(c.claimId), { verdict: "UNRESOLVED" }); continue; }
    const before = sorted.slice(0, at);
    const observations = before.filter((r) => r.role === "OBSERVATION");
    const claimIds = idents(c.statementText);
    const related = claimIds.size ? observations.filter((o) => { const mine = idents(`${textOf(o)} ${producer(o)}`); return [...claimIds].some((i) => mine.has(i)); }) : [];
    const pool = related.length ? related : observations;
    jobs.push({ claim: c, obs: pool.slice(-perClaim).reverse() });
  }
  const flat = jobs.flatMap((j) => j.obs.map((o) => ({ j, o })));
  // Two fixed questions about the same pair: is it the same target, and does it support or contradict.
  const js2 = await judge.judgeMany([QUESTIONS.Q_SAME_TARGET, QUESTIONS.Q_OBSERVATION_VS_CLAIM], flat.map(({ j, o }) => ({ text: `Claim: ${j.claim.statementText}\n\n${producer(o) ? `Command that produced the observation: ${producer(o).slice(0, 300)}\n\n` : ""}Observation recorded before the claim: ${textOf(o).slice(0, 700)}`, recordIds: [String(j.claim.sourceRecordId), String(o.recordId)] })));
  const js = js2.map((m) => (m.Q_SAME_TARGET && m.Q_SAME_TARGET.probability < 0.5 ? null : m.Q_OBSERVATION_VS_CLAIM ?? null));
  let k = 0;
  for (const j of jobs) {
    let decided: JudgedVerdict | null = null;
    for (const o of j.obs) {
      const a = js[k++];
      if (decided || !a) continue;
      const label = String(a.answer);
      if (label !== "unrelated" && a.probability >= minP) decided = { verdict: label === "supports" ? "SUPPORTED" : "CONTRADICTED", decisiveRecordId: String(o.recordId), probability: a.probability };
    }
    out.set(String(j.claim.claimId), decided ?? { verdict: "UNRESOLVED" });
  }
  return out;
}
