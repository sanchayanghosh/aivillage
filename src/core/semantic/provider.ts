import { JevJudgeModel } from "./jev.js";
import { OpenAIJudgeModel, type JudgeModel } from "./SemanticJudge.js";

export type JudgeProvider = "jev" | "openai";
export interface JudgeSetup { provider: JudgeProvider; model: JudgeModel }

/** Jev first (System One is built for typed yes/no questions), OpenAI as the fallback. */
export interface UserKeys { openai?: string; typesafe?: string }

/**
 * Jev is the judge when a TypeSafe key exists. Everything else in the product uses OpenAI.
 * Without a Jev key the judge falls back to OpenAI so the studio still works.
 */
export function judgeFromEnv(env: NodeJS.ProcessEnv = process.env, user: UserKeys = {}): JudgeSetup | null {
  const pref = env.JUDGE_PROVIDER?.toLowerCase();
  const jevKey = (user.typesafe || env.TYPESAFE_API_KEY)?.trim();
  const oaKey = (user.openai || env.OPENAI_API_KEY)?.trim();
  if (jevKey && pref !== "openai") return { provider: "jev", model: new JevJudgeModel(jevKey, env.JEV_MODEL ?? "jev-latest") };
  if (oaKey && pref !== "jev") return { provider: "openai", model: new OpenAIJudgeModel(env.JUDGE_MODEL ?? env.OPENAI_MODEL ?? "gpt-5.6-terra", oaKey, (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")) };
  return null;
}
