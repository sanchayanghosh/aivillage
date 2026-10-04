import { normalizeTranscript, type NormalizeReport } from "./ingest/TranscriptNormalizer.js";
import { extractClaims, parseEpisodeJsonl, type EpisodeAnalysis } from "./episodes/EpisodeLoader.js";
import { buildEvidencePacket } from "./ledger/ClaimLedger.js";
import { extractClaimsWithJudge } from "./ledger/ClaimExtractor.js";
import { judgeVerdicts, type JudgedVerdict } from "./ledger/VerdictJudge.js";
import { TraceInspector } from "../forensics/TraceInspector.js";
import { buildGraph } from "./graph/GraphBuilder.js";
import type { GraphPayload } from "./graph/contracts.js";
import type { SemanticJudge } from "./semantic/SemanticJudge.js";
import type { SourceRecord } from "./types/contracts.js";
import type { EpisodeId } from "./types/brands.js";

export interface Investigation {
  report: NormalizeReport;
  jsonl: string;
  records: SourceRecord[];
  analysis: EpisodeAnalysis;
  graph: GraphPayload;
  claimMode: "rules" | "judge";
  verdictMode: "rules" | "judge";
}

/** Normalize, extract claims (rules, or the Semantic Judge when one is configured), and build the Step 1 graph. */
export async function investigate(raw: string, episodeId: string, judge?: SemanticJudge): Promise<Investigation> {
  const { jsonl, report } = normalizeTranscript(raw);
  const records = parseEpisodeJsonl(jsonl);
  let claims = extractClaims(records);
  let modelAssisted = new Set<string>();
  let claimMode: Investigation["claimMode"] = "rules";
  let verdicts: Map<string, JudgedVerdict> | undefined;
  if (judge) {
    const before = judge.stats.modelErrors;
    const ex = await extractClaimsWithJudge(records, judge);
    // If the judge ran cleanly, its answer stands, even when it finds no claims.
    if (judge.stats.modelErrors === before) { claims = ex.claims; modelAssisted = ex.modelAssisted; claimMode = "judge"; }
    if (claims.length) {
      const errs = judge.stats.modelErrors;
      const v = await judgeVerdicts(claims, records, judge);
      if (judge.stats.modelErrors === errs) { verdicts = v; claims.forEach((c) => modelAssisted.add(String(c.claimId))); }
    }
  }
  const packet = buildEvidencePacket(episodeId as EpisodeId, records, claims);
  const traces = new TraceInspector().extractTraces(packet);
  const analysis: EpisodeAnalysis = { packet, claims, traces };
  return { report, jsonl, records, analysis, graph: buildGraph(analysis, { modelAssisted, verdicts }), claimMode, verdictMode: verdicts ? "judge" : "rules" };
}
