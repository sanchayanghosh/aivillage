import { apiFetch } from "../studio/keys";
import { studio } from "../studio/store";
import { AGENT_INSTRUCTIONS } from "./instructions";
import { STUDIO_TOOLS } from "./tools";
import { snapshot } from "./snapshot";

type TurnEvent = { type?: string; delta?: string; toolName?: string };
type Turn = AsyncIterable<TurnEvent> & { result?: Promise<unknown> };
interface FxAgent {
  prompt: (text: string, options?: { signal?: AbortSignal }) => Turn;
  close: () => Promise<void>;
}

export type AgentPhase = "idle" | "starting" | "ready" | "unsupported" | "error";
export interface AgentHooks {
  onText: (delta: string) => void;
  onTool: (name: string, input: unknown, result: string, failed: boolean) => void;
}

/** The libfx model fetch goes through our server so the API key stays there. */
async function modelFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const isModel = url.includes("ai-gateway.vercel.sh") || url.endsWith("/responses") || url.includes("/chat/completions");
  if (!isModel) return fetch(input, init);
  let body = "";
  if (typeof init?.body === "string") body = init.body;
  else if (init?.body instanceof Uint8Array) body = new TextDecoder().decode(init.body);
  else if (init?.body instanceof ArrayBuffer) body = new TextDecoder().decode(new Uint8Array(init.body));
  return apiFetch("/api/provider", { method: "POST", headers: { "content-type": "application/json" }, body, signal: init?.signal ?? undefined });
}

let agent: FxAgent | null = null;
let hooks: AgentHooks | null = null;

export async function startAgent(h: AgentHooks): Promise<AgentPhase> {
  hooks = h;
  if (agent) return "ready";
  const libfx = await import("libfx/browser");
  if (!libfx.supportsJspi()) return "unsupported";
  agent = (await libfx.createFxAgent({
    apiKey: "swarm-evidence-graph",
    instructions: AGENT_INSTRUCTIONS,
    fetch: modelFetch,
    tools: STUDIO_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      async execute(input: Record<string, unknown>) {
        try {
          const out = await tool.execute(input ?? {});
          hooks?.onTool(tool.name, input, out.length > 280 ? out.slice(0, 280) + "…" : out, false);
          return out;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          hooks?.onTool(tool.name, input, msg, true);
          return `Error: ${msg}`;
        }
      },
    })),
  })) as FxAgent;
  return "ready";
}

/** Send one analyst line. The studio snapshot rides along so the agent sees live context. */
export async function say(line: string): Promise<void> {
  if (!agent) throw new Error("Agent is not running.");
  const context = JSON.stringify(snapshot(studio.get()));
  const turn = agent.prompt(`Studio state right now:\n${context}\n\nAnalyst: ${line}`);
  for await (const ev of turn) if (ev.type === "text_delta" && ev.delta) hooks?.onText(ev.delta);
  if (turn.result) await turn.result;
}

export async function stopAgent() {
  await agent?.close().catch(() => undefined);
  agent = null;
}

export const REPORT_PROMPT =
  "Write the verbose forensic report for the current episode. Gather evidence with as few turns as possible: call independent tools in the same turn (state, inspect_entity for each non-supported claim, run_forensics if Step 2 has not run). Then publish it with write_report. After publishing, reply with two sentences saying what the report found.";
