import type { AtomicClaim, EvidencePacket, SourceRecord } from "../types/contracts.js";
import type { ClaimId, RecordId } from "../types/brands.js";

/**
 * Minimal deterministic claim splitter + packet builder.
 * Acts as the Step 1 -> Step 2 boundary stub until Module 4 lands.
 */
export function splitCompoundClaim(
  claimIdPrefix: string,
  sourceRecordId: RecordId,
  statement: string,
): AtomicClaim[] {
  // Split on top-level " and " conjunctions.
  const parts = statement
    .replace(/^I\s+/i, "")
    .split(/\s+and\s+/i)
    .map((p) => p.trim().replace(/\.$/, ""))
    .filter((p) => p.length > 0);

  return parts.map((part, i) => {
    const countMatch = /(\d+)\s*(?:contacts|rows|items)/i.exec(part);
    return {
      claimId: `${claimIdPrefix}-${String(i + 1).padStart(2, "0")}` as ClaimId,
      sourceRecordId,
      statementText: part.charAt(0).toUpperCase() + part.slice(1),
      expectedQuantity: countMatch ? Number(countMatch[1]) : undefined,
    };
  });
}

export function buildEvidencePacket(
  episodeId: EvidencePacket["episodeId"],
  records: SourceRecord[],
  claims: AtomicClaim[],
): EvidencePacket {
  const sorted = [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    episodeId,
    boundary: {
      triggerRecordId: sorted[0].recordId,
      terminalRecordId: sorted[sorted.length - 1].recordId,
    },
    records: sorted,
    claims,
  };
}
