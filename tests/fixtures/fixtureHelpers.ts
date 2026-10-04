import { readFileSync } from "node:fs";
import { TraceInspector } from "../../src/forensics/TraceInspector.js";
import { buildEvidencePacket, splitCompoundClaim } from "../../src/core/ledger/ClaimLedger.js";
import type {
  AtomicClaim,
  EvidencePacket,
  ReasoningTrace,
  SourceRecord,
} from "../../src/core/types/contracts.js";
import type {
  AgentId,
  EpisodeId,
  RecordId,
  SessionId,
} from "../../src/core/types/brands.js";

export class FixtureData {
  readonly records: SourceRecord[] = [];
  private readonly inspector = new TraceInspector();

  static load(path: string): FixtureData {
    const data = new FixtureData();
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as Record<string, any>;
      data.records.push({
        recordId: r.record_id as RecordId,
        sessionId: r.session_id as SessionId,
        agentId: r.agent_id as AgentId,
        timestamp: r.timestamp,
        role: r.role,
        eventType: r.event_type,
        payload: r.payload ?? {},
      });
    }
    return data;
  }

  getRecord(id: string): SourceRecord {
    const rec = this.records.find((r) => r.recordId === id);
    if (!rec) throw new Error(`record not found: ${id}`);
    return rec;
  }

  /** Splits Agent A's compound completion report into atomic claims. */
  extractClaims(): AtomicClaim[] {
    const rec = this.getRecord("rec-agent-a-claim");
    const text = String(rec.payload.text);
    // Golden expectation: "Exported 93 contacts and generated mailing list"
    // -> Claim 1 "Exported contact list", Claim 2 "Contact count equals 93"
    const claims: AtomicClaim[] = [];
    const exportMatch = /Exported\s+\d+\s+contacts/i.exec(text);
    if (exportMatch) {
      claims.push({
        claimId: "claim-export-01" as AtomicClaim["claimId"],
        sourceRecordId: rec.recordId,
        statementText: "Exported contact list",
        targetArtifactPath: "out/contacts.csv",
      });
    }
    const countMatch = /(\d+)\s+contacts/i.exec(text);
    if (countMatch) {
      claims.push({
        claimId: "claim-export-02" as AtomicClaim["claimId"],
        sourceRecordId: rec.recordId,
        statementText: `Contact count equals ${countMatch[1]}`,
        expectedQuantity: Number(countMatch[1]),
        targetArtifactPath: "out/contacts.csv",
      });
    }
    return claims;
  }

  getEvidencePacket(): EvidencePacket {
    return buildEvidencePacket(
      "ep-june11-mailing-list" as EpisodeId,
      this.records,
      this.extractClaims(),
    );
  }

  getReasoningTraces(): ReasoningTrace[] {
    return this.inspector.extractTraces(this.getEvidencePacket());
  }
}
