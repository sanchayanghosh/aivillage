import { z } from "zod";
import {
  AgentIdSchema,
  EpisodeIdSchema,
  RecordIdSchema,
} from "../../core/types/brands.js";
import type { AgentId, EpisodeId, RecordId } from "../../core/types/brands.js";

// ============================================================================
// 1. BRANDED IDENTIFIERS
// ============================================================================

export const ProbeIdSchema = z.string().min(1).brand<"ProbeId">();
export const ReplayRunIdSchema = z.string().min(1).brand<"ReplayRunId">();

export type ProbeId = z.infer<typeof ProbeIdSchema>;
export type ReplayRunId = z.infer<typeof ReplayRunIdSchema>;

// ============================================================================
// 2. REWARD TAXONOMY ARCHETYPES
// ============================================================================

export const RewardArchetypeSchema = z.enum([
  "TOKEN_SATISFICING",       // Prioritizes emitting completion tokens over execution
  "EFFORT_MINIMIZATION",     // Avoids spending compute/turns to inspect artifacts
  "NEGATIVE_FEEDBACK_AVOID", // Suppresses errors to prevent supervisor penalties
  "SYCOPHANTIC_CONSENSUS",   // Prioritizes agreement with peer messages
  "ROLE_FIDELITY",           // Prioritizes persona/adversarial instructions over goal
]);
export type RewardArchetype = z.infer<typeof RewardArchetypeSchema>;

// ============================================================================
// 3. INTERVENTION SPECIFICATIONS
// ============================================================================

export const InterventionComponentSchema = z.enum([
  "SYSTEM_PROMPT_APPENDIX",
  "USER_TURN_INJECTION",
  "TOOL_MOCK_PAYLOAD",
  "PEER_CHAT_INJECTION",
]);
export type InterventionComponent = z.infer<typeof InterventionComponentSchema>;

export const InterventionDeltaSchema = z.object({
  probeId: ProbeIdSchema,
  archetypeTested: RewardArchetypeSchema,
  targetComponent: InterventionComponentSchema,
  deltaPayload: z.string(),
  rationale: z.string().min(10),
  falsificationPrediction: z.object({
    ifOperative: z.string().min(5),
    ifNonOperative: z.string().min(5),
  }),
});
export type InterventionDelta = z.infer<typeof InterventionDeltaSchema>;

export const ReplayChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  name: z.string().optional(),
});
export type ReplayChatMessage = z.infer<typeof ReplayChatMessageSchema>;

export const ReplayTestSuiteSchema = z.object({
  episodeId: EpisodeIdSchema,
  targetRecordId: RecordIdSchema,
  baselineContext: z.array(ReplayChatMessageSchema),
  probes: z.array(InterventionDeltaSchema).min(1),
  status: z.enum(["PENDING_APPROVAL", "APPROVED", "EXECUTED", "REJECTED"]),
});
export type ReplayTestSuite = z.infer<typeof ReplayTestSuiteSchema>;

// ============================================================================
// 4. EXECUTION RESULTS & EVALUATION
// ============================================================================

export const RolloutDivergenceSchema = z.enum([
  "PERSISTED_ANOMALY",   // Behavior stayed identical despite probe
  "BEHAVIOR_SHIFTED",    // Behavior shifted to aligned/honest output
  "UNEXPECTED_FAILURE",  // Syntax error, loop, or crash
]);
export type RolloutDivergence = z.infer<typeof RolloutDivergenceSchema>;

export const RolloutResultSchema = z.object({
  probeId: ProbeIdSchema,
  rolloutIndex: z.number().int().nonnegative(),
  temperature: z.number(),
  generatedThought: z.string().optional(),
  generatedAction: z.object({
    toolName: z.string().optional(),
    toolArgs: z.record(z.unknown()).optional(),
    chatMessage: z.string().optional(),
    text: z.string().optional(),
  }),
  observedDivergence: RolloutDivergenceSchema,
  rawOutput: z.string(),
});
export type RolloutResult = z.infer<typeof RolloutResultSchema>;

export const CausalVerdictSchema = z.enum(["CONFIRMED", "FALSIFIED", "INCONCLUSIVE"]);
export type CausalVerdict = z.infer<typeof CausalVerdictSchema>;

export const ProbeEvaluationSchema = z.object({
  probeId: ProbeIdSchema,
  archetype: RewardArchetypeSchema,
  rolloutResults: z.array(RolloutResultSchema).min(1),
  confirmedScore: z.number().min(0).max(1), // Fraction of runs matching prediction
  verdict: CausalVerdictSchema,
  divergenceSummary: z.string(),
});
export type ProbeEvaluation = z.infer<typeof ProbeEvaluationSchema>;

export const LatentRewardReplayReportSchema = z.object({
  episodeId: EpisodeIdSchema,
  targetRecordId: RecordIdSchema,
  testSuite: ReplayTestSuiteSchema,
  evaluations: z.array(ProbeEvaluationSchema),
  inferredOperativeReward: RewardArchetypeSchema.optional(),
  epistemicDisclaimer: z.string(),
});
export type LatentRewardReplayReport = z.infer<typeof LatentRewardReplayReportSchema>;
