import type { SourceRecord } from "../types/contracts.js";
import { QUESTIONS } from "../semantic/questions.js";
import type { SemanticJudge } from "../semantic/SemanticJudge.js";

export type BoundaryBasis = "EXPLICIT_LINK" | "IDENTIFIER_MATCH" | "SEMANTIC_LINK";
export interface EpisodeLink { from: string; to: string; basis: BoundaryBasis; probability?: number }
export interface Episode {
  episodeId: string;
  anchorRecordIds: string[];
  recordIds: string[];
  triggerRecordId: string;
  terminalRecordId: string;
  agents: string[];
  startTime: string;
  endTime: string;
  links: EpisodeLink[];
  basisCounts: Record<BoundaryBasis, number>;
  justification: string;
  mergedFrom: string[];
}

const IDENT = /([\w./-]+\.(?:csv|json|txt|md|py|zip|html|pdf|log|yaml|yml|sql|xlsx)|https?:\/\/[^\s)"']+|#\d{2,})/gi;
const EXPLICIT_KEYS = ["parent_message_id", "task_delegation_id", "thread_id", "parent_thought_id", "parent_id", "reply_to", "tool_id"];
const WINDOW_MS = 60 * 60_000;
const SEMANTIC_WINDOW_MS = 15 * 60_000;

const textOf = (r: SourceRecord) => {
  const p = r.payload as Record<string, unknown>;
  for (const k of ["content", "text", "statement", "stdout", "command", "output"]) if (typeof p[k] === "string" && p[k]) return p[k] as string;
  return JSON.stringify(p).slice(0, 300);
};

class UnionFind {
  parent = new Map<string, string>();
  find(x: string): string { if (!this.parent.has(x)) this.parent.set(x, x); const p = this.parent.get(x)!; if (p === x) return x; const r = this.find(p); this.parent.set(x, r); return r; }
  union(a: string, b: string) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent.set(ra, rb); }
}

/**
 * Episode boundary resolver. Links records in three tiers, strongest first:
 *   1. EXPLICIT_LINK     a recorded reference field (parent id, thread id, tool call id)
 *   2. IDENTIFIER_MATCH  the same file name, URL or issue number in two records within 60 minutes
 *   3. SEMANTIC_LINK     Q_SAME_TASK answered yes for a still-unlinked record within 15 minutes of an anchor
 * Records connected by any link form one episode. Episodes that share a record
 * are merged, with the merge written into the justification.
 * Splitting disjoint tasks in one shared room falls out of the same rule: two
 * tasks that never share an identifier or reference stay separate.
 */
