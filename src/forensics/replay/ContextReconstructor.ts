import type { EvidencePacket, SourceRecord } from "../../core/types/contracts.js";
import type { RecordId } from "../../core/types/brands.js";
import type { ReplayChatMessage } from "./contracts.js";

export class ContextReconstructor {
  /**
   * Reconstructs the exact message sequence leading up to the divergence point,
   * performing causal slicing to strip downstream turns and prevent contamination.
   */
  public reconstructContext(
    packet: EvidencePacket,
    targetRecordId: RecordId,
    systemPrompt = "You are an AI assistant collaborating in a multi-agent swarm."
  ): ReplayChatMessage[] {
    const messages: ReplayChatMessage[] = [
      {
        role: "system",
        content: systemPrompt,
      },
    ];

    // Find index of target diverging record
    const targetIdx = packet.records.findIndex((r) => r.recordId === targetRecordId);
    const sliceRecords =
      targetIdx >= 0 ? packet.records.slice(0, targetIdx) : packet.records;

    for (const rec of sliceRecords) {
      this.appendRecordToContext(messages, rec);
    }

    return messages;
  }

  private appendRecordToContext(
    messages: ReplayChatMessage[],
    record: SourceRecord
  ): void {
    if (record.role === "STATEMENT") {
      const text =
        typeof record.payload.text === "string"
          ? record.payload.text
          : typeof record.payload.content === "string"
          ? record.payload.content
          : JSON.stringify(record.payload);

      messages.push({
        role: "user",
        content: `[Message from ${record.agentId}]: ${text}`,
        name: record.agentId,
      });
    } else if (record.role === "ATTEMPT") {
      const action =
        typeof record.payload.command === "string"
          ? record.payload.command
          : JSON.stringify(record.payload.action ?? record.payload);

      messages.push({
        role: "assistant",
        content: action,
        name: record.agentId,
      });
    } else if (record.role === "OBSERVATION") {
      const output =
        typeof record.payload.stdout === "string"
          ? record.payload.stdout
          : typeof record.payload.output === "string"
          ? record.payload.output
          : JSON.stringify(record.payload);

      messages.push({
        role: "tool",
        content: output,
      });
    }
  }
}
