import type { SourceRecord, RecordRole } from "../types/contracts.js";
import type { AgentId, RecordId, SessionId } from "../types/brands.js";

/**
 * Turns an arbitrary agent transcript into the episode JSONL the rest of the
 * pipeline reads. Handles: native episode JSONL, JSON arrays, JSONL of generic
 * message objects, OpenAI chat messages (tool_calls / role:tool), Anthropic
 * content blocks (text, thinking, tool_use, tool_result), and plain text chat
 * logs ("[12:01] agent-a: message"). Roles come from explicit fields first and
 * from light text cues second. Every guess is reported back in `warnings`.
 */

export type DetectedFormat = "native" | "openai-chat" | "anthropic-blocks" | "generic-json" | "text-log" | "swarmtraces-payloads" | "collusion-wiki-events" | "urlquery-csv";

/** Large public datasets are sampled so the browser stays usable. */
export const ROW_CAP = 3000;

export interface NormalizeReport {
  format: DetectedFormat;
  inputItems: number;
  records: number;
  byRole: Record<RecordRole, number>;
  agents: string[];
  scratchpads: number;
  syntheticTimestamps: boolean;
  warnings: string[];
}
export interface NormalizeResult {
  records: SourceRecord[];
  jsonl: string;
  report: NormalizeReport;
}

type Obj = Record<string, any>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const first = (o: Obj, keys: string[]): unknown => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== "");

const TIME_KEYS = ["timestamp", "time", "ts", "created_at", "created", "date", "datetime", "at"];
const AGENT_KEYS = ["agent_id", "agent", "agentId", "sender", "author", "speaker", "name", "from", "actor", "model"];
const SESSION_KEYS = ["session_id", "session", "sessionId", "conversation_id", "thread_id", "room", "channel", "run_id"];
const TEXT_KEYS = ["content", "text", "message", "body", "output", "result", "stdout", "value", "response"];
const THOUGHT_KEYS = ["internal_scratchpad", "reasoning", "reasoning_content", "thinking", "thought", "scratchpad", "chain_of_thought"];

const OBS_TYPE = /(tool[_-]?result|observation|stdout|stderr|terminal[_-]?output|function[_-]?result|computer[_-]?output|screenshot|exit[_-]?code|^result$|^output$)/i;
const ATT_TYPE = /(tool[_-]?(use|call)|function[_-]?call|action|command|exec|bash|click|keypress|navigate|invoke|start[_-]?using)/i;

function parseItems(raw: string): { items: unknown[]; textMode: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("The transcript is empty.");
  if (trimmed.startsWith("[")) {
    try { const arr = JSON.parse(trimmed); if (Array.isArray(arr)) return { items: arr, textMode: false }; } catch { /* fall through */ }
  }
  if (trimmed.startsWith("{")) {
    try {
      const o = JSON.parse(trimmed);
      for (const k of ["messages", "records", "events", "transcript", "turns", "conversation", "items"]) if (Array.isArray(o[k])) return { items: o[k], textMode: false };
      if (!trimmed.includes("\n")) return { items: [o], textMode: false };
    } catch { /* maybe JSONL */ }
  }
  const lines = trimmed.split("\n").filter((l) => l.trim());
  const parsed: unknown[] = [];
  let ok = 0;
  for (const l of lines) {
    try { parsed.push(JSON.parse(l)); ok++; } catch { parsed.push(l); }
  }
  if (ok / lines.length >= 0.6) return { items: parsed.filter((p) => typeof p === "object" && p), textMode: false };
  return { items: lines, textMode: true };
}

