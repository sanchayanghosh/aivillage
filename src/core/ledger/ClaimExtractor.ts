import type { SourceRecord, AtomicClaim } from "../types/contracts.js";
import type { RecordId } from "../types/brands.js";
import { QUESTIONS } from "../semantic/questions.js";
import type { SemanticJudge } from "../semantic/SemanticJudge.js";
import { splitCompoundClaim } from "./ClaimLedger.js";

const textOf = (r: SourceRecord): string => {
  const p = r.payload as Record<string, unknown>;
  for (const k of ["content", "text", "statement"]) if (typeof p[k] === "string" && p[k]) return p[k] as string;
  return "";
};

/** Sentence candidates. Pure structure: the model never writes any claim text. */
export function sentenceCandidates(message: string): string[] {
  return message.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 3);
}

export interface ExtractedClaims { claims: AtomicClaim[]; modelAssisted: Set<string>; asked: number }

/**
 * Model-assisted claim extraction (Q_EXTRACT_CLAIMS without free-text
 * generation). Rule: split every statement into sentences, ask the Semantic
 * Judge "does this sentence state that something is finished?", keep the
 * sentences it says yes to, then split those on conjunctions. Because claim
 * text is always a substring of the source message, nothing can be invented.
 */
export async function extractClaimsWithJudge(records: SourceRecord[], judge: SemanticJudge, threshold = 0.5, cap = 80): Promise<ExtractedClaims> {
  const rows: Array<{ rec: SourceRecord; sentence: string }> = [];
  for (const rec of records) {
    if (rec.role !== "STATEMENT") continue;
    const msg = textOf(rec);
    if (!msg) continue;
    for (const sentence of sentenceCandidates(msg)) if (msg.includes(sentence)) rows.push({ rec, sentence });
  }
  const used = rows.slice(0, cap);
  const js = await judge.judge(QUESTIONS.Q_CLAIMS_COMPLETION, used.map((r) => ({ text: r.sentence, recordIds: [String(r.rec.recordId)] })));
  const claims: AtomicClaim[] = [];
  const modelAssisted = new Set<string>();
  used.forEach((row, i) => {
    if ((js[i]?.probability ?? 0) < threshold) return;
    const parts = splitCompoundClaim(`claim-${row.rec.recordId}-s${i}`, row.rec.recordId as RecordId, row.sentence);
    for (const c of parts) { claims.push(c); modelAssisted.add(String(c.claimId)); }
  });
  return { claims, modelAssisted, asked: used.length };
}
