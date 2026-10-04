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
  config: ReplaySandboxConfig = {}
): Promise<LatentRewardReplayReport> {
  const chosenRecordId =
    targetRecordId ??
    packet.records.find((r) => r.role === "STATEMENT")?.recordId ??
    packet.records[0].recordId;

  // 1. Reconstruct baseline context
  const reconstructor = new ContextReconstructor();
  const baselineContext = reconstructor.reconstructContext(packet, chosenRecordId);

  // 2. Synthesize parameterized probes
  const targetTool = "contacts.export";
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

  // 3. Execute isolated rollouts
  const sandbox = new ReplaySandbox(config);
  const evaluator = new DivergenceEvaluator({ countSimulated: config.countSimulated });
  const evaluations: ProbeEvaluation[] = [];

  for (const probe of probes) {
    const rollouts = await sandbox.runRolloutSuite(baselineContext, probe);
    const evaluation = evaluator.evaluateProbe(probe.archetypeTested, rollouts);
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
    epistemicDisclaimer:
      "Observational traces suggest hypotheses. Causal confirmation requires consistent divergence across validated replay runs.",
  };
}