function iso(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const s = String(v);
  const d = new Date(/^\d{4}-\d\d-\d\d \d/.test(s) ? s.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z") : s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function roleFromFields(o: Obj): RecordRole | null {
  const r = str(o.role).toLowerCase();
  const t = [o.type, o.event_type, o.kind, o.action_type].map(str).join(" ");
  if (r === "tool" || r === "function" || OBS_TYPE.test(t)) return "OBSERVATION";
  if (ATT_TYPE.test(t)) return "ATTEMPT";
  if (o.exit_code !== undefined || o.stdout !== undefined || o.stderr !== undefined) return "OBSERVATION";
  if (o.command !== undefined || o.tool_name !== undefined || o.tool !== undefined) return "ATTEMPT";
  return null;
}

interface Draft { agent: string; session: string; time?: string; role: RecordRole; eventType: string; payload: Obj; recordId?: string }

function fromBlocks(o: Obj, base: Omit<Draft, "role" | "eventType" | "payload">, out: Draft[]) {
  const blocks = o.content as Obj[];
  let thought = "";
  const texts: string[] = [];
  const local: Draft[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "thinking" || b.type === "reasoning" || b.thought === true) thought += (b.thinking ?? b.text ?? b.summary ?? "") + "\n";
    else if (b.type === "text" && b.text) texts.push(b.text);
    else if (b.type === "tool_use") local.push({ ...base, role: "ATTEMPT", eventType: "tool_use", payload: { tool_name: b.name, command: JSON.stringify(b.input ?? {}), tool_id: b.id } });
    else if (b.type === "tool_result") {
      const c = Array.isArray(b.content) ? b.content.map((x: Obj) => x.text ?? "").join("\n") : str(b.content);
      local.push({ ...base, role: "OBSERVATION", eventType: "tool_result", payload: { stdout: c, tool_id: b.tool_use_id, is_error: b.is_error === true, ...(b.is_error ? { exit_code: 1 } : {}) } });
    }
  }
  if (texts.length || thought) local.unshift({ ...base, role: "STATEMENT", eventType: "chat_message", payload: { text: texts.join("\n"), ...(thought ? { internal_scratchpad: thought.trim() } : {}) } });
  out.push(...local);
}

/** Adapters for public swarm datasets that are activity logs, not chat transcripts. */
function fromPublicDataset(o: Obj, out: Draft[]): boolean {
  // SwarmTraces (swarmtraces.org): reassembled attack payloads, linked by parent_id.
  if (o.kind === "payload" && typeof o.cite === "string" && typeof o.text === "string") {
    out.push({ recordId: String(o.id), agent: "swarm-agent", session: "swarmtraces", time: iso(o.time_utc), role: "ATTEMPT", eventType: "payload", payload: { command: o.text.slice(0, 1200), ...(o.parent_id ? { parent_id: String(o.parent_id) } : {}), cite: o.cite, tags: o.tags } });
    return true;
  }
  // collusion.wiki explorer events: saves, deletions, reverts and probes.
  if (typeof o.event_id === "string" && ["save", "delete", "revert", "probe"].includes(String(o.event_type))) {
    const where = o.page ?? o.request_action ?? "";
    const agent = String(o.wiki ?? "wiki-agent");
    out.push({ recordId: o.event_id, agent, session: String(o.wiki ?? "collusion"), time: iso(o.time), role: "ATTEMPT", eventType: String(o.event_type), payload: { command: `${o.event_type} ${where} ${o.param_family ?? ""}`.trim(), ...(o.related_event_id ? { parent_id: String(o.related_event_id) } : {}) } });
    if (o.event_type === "probe" && typeof o.success_observed === "boolean") {
      out.push({ agent, session: String(o.wiki ?? "collusion"), time: iso(o.time), role: "OBSERVATION", eventType: "probe_result", payload: { stdout: o.success_observed ? "probe succeeded" : "probe did not succeed (no success observed)", parent_id: o.event_id, ...(o.success_observed ? {} : { exit_code: 1 }) } });
    }
    return true;
  }
  return false;
}

/** Minimal CSV reader (quoted fields, doubled quotes). Stops after ROW_CAP rows. */
function parseCsv(raw: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let cur: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (q) { if (c === '"') { if (raw[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { cur.push(f); f = ""; }
    else if (c === "\n") { cur.push(f); rows.push(cur); cur = []; f = ""; if (rows.length > ROW_CAP) break; }
    else if (c !== "\r") f += c;
  }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ""])));
}

function fromObject(o: Obj, idx: number, out: Draft[], state: { lastAgent: string }) {
  if (fromPublicDataset(o, out)) return;
  const agent = str(first(o, AGENT_KEYS)) || str(o.role) || state.lastAgent || "agent";
  if (agent) state.lastAgent = agent;
  const base = { agent, session: str(first(o, SESSION_KEYS)) || "session-1", time: iso(first(o, TIME_KEYS)) };
  const thought = str(first(o, THOUGHT_KEYS));

  if (Array.isArray(o.content) && o.content.some((b: Obj) => b && typeof b === "object" && "type" in b)) return fromBlocks(o, base, out);

  if (Array.isArray(o.tool_calls)) {
    const text = str(o.content);
    if (text || thought) out.push({ ...base, role: "STATEMENT", eventType: "chat_message", payload: { text, ...(thought ? { internal_scratchpad: thought } : {}) } });
    for (const c of o.tool_calls) out.push({ ...base, role: "ATTEMPT", eventType: "tool_call", payload: { tool_name: c.function?.name ?? c.name, command: str(c.function?.arguments) || JSON.stringify(c.arguments ?? {}), tool_id: c.id } });
    return;
  }

  const textRaw = first(o, TEXT_KEYS);
  const text = typeof textRaw === "string" ? textRaw : textRaw === undefined ? "" : JSON.stringify(textRaw);
  const role = roleFromFields(o) ?? "STATEMENT";
  const payload: Obj = { ...(role === "OBSERVATION" ? { stdout: text } : role === "ATTEMPT" ? { command: text || str(o.command) } : { text }) };
  for (const k of ["exit_code", "target_path", "tool_name", "stderr"]) if (o[k] !== undefined) payload[k] = o[k];
  if (thought) payload.internal_scratchpad = thought;
  if (!text && !thought && role === "STATEMENT") { payload.text = JSON.stringify(o).slice(0, 300); }
  out.push({ ...base, role, eventType: str(o.event_type ?? o.type) || (role === "STATEMENT" ? "chat_message" : role.toLowerCase()), payload });
  void idx;
}

