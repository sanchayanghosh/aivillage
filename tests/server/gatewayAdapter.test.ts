import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { gatewayToChat, openAiChunksToGateway } from "../../src/server/llm/gatewayAdapter.js";
import { runLlmTurn } from "../../src/server/llm/openaiProvider.js";

const gatewayBody = JSON.stringify({
  prompt: [
    { role: "system", content: "You operate the studio." },
    { role: "user", content: [{ type: "text", text: "hide observations" }] },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "set_entity_visibility", input: { type: "OBSERVATION", visible: false } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", output: { value: "ok" } }] },
  ],
  tools: [{ name: "set_entity_visibility", description: "d", inputSchema: { type: "object", properties: {} } }],
});

describe("gatewayAdapter", () => {
  it("maps libfx prompt parts and tools to OpenAI chat", () => {
    const { messages, tools } = gatewayToChat(gatewayBody);
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(messages[2].tool_calls?.[0].function).toEqual({ name: "set_entity_visibility", arguments: JSON.stringify({ type: "OBSERVATION", visible: false }) });
    expect(messages[3]).toMatchObject({ tool_call_id: "c1", content: "ok" });
    expect(tools).toHaveLength(1);
  });

  it("turns streamed chunks into a tool-call finish", () => {
    const sse = openAiChunksToGateway([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c9","function":{"name":"zoom","arguments":"{\\"action\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"fit\\"}"}}]}}]}',
      "data: [DONE]",
    ]);
    expect(sse).toContain('"toolName":"zoom"');
    expect(sse).toContain('"input":{"action":"fit"}');
    expect(sse).toContain('"unified":"tool-calls"');
  });

  it("refuses cleanly without a key", async () => {
    const r = await runLlmTurn(gatewayBody, { apiKey: undefined, model: "m", baseUrl: "http://x" });
    expect(r).toMatchObject({ ok: false, status: 503, code: "NO_LLM_KEY" });
  });

  it("round-trips through an OpenAI-compatible upstream", async () => {
    const upstream = createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        expect(req.headers.authorization).toBe("Bearer sk-test");
        expect(JSON.parse(b).stream).toBe(true);
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end('data: {"choices":[{"delta":{"content":"Hidden."}}]}\n\ndata: [DONE]\n\n');
      });
    });
    await new Promise<void>((r) => upstream.listen(0, r));
    const port = (upstream.address() as AddressInfo).port;
    const r = await runLlmTurn(gatewayBody, { apiKey: "sk-test", model: "m", baseUrl: `http://127.0.0.1:${port}` });
    upstream.close();
    expect(r.ok && r.sse).toContain('"delta":"Hidden."');
  });
});
