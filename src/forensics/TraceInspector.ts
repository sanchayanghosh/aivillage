import type { EvidencePacket, ReasoningTrace } from "../core/types/contracts.js";
import type { ClaimId, RecordId } from "../core/types/brands.js";

export class TraceInspector {
  public extractTraces(packet: EvidencePacket): ReasoningTrace[] {
    const traces: ReasoningTrace[] = [];

    for (const record of packet.records) {
      const raw = this.extractScratchpad(record);
      if (!raw || raw.length === 0) continue;

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

  /** Extracts internal reasoning / scratchpad across Anthropic, Gemini, OpenAI, and standard payload shapes */
  public extractScratchpad(record: any): string | undefined {
    const payload = record.payload ?? record.data ?? {};

    // 1. Direct fields
    if (typeof payload.internal_scratchpad === "string" && payload.internal_scratchpad) {
      return payload.internal_scratchpad;
    }
    if (typeof payload.thought === "string" && payload.thought) {
      return payload.thought;
    }

    // 2. Check agent_messages / output objects
    const candidatesToCheck = [payload.agent_messages, payload.output].filter(Boolean);

    for (const item of candidatesToCheck) {
      // Gemini shape: candidates[0].content.parts
      if (item && typeof item === "object" && Array.isArray(item.candidates)) {
        const parts = item.candidates[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            if (p.thought && typeof p.text === "string") {
              return p.text;
            }
          }
        }
      }

      // Anthropic shape: content array
      if (item && typeof item === "object") {
        const content = Array.isArray(item) ? item : item.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === "object") {
              if (block.type === "thinking" && typeof block.thinking === "string") {
                return block.thinking;
              }
              // OpenAI Responses API shape inside output array
              if (block.type === "reasoning") {
                if (Array.isArray(block.summary) && block.summary[0]?.text) {
                  return block.summary[0].text;
                }
                if (typeof block.reasoning === "string") {
                  return block.reasoning;
                }
              }
            }
          }
        }
      }

      // OpenAI direct reasoning string shape
      if (item && typeof item === "object" && typeof item.reasoning === "string") {
        return item.reasoning;
      }
    }

    return undefined;
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
