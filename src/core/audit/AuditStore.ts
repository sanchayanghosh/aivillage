import { createRequire } from "node:module";
import type { DatabaseSync as DB } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Loaded at runtime: bundlers do not know node:sqlite yet.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export interface ClassifierOutput {
  questionId: string; questionVersion: number; model: string; inputHash: string;
  inputRecordIds: string[]; answer: string; probability: number; createdAt: string;
}
export interface Finding {
  id: number; claimId: string; claimText: string; originalVerdict: string; overrideVerdict: string; justification: string; analyst: string; createdAt: string;
}
export interface EvalLabel {
  questionId: string; inputHash: string; text: string; label: boolean; source: "sample" | "manual"; createdAt: string;
}

/**
 * Three isolated partitions in one SQLite file (PRD FR-3.4):
 *  1. discovery_rules   which questions, versions and thresholds produced leads
 *  2. classifier_outputs one row per semantic judgment; UNIQUE key is the cache
 *  3. verified_findings  analyst overrides, justification of at least 10 characters
 * plus eval_labels, the hand-labelled rows used to measure precision and recall.
 */
export class AuditStore {
  private db: DB;

  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS discovery_rules (
        rule_id INTEGER PRIMARY KEY AUTOINCREMENT, route INTEGER NOT NULL, sql_text TEXT NOT NULL,
        question_ids TEXT NOT NULL, thresholds TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS classifier_outputs (
        output_id INTEGER PRIMARY KEY AUTOINCREMENT, question_id TEXT NOT NULL, question_version INTEGER NOT NULL, model TEXT NOT NULL,
        input_hash TEXT NOT NULL, input_record_ids TEXT NOT NULL, answer TEXT NOT NULL, probability REAL NOT NULL,
        executed_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (question_id, question_version, model, input_hash)
      );
      CREATE TABLE IF NOT EXISTS verified_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, claim_id TEXT NOT NULL, claim_text TEXT NOT NULL, original_verdict TEXT NOT NULL,
        override_verdict TEXT NOT NULL, justification TEXT NOT NULL CHECK (length(trim(justification)) >= 10), analyst TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS eval_labels (
        question_id TEXT NOT NULL, input_hash TEXT NOT NULL, text TEXT NOT NULL, label INTEGER NOT NULL, source TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (question_id, input_hash)
      );
      CREATE TABLE IF NOT EXISTS eval_baselines (
        question_id TEXT PRIMARY KEY, precision REAL NOT NULL, recall REAL NOT NULL, labels INTEGER NOT NULL, model TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  // Partition 1
  saveRule(route: number, sql: string, questionIds: string[], thresholds: Record<string, number>) {
    this.db.prepare("INSERT INTO discovery_rules (route, sql_text, question_ids, thresholds) VALUES (?, ?, ?, ?)").run(route, sql, JSON.stringify(questionIds), JSON.stringify(thresholds));
  }
  listRules() { return this.db.prepare("SELECT * FROM discovery_rules ORDER BY rule_id DESC LIMIT 100").all(); }

  // Partition 2
  getOutput(q: string, v: number, model: string, hash: string): ClassifierOutput | null {
    const r = this.db.prepare("SELECT * FROM classifier_outputs WHERE question_id=? AND question_version=? AND model=? AND input_hash=?").get(q, v, model, hash) as Record<string, any> | undefined;
    return r ? { questionId: r.question_id, questionVersion: r.question_version, model: r.model, inputHash: r.input_hash, inputRecordIds: JSON.parse(r.input_record_ids), answer: r.answer, probability: r.probability, createdAt: r.executed_at } : null;
  }
  putOutput(o: ClassifierOutput) {
    this.db.prepare("INSERT OR IGNORE INTO classifier_outputs (question_id, question_version, model, input_hash, input_record_ids, answer, probability) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(o.questionId, o.questionVersion, o.model, o.inputHash, JSON.stringify(o.inputRecordIds), o.answer, o.probability);
  }
  countOutputs(): number { return (this.db.prepare("SELECT COUNT(*) AS n FROM classifier_outputs").get() as { n: number }).n; }

  // Partition 3
  addFinding(f: Omit<Finding, "id" | "createdAt">): Finding {
    if (f.justification.trim().length < 10) throw new Error("A justification of at least 10 characters is required.");
    const r = this.db.prepare("INSERT INTO verified_findings (claim_id, claim_text, original_verdict, override_verdict, justification, analyst) VALUES (?, ?, ?, ?, ?, ?)")
      .run(f.claimId, f.claimText, f.originalVerdict, f.overrideVerdict, f.justification.trim(), f.analyst);
    return this.listFindings().find((x) => x.id === Number(r.lastInsertRowid))!;
  }
  listFindings(): Finding[] {
    return (this.db.prepare("SELECT * FROM verified_findings ORDER BY id DESC LIMIT 200").all() as Array<Record<string, any>>).map((r) => ({
      id: r.id, claimId: r.claim_id, claimText: r.claim_text, originalVerdict: r.original_verdict, overrideVerdict: r.override_verdict, justification: r.justification, analyst: r.analyst, createdAt: r.created_at,
    }));
  }

  // Evaluation labels
  saveLabel(l: Omit<EvalLabel, "createdAt">) {
    this.db.prepare("INSERT INTO eval_labels (question_id, input_hash, text, label, source) VALUES (?, ?, ?, ?, ?) ON CONFLICT(question_id, input_hash) DO UPDATE SET label=excluded.label, source=excluded.source")
      .run(l.questionId, l.inputHash, l.text, l.label ? 1 : 0, l.source);
  }
  deleteLabel(q: string, hash: string) { this.db.prepare("DELETE FROM eval_labels WHERE question_id=? AND input_hash=?").run(q, hash); }
  listLabels(q: string): EvalLabel[] {
    return (this.db.prepare("SELECT * FROM eval_labels WHERE question_id=? ORDER BY created_at").all(q) as Array<Record<string, any>>).map((r) => ({ questionId: r.question_id, inputHash: r.input_hash, text: r.text, label: r.label === 1, source: r.source, createdAt: r.created_at }));
  }
  setBaseline(q: string, precision: number, recall: number, labels: number, model: string) {
    this.db.prepare("INSERT INTO eval_baselines (question_id, precision, recall, labels, model) VALUES (?, ?, ?, ?, ?) ON CONFLICT(question_id) DO UPDATE SET precision=excluded.precision, recall=excluded.recall, labels=excluded.labels, model=excluded.model, created_at=CURRENT_TIMESTAMP")
      .run(q, precision, recall, labels, model);
  }
  getBaseline(q: string): { precision: number; recall: number; labels: number; model: string } | null {
    const r = this.db.prepare("SELECT * FROM eval_baselines WHERE question_id=?").get(q) as Record<string, any> | undefined;
    return r ? { precision: r.precision, recall: r.recall, labels: r.labels, model: r.model } : null;
  }
  close() { this.db.close(); }
}