const LOG_LINE = /^\s*(?:\[?(\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?Z?|\d\d:\d\d(?::\d\d)?)\]?\s*)?[-–]?\s*([A-Za-z][\w .@-]{0,40}?)\s*[:>]\s+(.+)$/;

function fromTextLines(lines: string[], out: Draft[]) {
  let current: Draft | null = null;
  let lastAgent = "";
  for (const line of lines) {
    const m = LOG_LINE.exec(line);
    if (m) {
      const [, t, who, msg] = m;
      const shell = /^\$\s+/.test(msg);
      const obs = /^(stdout|stderr|output|result|exit code|error)\b[:\s]/i.test(msg) || /^(tool|system|terminal)$/i.test(who.trim());
      const toolSpeaker = /^(tool|system|terminal|stdout|output|result)$/i.test(who.trim());
      if (!toolSpeaker) lastAgent = who.trim();
      current = { agent: toolSpeaker && lastAgent ? lastAgent : who.trim(), session: "session-1", time: t ? (t.length <= 8 ? `1970-01-01T${t.padEnd(8, ":00")}Z` : iso(t)) : undefined, role: shell ? "ATTEMPT" : obs ? "OBSERVATION" : "STATEMENT", eventType: "chat_message", payload: {} };
      current.payload = current.role === "OBSERVATION" ? { stdout: msg } : current.role === "ATTEMPT" ? { command: msg.replace(/^\$\s+/, "") } : { text: msg };
      out.push(current);
    } else if (current) {
      const key = current.role === "OBSERVATION" ? "stdout" : current.role === "ATTEMPT" ? "command" : "text";
      current.payload[key] = `${current.payload[key]}\n${line.trim()}`;
    } else {
      out.push({ agent: "agent", session: "session-1", role: "STATEMENT", eventType: "chat_message", payload: { text: line.trim() } });
    }
  }
}

