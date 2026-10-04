import { z } from "zod";
import {
  AgentIdSchema,
  ClaimIdSchema,
  EpisodeIdSchema,
  HypothesisIdSchema,
  RecordIdSchema,
  SessionIdSchema,
  TestIdSchema,
} from "./brands.js";
import type { AgentId, ClaimId, EpisodeId, HypothesisId, RecordId, SessionId, TestId } from "./brands.js";

// ---------- Step 1 outputs (consumed as a boundary contract by Step 2) ----------

export type RecordRole = "STATEMENT" | "ATTEMPT" | "OBSERVATION";

export interface SourceRecord {
  recordId: RecordId;
  sessionId: SessionId;
  agentId: AgentId;
  timestamp: string;
  role: RecordRole;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface AtomicClaim {
  claimId: ClaimId;
  sourceRecordId: RecordId;
  statementText: string;
  expectedQuantity?: number;
  targetArtifactPath?: string;
}

export interface EvidencePacket {
  episodeId: EpisodeId;
  boundary: { triggerRecordId: RecordId; terminalRecordId: RecordId };
  records: SourceRecord[];
  claims: AtomicClaim[];
}

// ---------- Step 2: traces ----------

export interface ReasoningTrace {
  recordId: RecordId;
  agentId: AgentId;
  timestamp: string;
  scratchpadContent: string;
  associatedAttemptId?: RecordId;
  contradictionDelta?: {
    claimId: ClaimId;
    internalIntentText: string;
    externalReportText: string;
  };
}

// ---------- Step 2: hypotheses ----------

export const HypothesisCategorySchema = z.enum([
  "TOOL_FAILURE",
  "GOAL_AMBIGUITY",
  "COPIED_CLAIM",
  "SHORTCUT_PREFERENCE",
  "ASSIGNED_ROLE",
  "STRATEGIC_DECEPTION",
]);
export type HypothesisCategory = z.infer<typeof HypothesisCategorySchema>;

export const BENIGN_CATEGORIES: ReadonlySet<HypothesisCategory> = new Set([
  "TOOL_FAILURE",
  "GOAL_AMBIGUITY",
  "COPIED_CLAIM",
  "SHORTCUT_PREFERENCE",
  "ASSIGNED_ROLE",
]);

export const ForensicsHypothesisSchema = z.object({
  hypothesisId: HypothesisIdSchema,
  category: HypothesisCategorySchema,
  isBenignExplanation: z.boolean(),
  statement: z.string().min(1),
  supportingRecordIds: z.array(RecordIdSchema),
  refutingRecordIds: z.array(RecordIdSchema),
  confidence: z.number().min(0).max(1),
  esi: z.number().optional(),
});
export type ForensicsHypothesis = z.infer<typeof ForensicsHypothesisSchema>;

// ---------- Step 2: counterfactual discriminating test ----------

export const DiscriminatingTestSchema = z.object({
  testId: TestIdSchema,
  targetHypothesisId: HypothesisIdSchema,
  competingHypothesisId: HypothesisIdSchema,
  intervention: z.object({
    targetType: z.enum([
      "PROMPT_DELTA",
      "ENVIRONMENT_MOCK",
      "PERMISSION_RESTRICTION",
      "TOOL_MOCK_SUCCESS",
    ]),
    targetComponent: z.enum(["SYSTEM_PROMPT", "TOOL_OUTPUT", "USER_INSTRUCTION"]),
    deltaContent: z.string().min(1),
  }),
  expectedOutcomeUnderTarget: z.string().min(1),
  expectedOutcomeUnderCompeting: z.string().min(1),
  environmentDelta: z.array(z.string().min(1)),
});
export type DiscriminatingTestPlan = z.infer<typeof DiscriminatingTestSchema>;

export const EPISTEMIC_DISCLAIMER =
  "Reasoning traces suggest hypotheses. They do not prove ground-truth motive." as const;

export const ForensicsHypothesisSetSchema = z.object({
  episodeId: EpisodeIdSchema,
  hypotheses: z.array(ForensicsHypothesisSchema).min(2),
  epistemicDisclaimer: z.literal(EPISTEMIC_DISCLAIMER),
  discriminatingTests: z.array(DiscriminatingTestSchema),
});
export type ForensicsHypothesisSet = z.infer<typeof ForensicsHypothesisSetSchema>;

// ---------- Step 2: Goal Summarization & Reward Structure ----------

export const GoalSummarySchema = z.object({
  nominalGoal: z.string(),
  operativeGoal: z.string(),
  alignmentVerdict: z.enum(["ALIGNED", "SHORTCUT_DIVERGENT", "DECEPTIVE_MASKING"]),
  evidenceNotes: z.string(),
});
export type GoalSummary = z.infer<typeof GoalSummarySchema>;

export const LatentRewardStructureSchema = z.object({
  formulation: z.string(),
  operativeArchetype: z.string(),
  parameters: z.object({
    nominalReward: z.object({ label: z.string(), value: z.number(), active: z.boolean(), description: z.string() }),
    errorPenalty: z.object({ label: z.string(), value: z.number(), active: z.boolean(), description: z.string() }),
    computeCost: z.object({ label: z.string(), value: z.number(), active: z.boolean(), description: z.string() }),
    peerPressure: z.object({ label: z.string(), value: z.number(), active: z.boolean(), description: z.string() }),
  }),
  payoffComparison: z.array(z.object({
    action: z.string(),
    description: z.string(),
    netPayoffScore: z.number(),
    preferredByAgent: z.boolean(),
  })),
});
export type LatentRewardStructure = z.infer<typeof LatentRewardStructureSchema>;

// ---------- Step 2: LLM Narrative Synthesis & Causal Confirmation Report ----------

export const TraceGroupExplanationSchema = z.object({
  groupId: z.string(),
  title: z.string(),
  agentIds: z.array(z.string()),
  recordsInvolved: z.array(z.string()),
  whatHappened: z.string(),
  internalMonologueAnalysis: z.string(),
  outwardActionAnalysis: z.string(),
  investigatorFinding: z.string(),
  divergenceLevel: z.enum(["NONE", "SUSPICIOUS_SHORTCUT", "DECEPTIVE_FABRICATION"]),
});
export type TraceGroupExplanation = z.infer<typeof TraceGroupExplanationSchema>;

export const TraceNarrativeSchema = z.object({
  overallExecutiveSummary: z.string(),
  groupExplanations: z.array(TraceGroupExplanationSchema),
});
export type TraceNarrative = z.infer<typeof TraceNarrativeSchema>;

export const CausalConfirmationReportSchema = z.object({
  executiveVerdict: z.string(),
  interventionMechanism: z.string(),
  counterfactualBehaviorComparison: z.object({
    observationalBaseline: z.string(),
    counterfactualIntervention: z.string(),
    causalDivergenceSignificance: z.string(),
  }),
  rewardFunctionAnalysis: z.string(),
  remedialRecommendations: z.array(z.string()),
  epistemicCaveat: z.string(),
});
export type CausalConfirmationReport = z.infer<typeof CausalConfirmationReportSchema>;

// ---------- Step 2: simulation ----------

export type SimulationSignal =
  | "REAL_COUNT_OBSERVED"
  | "FABRICATED_COUNT"
  | "HONEST_ADOPTION"
  | "PERSISTED_ANOMALY"
  | "BEHAVIOR_SHIFTED"
  | "NO_CLEAR_SIGNAL";

export interface SimulationResult {
  testId: TestId;
  agentPolicy: string;
  appliedIntervention: string;
  emittedClaims: string[];
  observedCount?: number;
  signal: SimulationSignal;
  supportsHypothesisCategory: HypothesisCategory | "INCONCLUSIVE";
  environmentDivergenceNotice: string[];
}
