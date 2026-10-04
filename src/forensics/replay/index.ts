import type { EvidencePacket } from "../../core/types/contracts.js";
import type { RecordId } from "../../core/types/brands.js";
import {
  type LatentRewardReplayReport,
  type ProbeEvaluation,
  type ReplayTestSuite,
} from "./contracts.js";
import { ContextReconstructor } from "./ContextReconstructor.js";
import { PerturbationSynthesizer } from "./PerturbationSynthesizer.js";
import { ReplaySandbox, type ReplaySandboxConfig } from "./ReplaySandbox.js";
import { DivergenceEvaluator } from "./DivergenceEvaluator.js";

export * from "./contracts.js";
export * from "./ContextReconstructor.js";
export * from "./PerturbationSynthesizer.js";
export * from "./ReplaySandbox.js";
export * from "./DivergenceEvaluator.js";

export async function runLatentRewardReplaySuite(
  packet: EvidencePacket,
  targetRecordId?: RecordId,
  config: ReplaySandboxConfig = {},
  applicability?: { applicable: boolean; reason: string }
): Promise<LatentRewardReplayReport> {
  const chosenRecordId =
    targetRecordId ??
    packet.records.find((r) => r.role === "STATEMENT")?.recordId ??
    packet.records[0].recordId;

  // 1. Reconstruct baseline context
  const reconstructor = new ContextReconstructor();
  const baselineContext = reconstructor.reconstructContext(packet, chosenRecordId);

  // 2. Synthesize parameterized probes
  // Name the tool the episode actually used, so probe wording fits the transcript.
  const firstAttempt = packet.records.find((r) => r.role === "ATTEMPT");
  const cmd = firstAttempt ? String((firstAttempt.payload as Record<string, unknown>).command ?? (firstAttempt.payload as Record<string, unknown>).tool_name ?? "") : "";
  const targetTool = cmd.trim().split(/\s+/)[0] || (packet.records.some((r) => /contacts?/i.test(JSON.stringify(r.payload))) ? "contacts.export" : "the tool");
  const claimedOutput = packet.claims[0]?.statementText ?? "Task completed";
  const synthesizer = new PerturbationSynthesizer();
  const probes = synthesizer.generateProbes(targetTool, claimedOutput);

  const testSuite: ReplayTestSuite = {
    episodeId: packet.episodeId,
    targetRecordId: chosenRecordId,
    baselineContext,
    probes,
    status: "EXECUTED",
  };

  if (applicability && !applicability.applicable) {
    return {
      episodeId: packet.episodeId, targetRecordId: chosenRecordId, testSuite: { ...testSuite, status: "REJECTED" }, evaluations: [], inferredOperativeReward: undefined, applicability,
      epistemicDisclaimer: "Observational traces suggest hypotheses. Causal confirmation requires consistent divergence across validated replay runs.",
    };
  }

  // 3. Execute isolated rollouts, each probe against a no-intervention control arm
  const sandbox = new ReplaySandbox(config);
  const evaluator = new DivergenceEvaluator({ countSimulated: config.countSimulated });
  const evaluations: ProbeEvaluation[] = [];

  for (const probe of probes) {
    const rollouts = await sandbox.runRolloutSuite(baselineContext, probe);
    const control = probe.archetypeTested === "EFFORT_MINIMIZATION" ? undefined : await sandbox.runRolloutSuite(baselineContext, probe, true);
    const evaluation = evaluator.evaluateProbe(probe.archetypeTested, rollouts, control);
    evaluations.push(evaluation);
  }

  // 4. Infer operative reward archetype
  const operativeReward = evaluator.inferOperativeReward(evaluations);

  return {
    episodeId: packet.episodeId,
    targetRecordId: chosenRecordId,
    testSuite,
    evaluations,
    inferredOperativeReward: operativeReward,
    ...(applicability ? { applicability } : {}),
    epistemicDisclaimer:
      "Observational traces suggest hypotheses. Causal confirmation requires consistent divergence across validated replay runs.",
  };
}
