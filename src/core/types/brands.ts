import { z } from "zod";

export const AgentIdSchema = z.string().min(1).brand<"AgentId">();
export const SessionIdSchema = z.string().min(1).brand<"SessionId">();
export const RecordIdSchema = z.string().min(1).brand<"RecordId">();
export const EpisodeIdSchema = z.string().min(1).brand<"EpisodeId">();
export const ClaimIdSchema = z.string().min(1).brand<"ClaimId">();
export const HypothesisIdSchema = z.string().min(1).brand<"HypothesisId">();
export const TestIdSchema = z.string().min(1).brand<"TestId">();

export type AgentId = z.infer<typeof AgentIdSchema>;
export type SessionId = z.infer<typeof SessionIdSchema>;
export type RecordId = z.infer<typeof RecordIdSchema>;
export type EpisodeId = z.infer<typeof EpisodeIdSchema>;
export type ClaimId = z.infer<typeof ClaimIdSchema>;
export type HypothesisId = z.infer<typeof HypothesisIdSchema>;
export type TestId = z.infer<typeof TestIdSchema>;
