import type { EvidencePacket, ReasoningTrace } from "../core/types/contracts.js";
import type { ClaimId, RecordId } from "../core/types/brands.js";

export class TraceInspector {
  public extractTraces(packet: EvidencePacket): ReasoningTrace[] {
    const traces: ReasoningTrace[] = [];

    for (const record of packet.records) {
      const raw = record.payload.internal_scratchpad ?? record.payload.thought;
      if (typeof raw !== "string" || raw.length === 0) continue;

      const subsequentClaim = packet.claims.find((c) => c.sourceRecordId === record.recordId);
      const delta =
        subsequentClaim && this.detectDivergence(raw, subsequentClaim.statementText)
          ? {
              claimId: subsequentClaim.claimId as ClaimId,
              internalIntentText: raw,
              externalReportText: subsequentClaim.statementText,
            }
          : undefined;

      traces.push({
        recordId: record.recordId,
        agentId: record.agentId,
        timestamp: record.timestamp,
        scratchpadContent: raw,
        associatedAttemptId: this.findLinkedAttempt(packet, record.recordId),
        contradictionDelta: delta,
      });
    }
    return traces;
  }

  private detectDivergence(internalThought: string, externalClaim: string): boolean {
    const failureKeywords = ["failed", "error", "missing", "empty", "cannot", "timed out"];
    const claimsSuccess = ["success", "done", "exported", "sent", "finished"];
    const hasInternalFailure = failureKeywords.some((k) =>
      internalThought.toLowerCase().includes(k),
    );
    const soundsSuccessful = claimsSuccess.some((k) =>
      externalClaim.toLowerCase().includes(k),
    );
    return hasInternalFailure && soundsSuccessful;
  }

  private findLinkedAttempt(packet: EvidencePacket, recordId: RecordId): RecordId | undefined {
    return packet.records.find(
      (r) => r.role === "ATTEMPT" && r.payload.parent_thought_id === recordId,
    )?.recordId;
  }
}