export function normalizeTranscript(raw: string): NormalizeResult {
  const warnings: string[] = [];
  // Transluce urlquery agent-activity CSV: one scanner report per row.
  if (/^report_id,report_url,/m.test(raw.slice(0, 400))) {
    const rows = parseCsv(raw).filter((r) => r.report_id);
    if (rows.length >= ROW_CAP) warnings.push(`Only the first ${ROW_CAP} reports were read.`);
    warnings.push("urlquery reports are scanner activity, not agent transcripts. Each row becomes an attempt, with the dataset's own disposition and confidence as its recorded observation. There are no agent claims to check.");
    const csvDrafts: Draft[] = [];
    for (const r of rows.slice(0, ROW_CAP)) {
      const agent = r.broad_class || "urlquery";
      csvDrafts.push({ recordId: r.report_id, agent, session: "urlquery", time: iso(r.report_date_utc), role: "ATTEMPT", eventType: "scan_report", payload: { command: `${r.report_url} ${r.why_included}`.slice(0, 600), tool_name: "urlquery" } });
      csvDrafts.push({ agent, session: "urlquery", time: iso(r.report_date_utc), role: "OBSERVATION", eventType: "dataset_label", payload: { stdout: `disposition=${r.disposition} confidence=${r.confidence || "none"}. ${r.caveat}`.slice(0, 600), parent_id: r.report_id } });
    }
    if (!csvDrafts.length) throw new Error("No rows could be read from this CSV.");
    return buildFromDrafts(csvDrafts, "urlquery-csv", rows.length, warnings);
  }
  const { items, textMode } = parseItems(raw);

  // Native episode JSONL: pass through untouched.
  const objs = items.filter((i): i is Obj => typeof i === "object" && i !== null);
  if (!textMode && objs.length && objs.every((o) => o.record_id && ["STATEMENT", "ATTEMPT", "OBSERVATION"].includes(o.role))) {
    const records: SourceRecord[] = objs.map((r) => ({ recordId: r.record_id, sessionId: r.session_id, agentId: r.agent_id, timestamp: String(r.timestamp), role: r.role, eventType: r.event_type, payload: r.payload ?? {} }));
    return finish(records, "native", items.length, warnings, false);
  }

  const drafts: Draft[] = [];
  let format: DetectedFormat;
  if (textMode) {
    format = "text-log";
    fromTextLines(items as string[], drafts);
  } else {
    const state = { lastAgent: "" };
    objs.forEach((o, i) => fromObject(o, i, drafts, state));
    format = objs.some((o) => Array.isArray(o.content) && o.content.some((b: Obj) => b?.type === "tool_use" || b?.type === "tool_result" || b?.type === "thinking")) ? "anthropic-blocks"
      : objs.some((o) => Array.isArray(o.tool_calls) || o.role === "tool") ? "openai-chat" : "generic-json";
  }
  if (!drafts.length) throw new Error("No messages could be read from this transcript.");
  const adapter = drafts.find((d) => d.recordId && ["payload", "save", "delete", "revert", "probe"].includes(d.eventType));
  if (adapter) {
    format = adapter.eventType === "payload" ? "swarmtraces-payloads" : "collusion-wiki-events";
    warnings.push(format === "swarmtraces-payloads" ? "SwarmTraces holds attack payloads, not agent messages. Each payload becomes an attempt linked to its parent. There are no claims or tool results to cross-check, so verdicts will not apply." : "collusion.wiki events are edits, deletions and probes. Probes carry a recorded success flag, which becomes an observation. There are no agent claims to check.");
  }
  if (items.length > ROW_CAP) warnings.push(`This file has ${items.length} rows. Only the first ${ROW_CAP} were read.`);
  return buildFromDrafts(drafts.slice(0, ROW_CAP * 2), format, items.length, warnings);
}

function buildFromDrafts(drafts: Draft[], format: DetectedFormat, inputItems: number, warnings: string[]): NormalizeResult {
  // Timestamps: keep real ones, fill gaps in order.
  const synthetic = drafts.some((d) => !d.time);
  if (synthetic) warnings.push("Some or all records had no timestamp. Order in the file was used and timestamps were synthesized one second apart, so time-based verdict rules reflect file order only.");
  const known = drafts.find((d) => d.time)?.time;
  const base = known ? new Date(known).getTime() : Date.UTC(2000, 0, 1);
  let last = base - 1000;
  const records: SourceRecord[] = drafts.map((d, i) => {
    let t = d.time ? new Date(d.time).getTime() : last + 1000;
    if (t <= last) t = last + 1; // keep strictly increasing in file order
    last = t;
    return {
      recordId: (d.recordId ?? `rec-${String(i + 1).padStart(4, "0")}`) as RecordId, sessionId: d.session as SessionId, agentId: d.agent as AgentId,
      timestamp: new Date(t).toISOString(), role: d.role, eventType: d.eventType, payload: d.payload,
    };
  });
  return finish(records, format, inputItems, warnings, synthetic);
}

function finish(records: SourceRecord[], format: DetectedFormat, inputItems: number, warnings: string[], synthetic: boolean): NormalizeResult {
  const byRole: Record<RecordRole, number> = { STATEMENT: 0, ATTEMPT: 0, OBSERVATION: 0 };
  records.forEach((r) => byRole[r.role]++);
  const scratchpads = records.filter((r) => r.payload.internal_scratchpad).length;
  if (!byRole.OBSERVATION) warnings.push("No observations (tool outputs, file listings, screenshots) were found. Claims can only be UNRESOLVED without independent evidence. If the transcript has tool results under another field name, rename that field to `output` or `stdout`.");
  if (!scratchpads) warnings.push("No reasoning traces were found, so Step 2 cannot compare reasoning with reports.");
  const agents = [...new Set(records.map((r) => String(r.agentId)))];
  if (agents.length === 1) warnings.push("Only one agent id was detected. If several agents are in this transcript, include a speaker field such as `agent` or a `name:` prefix on each line.");
  const jsonl = records.map((r) => JSON.stringify({ record_id: r.recordId, session_id: r.sessionId, agent_id: r.agentId, timestamp: r.timestamp, role: r.role, event_type: r.eventType, payload: r.payload })).join("\n");
  return { records, jsonl, report: { format, inputItems, records: records.length, byRole, agents, scratchpads, syntheticTimestamps: synthetic, warnings } };
}
