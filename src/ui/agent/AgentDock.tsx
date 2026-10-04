import { useEffect, useRef, useState } from "react";
import { useStudio } from "../studio/store";
import { actions } from "../studio/actions";
import { startAgent, say, REPORT_PROMPT, type AgentPhase } from "./fxAgent";

interface Msg { id: number; who: "you" | "agent" | "tool"; text: string; failed?: boolean }
const CHIPS = ["What is on screen right now?", "Show only claims and observations", "Select the contradicted claim and explain its verdict", "Switch to hierarchical layout"];

export default function AgentDock({ onClose }: { onClose: () => void }) {
  const status = useStudio((s) => s.status);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const seq = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const configured = status?.llm.configured ?? false;

  const push = (m: Omit<Msg, "id">) => setMsgs((x) => [...x, { ...m, id: ++seq.current }]);
  const appendAgent = (d: string) => setMsgs((x) => {
    const last = x[x.length - 1];
    return last?.who === "agent" ? [...x.slice(0, -1), { ...last, text: last.text + d }] : [...x, { id: ++seq.current, who: "agent", text: d }];
  });

  useEffect(() => {
    if (!configured) return;
    setPhase("starting");
    startAgent({
      onText: appendAgent,
      onTool: (name, input, result, failed) => push({ who: "tool", text: `${name}(${JSON.stringify(input).slice(0, 110)}${JSON.stringify(input).length > 110 ? "…" : ""}) → ${result}`, failed }),
    }).then(setPhase).catch((e) => { setPhase("error"); push({ who: "agent", text: `The agent could not start: ${e instanceof Error ? e.message : e}` }); });
  }, [configured]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  async function send(line: string, display = line) {
    if (!line.trim() || busy) return;
    push({ who: "you", text: display }); setText(""); setBusy(true);
    try { await say(line); }
    catch (e) { push({ who: "agent", text: `Request failed: ${e instanceof Error ? e.message : e}` }); }
    finally { setBusy(false); }
  }
  const ready = phase === "ready";

  return (
    <aside className="dock">
      <header><b>Studio agent</b><span className={`chip ${ready ? "chip-ok" : "chip-warn"}`}>{ready ? "libfx · wasm" : phase === "starting" ? "starting…" : configured ? phase : "no LLM key"}</span><span className="grow" /><button className="x" onClick={onClose} aria-label="Close agent">×</button></header>
      <div className="dock-body">
        {!msgs.length && (
          <div className="dock-hello">
            <p>This agent runs in your browser as a libfx WebAssembly agent. It sees the live studio state and operates the same controls you do.</p>
            {!configured && <p className="warn">Set <code>OPENAI_API_KEY</code> in <code>.env</code> and restart <code>npm run dev</code> to enable chat. The offline report below works without it.</p>}
            {phase === "unsupported" && <p className="warn">This browser lacks JavaScript Promise Integration. Use Chrome or Edge 137+, or Safari 27.</p>}
            <div className="chips">{CHIPS.map((c) => <button key={c} disabled={!ready || busy} onClick={() => send(c)}>{c}</button>)}</div>
          </div>
        )}
        {msgs.map((m) => <div key={m.id} className={`msg ${m.who} ${m.failed ? "failed" : ""}`}>{m.who === "tool" ? <><i>tool</i> {m.text}</> : m.text}</div>)}
        {busy && <div className="msg tool"><i>working…</i></div>}
        <div ref={end} />
      </div>
      <div className="dock-actions">
        <button className="btn primary" disabled={busy || (configured && !ready)} onClick={() => (configured ? send(REPORT_PROMPT, "Write the verbose report") : actions.writeOfflineReport())}>
          {configured ? "Write verbose report (agent)" : "Write verbose report (offline)"}
        </button>
        {configured && <button className="btn" onClick={() => actions.writeOfflineReport()}>Offline draft</button>}
      </div>
      <form className="dock-input" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={ready ? "Ask or tell the studio what to do…" : "Agent unavailable"} disabled={!ready || busy} />
        <button className="btn" disabled={!ready || busy || !text.trim()}>Send</button>
      </form>
    </aside>
  );
}
