import { TraceInspector } from "../../forensics/TraceInspector.js";
import { buildEvidencePacket, splitCompoundClaim } from "../ledger/ClaimLedger.js";
import type {
  AtomicClaim,
  EvidencePacket,
  ReasoningTrace,
  SourceRecord,
} from "../types/contracts.js";
import type { AgentId, EpisodeId, RecordId, SessionId } from "../types/brands.js";

/**
 * Loads a dataset episode (one JSONL file with one record per line) into the
 * Step 2 boundary types. This is the generic, deterministic stand-in for the
 * full Step 1 pipeline until the indexer/episode-builder modules land.
 */
export function parseEpisodeJsonl(jsonl: string): SourceRecord[] {
  const records: SourceRecord[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as Record<string, any>;
    records.push({
      recordId: r.record_id as RecordId,
      sessionId: r.session_id as SessionId,
      agentId: r.agent_id as AgentId,
      timestamp: String(r.timestamp),
      role: r.role,
      eventType: r.event_type,
      payload: r.payload ?? {},
    });
  }
  if (records.length === 0) {
    throw new Error("Episode file contained no records.");
  }
  return records;
}

/** Deterministically derive atomic claims from chat statement payloads. */
export function extractClaims(records: SourceRecord[]): AtomicClaim[] {
  const claims: AtomicClaim[] = [];
  for (const rec of records) {
    if (rec.role !== "STATEMENT" || rec.eventType !== "chat_message") continue;
    const text = rec.payload?.text;
    if (typeof text !== "string" || text.length === 0) continue;
    if (!/(exported|completed|transferred|wrote|signed|verified|generated|sent)/i.test(text)) {
      continue;
    }
    claims.push(...splitCompoundClaim(`claim-${rec.recordId}`, rec.recordId, text));
  }
  return claims;
}

export interface EpisodeAnalysis {
  packet: EvidencePacket;
  claims: AtomicClaim[];
  traces: ReasoningTrace[];
}

export function analyzeEpisode(episodeId: string, jsonl: string): EpisodeAnalysis {
  const records = parseEpisodeJsonl(jsonl);
  const claims = extractClaims(records);
  const packet = buildEvidencePacket(episodeId as EpisodeId, records, claims);
  const traces = new TraceInspector().extractTraces(packet);
  return { packet, claims, traces };
}
