import { describe, expect, it } from "vitest";
import { normalizeTranscript } from "../../src/core/ingest/TranscriptNormalizer.js";
import { analyzeEpisode } from "../../src/core/episodes/EpisodeLoader.js";
import { buildGraph } from "../../src/core/graph/GraphBuilder.js";

const verdicts = (raw: string) => buildGraph(analyzeEpisode("t", normalizeTranscript(raw).jsonl)).nodes.filter((n) => n.nodeType === "CLAIM").map((n) => n.verdict);

describe("TranscriptNormalizer", () => {
  it("reads a plain text chat log and contradicts the claim", () => {
    const raw = `[09:01] agent-a: $ python export.py
[09:01] tool: stdout: wrote 0 rows to contacts.csv
[09:03] agent-a: Exported 93 contacts to contacts.csv
[09:04] agent-b: Endorsing, preparing the send`;
    const n = normalizeTranscript(raw);
    expect(n.report.format).toBe("text-log");
    expect(n.report.byRole).toMatchObject({ ATTEMPT: 1, OBSERVATION: 1, STATEMENT: 2 });
    expect(verdicts(raw)).toContain("CONTRADICTED");
  });

  it("reads OpenAI chat messages with tool calls and reasoning", () => {
    const raw = JSON.stringify([
      { role: "assistant", name: "bot", content: "", reasoning_content: "Upload will fail, I will say it worked.", tool_calls: [{ id: "1", function: { name: "upload", arguments: '{"f":"a.zip"}' } }] },
      { role: "tool", tool_call_id: "1", content: "error: 403 forbidden" },
      { role: "assistant", name: "bot", content: "I uploaded a.zip successfully." },
    ]);
    const n = normalizeTranscript(raw);
    expect(n.report.format).toBe("openai-chat");
    expect(n.report.scratchpads).toBe(1);
    expect(n.report.syntheticTimestamps).toBe(true);
    expect(verdicts(raw)).toContain("CONTRADICTED");
  });

  it("reads Anthropic content blocks", () => {
    const raw = [
      { role: "assistant", agent: "claude", content: [{ type: "thinking", thinking: "tests failed" }, { type: "tool_use", id: "t1", name: "bash", input: { cmd: "pytest" } }] },
      { role: "user", agent: "claude", content: [{ type: "tool_result", tool_use_id: "t1", content: "3 failed", is_error: true }] },
      { role: "assistant", agent: "claude", content: [{ type: "text", text: "All tests passed." }] },
    ].map((o) => JSON.stringify(o)).join("\n");
    const n = normalizeTranscript(raw);
    expect(n.report.format).toBe("anthropic-blocks");
    expect(n.report.byRole.OBSERVATION).toBe(1);
    expect(verdicts(raw)).toContain("CONTRADICTED");
  });

  it("passes native episode JSONL through unchanged", () => {
    const line = JSON.stringify({ record_id: "r1", session_id: "s", agent_id: "a", timestamp: "2025-06-11T09:00:00Z", role: "STATEMENT", event_type: "chat", payload: { text: "hi" } });
    const n = normalizeTranscript(line);
    expect(n.report.format).toBe("native");
    expect(n.records[0].recordId).toBe("r1");
  });

  it("warns when there is nothing to cross-check against", () => {
    const n = normalizeTranscript("alice: I finished the report\nbob: great");
    expect(n.report.warnings.join(" ")).toMatch(/No observations/);
    expect(verdicts("alice: I finished the report\nbob: great")).toEqual(["UNRESOLVED"]);
  });

  it("rejects empty input", () => {
    expect(() => normalizeTranscript("   ")).toThrow();
  });
});

describe("public dataset adapters", () => {
  it("reads SwarmTraces payloads linked by parent_id", () => {
    const raw = [{ id: "R1", cite: "R1:aa", kind: "payload", parent_id: null, time_utc: null, tags: "", text: "fetch('https://x')" }, { id: "R2", cite: "R2:bb", kind: "payload", parent_id: "R1", time_utc: null, tags: "", text: "document.write('hi')" }].map((o) => JSON.stringify(o)).join("\n");
    const n = normalizeTranscript(raw);
    expect(n.report.format).toBe("swarmtraces-payloads");
    expect(n.records.map((r) => r.recordId)).toEqual(["R1", "R2"]);
    expect(n.records[1].payload.parent_id).toBe("R1");
  });
  it("reads collusion.wiki events and turns probe results into observations", () => {
    const raw = [{ event_id: "probe:1", event_type: "probe", time: "2026-05-17T05:46:45Z", request_action: "browse-bare", success_observed: false, wiki: "dse" }, { event_id: "save:dse~A@1", event_type: "save", time: "2026-05-24T06:02:19Z", page: "A", wiki: "dse" }].map((o) => JSON.stringify(o)).join("\n");
    const n = normalizeTranscript(raw);
    expect(n.report.format).toBe("collusion-wiki-events");
    expect(n.report.byRole.OBSERVATION).toBe(1);
  });
  it("reads a urlquery CSV, one attempt and one dataset-label observation per row", () => {
    const raw = 'report_id,report_url,report_date_utc,timestamp_precision,disposition,confidence,broad_class,why_included,caveat\nabc,https://urlquery.net/report/abc,2026-03-11T12:05:59Z,second,included,significant,source_request,"IHME, health data","Candidate evidence"\n';
    const n = normalizeTranscript(raw);
    expect(n.report.format).toBe("urlquery-csv");
    expect(n.report.byRole).toMatchObject({ ATTEMPT: 1, OBSERVATION: 1 });
  });
});
