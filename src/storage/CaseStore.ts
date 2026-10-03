import { mkdirSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface ClassificationRecord {
  outputId: string;
  episodeId: string;
  classifierVersion: string;
  label: string;
  confidenceScore: number;
  citedRecordIds: string[];
  executedAt: string;
}

export interface VerdictOverride {
  findingId: string;
  episodeId: string;
  claimId: string;
  originalVerdict: string;
  overriddenVerdict: string;
  analystId: string;
  rationaleNote: string;
  updatedAt: string;
}

/**
 * Append-only 3-partition store (JSONL file per partition).
 * - classifier_outputs: never overwritten
 * - verified_findings: analyst overrides, rationale >= 10 chars
 * - discovery_rules: read-only audit of lead queries
 */
export class CaseStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(name: string): string {
    return `${this.dir}/${name}.jsonl`;
  }

  appendClassifierOutput(rec: ClassificationRecord): void {
    appendFileSync(this.path("classifier_outputs"), JSON.stringify(rec) + "\n");
  }

  overrideVerdict(rec: VerdictOverride): void {
    if (rec.rationaleNote.trim().length < 10) {
      throw new Error("Override rejected: rationale_note must be >= 10 characters.");
    }
    appendFileSync(this.path("verified_findings"), JSON.stringify(rec) + "\n");
  }

  listClassifierOutputs(): ClassificationRecord[] {
    return this.read<ClassificationRecord>("classifier_outputs");
  }

  listOverrides(): VerdictOverride[] {
    return this.read<VerdictOverride>("verified_findings");
  }

  private read<T>(name: string): T[] {
    const p = this.path(name);
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as T);
  }
}
