import { gatewayToChat, openAiChunksToGateway } from "./gatewayAdapter.js";

export interface LlmConfig {
  apiKey?: string;
  model: string;
  baseUrl: string;
}

export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env, userKey?: string): LlmConfig {
  return {
    apiKey: userKey?.trim() || env.OPENAI_API_KEY?.trim() || undefined,
    model: env.OPENAI_MODEL?.trim() || "gpt-5.6-terra",
    baseUrl: (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, ""),
  };
}

export type LlmResult =
  | { ok: true; sse: string }
  | { ok: false; status: number; code: "NO_LLM_KEY" | "UPSTREAM"; message: string };

/**
 * One libfx model turn: gateway request in, gateway SSE out. The API key never
 * leaves the server; the browser agent only ever talks to /api/provider.
 */
export async function runLlmTurn(gatewayBody: string, config: LlmConfig = llmConfigFromEnv()): Promise<LlmResult> {
  if (!config.apiKey) {
    return { ok: false, status: 503, code: "NO_LLM_KEY", message: "OPENAI_API_KEY is not set. Add it to .env and restart the API." };
  }
  const { messages, tools } = gatewayToChat(gatewayBody);
  const upstream = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages,
      tools: tools.length ? tools : undefined,
      // gpt-5 chat completions reject function tools unless reasoning is off.
      ...(config.model.startsWith("gpt-5") ? { reasoning_effort: "none" } : {}),
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
  if (!upstream.ok) {
    return { ok: false, status: upstream.status, code: "UPSTREAM", message: (await upstream.text()).slice(0, 400) || upstream.statusText };
  }
  const raw = await upstream.text();
  return { ok: true, sse: openAiChunksToGateway(raw.split("\n").filter((l) => l.trim())) };
}
