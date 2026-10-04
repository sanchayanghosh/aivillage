import type { EpisodeAnalysis } from "../episodes/EpisodeLoader.js";
import type { SourceRecord } from "../types/contracts.js";
import type { GEdge, GNode, GraphPayload, LinkBasis, Verdict } from "./contracts.js";

const clip = (s: string, n = 44) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const hhmmss = (ts: string) => /(\d{2}:\d{2}:\d{2})/.exec(ts)?.[1] ?? ts;

function textOf(r: SourceRecord): string {
  const p = r.payload as Record<string, unknown>;
  for (const k of ["content", "text", "statement", "stdout", "command", "output"]) {
    if (typeof p[k] === "string" && p[k]) return p[k] as string;
  }
  return JSON.stringify(p).slice(0, 240);
}

const FAIL = /\b(0\s+(data\s+)?rows|empty|error|failed|timed out|no (contacts|results)|not found|403)\b/i;

/** Does an observation refute (false), support (true) or say nothing (null) about a claim? */
function outcomeFor(obs: SourceRecord, qty?: number): boolean | null {
  const t = textOf(obs);
  if (FAIL.test(t)) return false;
  const code = (obs.payload as Record<string, unknown>).exit_code;
  if (code !== undefined && code !== 0) return false;
  if (qty !== undefined && new RegExp(`\\b${qty}\\b`).test(t)) return true;
  if (/\b(success|succeeded|ok|written|saved|paused|done)\b/i.test(t)) return true;
  return null;
}

/**
 * Step 1 view of an episode: agents, claims, attempts, observations, with the
 * ledger rule applied. Verdict = latest relevant observation before the claim;
 * later observations never change it. Everything here is rule-based, so no
 * claim is marked MODEL_ASSISTED.
 */
export function buildGraph(analysis: EpisodeAnalysis): GraphPayload {
  const { packet, claims } = analysis;
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  let edgeSeq = 0;
  const link = (source: string, target: string, edgeType: GEdge["edgeType"], basis: LinkBasis) =>
    edges.push({ id: `e${++edgeSeq}`, source, target, edgeType, basis });

  const agents = [...new Set(packet.records.map((r) => String(r.agentId)))];
  for (const a of agents) {
    const count = packet.records.filter((r) => r.agentId === a).length;
    nodes.push({ id: `agent:${a}`, label: a, nodeType: "AGENT", sourceRecordId: a, previewText: `Agent ${a} produced ${count} records in this episode.`, props: { Records: String(count) } });
  }

  const observations = packet.records.filter((r) => r.role === "OBSERVATION").sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const attempts = packet.records.filter((r) => r.role === "ATTEMPT");
  for (const r of observations) {
    nodes.push({ id: `rec:${r.recordId}`, label: clip(textOf(r)), nodeType: "OBSERVATION", time: hhmmss(r.timestamp), agent: String(r.agentId), sourceRecordId: String(r.recordId), previewText: textOf(r), props: { Event: r.eventType } });
  }
  for (const r of attempts) {
    nodes.push({ id: `rec:${r.recordId}`, label: clip(textOf(r)), nodeType: "ATTEMPT", time: hhmmss(r.timestamp), agent: String(r.agentId), sourceRecordId: String(r.recordId), previewText: textOf(r), props: { Event: r.eventType } });
    link(`rec:${r.recordId}`, `agent:${r.agentId}`, "REPORTED_BY", "EXPLICIT_LINK");
    const next = observations.find((o) => o.agentId === r.agentId && o.timestamp >= r.timestamp);
    if (next) link(`rec:${r.recordId}`, `rec:${next.recordId}`, "PRODUCED", "EXPLICIT_LINK");
  }

  for (const c of claims) {
    const source = packet.records.find((r) => r.recordId === c.sourceRecordId)!;
    const before = observations.filter((o) => o.timestamp < source.timestamp);
    const relevant = before.filter((o) => outcomeFor(o, c.expectedQuantity) !== null);
    const latest = relevant.at(-1);
    const outcome = latest ? outcomeFor(latest, c.expectedQuantity) : null;
    const verdict: Verdict = outcome === false ? "CONTRADICTED" : outcome === true ? "SUPPORTED" : "UNRESOLVED";
    nodes.push({
      id: `claim:${c.claimId}`, label: clip(c.statementText), nodeType: "CLAIM", verdict, modelAssisted: false, time: hhmmss(source.timestamp), agent: String(source.agentId),
      sourceRecordId: String(c.sourceRecordId), previewText: `"${textOf(source)}" → ${c.statementText}`,
      props: { Quantity: c.expectedQuantity !== undefined ? String(c.expectedQuantity) : "n/a", Rule: "latest relevant observation before the claim decides" },
    });
    link(`claim:${c.claimId}`, `agent:${source.agentId}`, "REPORTED_BY", "EXPLICIT_LINK");
    if (latest) {
      const basis: LinkBasis = c.expectedQuantity !== undefined && new RegExp(`\\b${c.expectedQuantity}\\b`).test(textOf(latest)) ? "IDENTIFIER_MATCH" : "EXPLICIT_LINK";
      link(`claim:${c.claimId}`, `rec:${latest.recordId}`, verdict === "CONTRADICTED" ? "CONTRADICTED_BY" : "SUPPORTED_BY", basis);
    }
  }

  // Later chatter from other agents referencing a claimed artifact becomes a reliance edge.
  const statements = packet.records.filter((r) => r.role === "STATEMENT");
  for (const c of claims) {
    const src = statements.find((r) => r.recordId === c.sourceRecordId)!;
    for (const later of statements.filter((r) => r.timestamp > src.timestamp && r.agentId !== src.agentId)) {
      if (/(endors|rely|relying|confirm|agree|proceed|preparing)/i.test(textOf(later))) {
        link(`agent:${later.agentId}`, `claim:${c.claimId}`, "RELIED_ON_BY", "SEMANTIC_LINK");
        break;
      }
    }
  }
  return { episodeId: packet.episodeId, source: "fixture", nodes, edges };
}
