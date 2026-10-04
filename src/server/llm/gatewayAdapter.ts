/**
 * Translates between the libfx language-model wire format ("gateway" prompt/tool
 * parts) and OpenAI chat completions. Pure functions, no network access, so the
 * whole seam is testable with plain strings.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface GatewayTool {
  name?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
    .filter(Boolean)
    .join("\n");
}

function toolOutput(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      if (record.type !== "tool-result" && record.type !== "tool_result") return "";
      const output = record.output ?? record.result ?? record.content;
      if (typeof output === "string") return output;
      if (output && typeof output === "object") {
        const value = output as Record<string, unknown>;
        if (typeof value.value === "string") return value.value;
        if (typeof value.text === "string") return value.text;
      }
      return output == null ? "" : JSON.stringify(output);
    })
    .filter(Boolean)
    .join("\n");
}

function toolCallIdOf(content: unknown, record: Record<string, unknown>): string {
  for (const key of ["toolCallId", "tool_call_id"]) if (typeof record[key] === "string") return record[key] as string;
  if (Array.isArray(content)) {
    for (const part of content) {
      const item = part as Record<string, unknown> | null;
      if (item && typeof item.toolCallId === "string") return item.toolCallId;
    }
  }
  return "call";
}

function toolCallsOf(content: unknown): ChatMessage["tool_calls"] {
  if (!Array.isArray(content)) return undefined;
  const calls = content.flatMap((part) => {
    const record = part as Record<string, unknown> | null;
    if (!record || record.type !== "tool-call" || typeof record.toolName !== "string") return [];
    return [
      {
        id: typeof record.toolCallId === "string" ? record.toolCallId : "call",
        type: "function" as const,
        function: { name: record.toolName, arguments: JSON.stringify(record.input ?? record.args ?? {}) },
      },
    ];
  });
  return calls.length ? calls : undefined;
}

export function gatewayToChat(body: string): { messages: ChatMessage[]; tools: Array<Record<string, unknown>> } {
  const parsed = JSON.parse(body) as { prompt?: unknown; tools?: unknown };
  const prompt = Array.isArray(parsed.prompt) ? parsed.prompt : [];
  const messages: ChatMessage[] = [];
  for (const entry of prompt) {
    const record = entry as Record<string, unknown> | null;
    if (!record) continue;
    const role = record.role;
    if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") continue;
    if (role === "tool" && Array.isArray(record.content)) {
      // One libfx tool message can carry several results. OpenAI wants one tool message per call id.
      const results = (record.content as Array<Record<string, unknown>>).filter((p) => p && (p.type === "tool-result" || p.type === "tool_result"));
      if (results.length) {
        for (const part of results) messages.push({ role: "tool", content: toolOutput([part]), tool_call_id: typeof part.toolCallId === "string" ? part.toolCallId : toolCallIdOf([part], record) });
        continue;
      }
    }
    const spoken = textOf(record.content);
    const message: ChatMessage = { role, content: role === "tool" ? toolOutput(record.content) || spoken : spoken };
    const calls = role === "assistant" ? toolCallsOf(record.content) : undefined;
    if (calls) message.tool_calls = calls;
    if (role === "tool") message.tool_call_id = toolCallIdOf(record.content, record);
    messages.push(message);
  }
  if (!messages.length) messages.push({ role: "user", content: "Say one short line." });
  const tools = Array.isArray(parsed.tools)
    ? (parsed.tools as GatewayTool[]).flatMap((tool) =>
        tool?.name
          ? [{ type: "function", function: { name: tool.name, description: tool.description ?? "", parameters: tool.inputSchema ?? { type: "object", properties: {} } } }]
          : [],
      )
    : [];
  return { messages, tools };
}

const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

/** Collapse OpenAI streaming chunks into one libfx-compatible SSE payload. */
export function openAiChunksToGateway(chunks: string[]): string {
  const tools = new Map<number, { id: string; name: string; args: string }>();
  let input = 0;
  let output = 0;
  let text = "";
  for (const chunk of chunks) {
    const line = chunk.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    const json = JSON.parse(data) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }>;
    };
    if (json.usage) {
      input = json.usage.prompt_tokens ?? input;
      output = json.usage.completion_tokens ?? output;
    }
    const delta = json.choices?.[0]?.delta;
    if (delta?.content) text += delta.content;
    for (const call of delta?.tool_calls ?? []) {
      const index = call.index ?? 0;
      const current = tools.get(index) ?? { id: "", name: "", args: "" };
      if (call.id) current.id = call.id;
      if (call.function?.name) current.name += call.function.name;
      if (call.function?.arguments) current.args += call.function.arguments;
      tools.set(index, current);
    }
  }
  let out = "";
  if (text) out += sse({ type: "text-delta", id: "t1", delta: text });
  for (const tool of tools.values()) {
    let inputValue: unknown = {};
    try {
      inputValue = JSON.parse(tool.args || "{}");
    } catch {
      /* keep empty input */
    }
    const id = tool.id || "call";
    out += sse({ type: "tool-input-start", id, toolName: tool.name });
    out += sse({ type: "tool-call", toolCallId: id, toolName: tool.name, input: inputValue });
  }
  const reason = tools.size ? "tool-calls" : "stop";
  out += sse({ type: "finish", finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: input }, outputTokens: { total: output } } });
  return out + "data: [DONE]\n\n";
}