export async function buildEpisodes(records: SourceRecord[], anchorIds: string[], judge?: SemanticJudge, threshold = 0.7, cap = 40): Promise<Episode[]> {
  const sorted = [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const byId = new Map(sorted.map((r) => [String(r.recordId), r]));
  const uf = new UnionFind();
  const links: EpisodeLink[] = [];
  sorted.forEach((r) => uf.find(String(r.recordId)));

  // 1. Explicit references, resolved by record id or by the tool id that two records share.
  const toolIds = new Map<string, string[]>();
  for (const r of sorted) {
    const p = r.payload as Record<string, unknown>;
    for (const k of EXPLICIT_KEYS) {
      const v = p[k];
      if (typeof v !== "string" || !v) continue;
      if (byId.has(v)) { uf.union(String(r.recordId), v); links.push({ from: v, to: String(r.recordId), basis: "EXPLICIT_LINK" }); }
      else { const list = toolIds.get(`${k}:${v}`) ?? []; list.push(String(r.recordId)); toolIds.set(`${k}:${v}`, list); }
    }
  }
  for (const list of toolIds.values()) for (let i = 1; i < list.length; i++) { uf.union(list[0], list[i]); links.push({ from: list[0], to: list[i], basis: "EXPLICIT_LINK" }); }

  // 2. Identifier matches within the window.
  const lastSeen = new Map<string, SourceRecord>();
  for (const r of sorted) {
    for (const id of new Set(textOf(r).match(IDENT) ?? [])) {
      const prev = lastSeen.get(id);
      if (prev && Date.parse(r.timestamp) - Date.parse(prev.timestamp) <= WINDOW_MS && uf.find(String(prev.recordId)) !== uf.find(String(r.recordId))) {
        uf.union(String(prev.recordId), String(r.recordId));
        links.push({ from: String(prev.recordId), to: String(r.recordId), basis: "IDENTIFIER_MATCH" });
      }
      lastSeen.set(id, r);
    }
  }

  // 3. Semantic links for records still outside every anchor's component.
  if (judge && anchorIds.length) {
    const candidates: Array<{ anchor: SourceRecord; rec: SourceRecord }> = [];
    for (const aid of anchorIds) {
      const a = byId.get(aid);
      if (!a) continue;
      for (const r of sorted) {
        if (uf.find(String(r.recordId)) === uf.find(aid)) continue;
        if (Math.abs(Date.parse(r.timestamp) - Date.parse(a.timestamp)) > SEMANTIC_WINDOW_MS) continue;
        candidates.push({ anchor: a, rec: r });
      }
    }
    const used = candidates.slice(0, cap);
    const js = await judge.judge(QUESTIONS.Q_SAME_TASK, used.map((c) => ({ text: `Anchor record: ${textOf(c.anchor).slice(0, 400)}\n\nSecond record: ${textOf(c.rec).slice(0, 400)}`, recordIds: [String(c.anchor.recordId), String(c.rec.recordId)] })));
    used.forEach((c, i) => {
      const p = js[i]?.probability ?? 0;
      if (p >= threshold) { uf.union(String(c.anchor.recordId), String(c.rec.recordId)); links.push({ from: String(c.anchor.recordId), to: String(c.rec.recordId), basis: "SEMANTIC_LINK", probability: p }); }
    });
  }

  // Components that contain an anchor become episodes.
  const comps = new Map<string, string[]>();
  for (const r of sorted) { const root = uf.find(String(r.recordId)); comps.set(root, [...(comps.get(root) ?? []), String(r.recordId)]); }
  const anchorRoots = new Map<string, string[]>();
  for (const aid of anchorIds) { if (!byId.has(aid)) continue; const root = uf.find(aid); anchorRoots.set(root, [...(anchorRoots.get(root) ?? []), aid]); }

  const episodes: Episode[] = [];
  let n = 0;
  for (const [root, anchors] of anchorRoots) {
    const ids = comps.get(root)!;
    const recs = ids.map((i) => byId.get(i)!);
    const set = new Set(ids);
    const mine = links.filter((l) => set.has(l.from) && set.has(l.to));
    const basisCounts: Record<BoundaryBasis, number> = { EXPLICIT_LINK: 0, IDENTIFIER_MATCH: 0, SEMANTIC_LINK: 0 };
    mine.forEach((l) => basisCounts[l.basis]++);
    // Backward: the trigger is the earliest record of the component. Forward: the terminal is the latest.
    const trigger = recs[0], terminal = recs[recs.length - 1];
    const bits = [`${recs.length} records from ${new Set(recs.map((r) => r.agentId)).size} agent(s)`];
    if (basisCounts.EXPLICIT_LINK) bits.push(`${basisCounts.EXPLICIT_LINK} recorded reference(s)`);
    if (basisCounts.IDENTIFIER_MATCH) bits.push(`${basisCounts.IDENTIFIER_MATCH} shared identifier(s)`);
    if (basisCounts.SEMANTIC_LINK) bits.push(`${basisCounts.SEMANTIC_LINK} model-inferred link(s) (Q_SAME_TASK ≥ ${threshold})`);
    if (!mine.length) bits.push("no links found: this record stands alone");
    if (anchors.length > 1) bits.push(`${anchors.length} leads merged into one episode because they share linked records`);
    episodes.push({
      episodeId: `EP-${String(++n).padStart(2, "0")}`, anchorRecordIds: anchors, recordIds: ids, triggerRecordId: String(trigger.recordId), terminalRecordId: String(terminal.recordId),
      agents: [...new Set(recs.map((r) => String(r.agentId)))], startTime: trigger.timestamp, endTime: terminal.timestamp, links: mine, basisCounts,
      justification: `Bounded by ${bits.join("; ")}. Starts at ${trigger.recordId}, ends at ${terminal.recordId}.`, mergedFrom: anchors,
    });
  }
  return episodes.sort((a, b) => a.startTime.localeCompare(b.startTime)).map((e, i) => ({ ...e, episodeId: `EP-${String(i + 1).padStart(2, "0")}` }));
}
