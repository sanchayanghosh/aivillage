import type { SourceRecord } from "../types/contracts.js";
import { QUESTIONS, type QuestionId } from "../semantic/questions.js";
import { SemanticJudge } from "../semantic/SemanticJudge.js";
import type { AuditStore } from "../audit/AuditStore.js";

export const MIN_LABELS = 30;
export const MAX_LABELS = 50;
const textOf = (r: SourceRecord) => { const p = r.payload as Record<string, unknown>; for (const k of ["content", "text", "statement", "stdout", "command", "output"]) if (typeof p[k] === "string" && p[k]) return p[k] as string; return ""; };

/** The structural pre-filter each question runs on. The judge never sees the full table. */
export function prefilter(q: QuestionId, records: SourceRecord[]): SourceRecord[] {
  if (q === "Q_ACTION_FAILED") return records.filter((r) => r.role === "OBSERVATION");
  if (q === "Q_CLAIMS_COMPLETION" || q === "Q_REPORTS_PROBLEM") return records.filter((r) => r.role === "STATEMENT");
  return records;
}

export interface SampleRow { inputHash: string; text: string; recordIds: string[] }

/** Deterministic sample of unlabelled rows. Model answers are never attached: labelling is blind. */
export function sampleRows(q: QuestionId, records: SourceRecord[], labelled: Set<string>, n = MAX_LABELS): SampleRow[] {
  const rows = prefilter(q, records).map((r) => ({ r, text: textOf(r) })).filter((x) => x.text.length > 3);
  const withHash = rows.map((x) => ({ inputHash: SemanticJudge.hash(x.text), text: x.text, recordIds: [String(x.r.recordId)] })).filter((x) => !labelled.has(x.inputHash));
  const seen = new Set<string>();
  const unique = withHash.filter((x) => (seen.has(x.inputHash) ? false : (seen.add(x.inputHash), true)));
  // Stable shuffle by hash so the same transcript always gives the same sample.
  return unique.sort((a, b) => a.inputHash.localeCompare(b.inputHash)).slice(0, n);
}

export interface Metrics {
  questionId: string; model: string; threshold: number; labels: number; positives: number;
  tp: number; fp: number; fn: number; tn: number; unjudged: number;
  precision: number | null; recall: number | null;
  status: "need_more_labels" | "measured";
  baseline: { precision: number; recall: number; labels: number; model: string } | null;
  regression: boolean;
}

/** Precision and recall of the judge against the analyst's labels. Flags a drop of more than 10 points against the stored baseline. */
export async function computeMetrics(store: AuditStore, judge: SemanticJudge, q: QuestionId, threshold = 0.5): Promise<Metrics> {
  const question = QUESTIONS[q];
  const labels = store.listLabels(q);
  const js = await judge.judge(question, labels.map((l) => ({ text: l.text, recordIds: [l.inputHash] })));
  let tp = 0, fp = 0, fn = 0, tn = 0, unjudged = 0;
  labels.forEach((l, i) => {
    const j = js[i];
    if (!j) { unjudged++; return; }
    const predicted = j.probability >= threshold;
    if (predicted && l.label) tp++; else if (predicted && !l.label) fp++; else if (!predicted && l.label) fn++; else tn++;
  });
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const baseline = store.getBaseline(q);
  const status = labels.length >= MIN_LABELS ? "measured" : "need_more_labels";
  const regression = Boolean(status === "measured" && baseline && ((precision !== null && baseline.precision - precision > 0.1) || (recall !== null && baseline.recall - recall > 0.1)));
  return { questionId: q, model: judge.modelName, threshold, labels: labels.length, positives: labels.filter((l) => l.label).length, tp, fp, fn, tn, unjudged, precision, recall, status, baseline, regression };
}
