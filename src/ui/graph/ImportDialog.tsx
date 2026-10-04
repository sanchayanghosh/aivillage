import { useRef, useState } from "react";
import { actions } from "../studio/actions";
import { useStudio, type IngestReport } from "../studio/store";

const FORMAT_LABEL: Record<string, string> = {
  native: "Episode JSONL", "openai-chat": "OpenAI chat messages", "anthropic-blocks": "Anthropic content blocks", "generic-json": "Generic JSON messages", "text-log": "Plain text log", "swarmtraces-payloads": "SwarmTraces payloads", "collusion-wiki-events": "collusion.wiki events", "urlquery-csv": "Transluce urlquery CSV",
};

export default function ImportDialog() {
  const open = useStudio((s) => s.importOpen);
  const [name, setName] = useState("my-transcript");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<IngestReport | null>(null);
  const file = useRef<HTMLInputElement>(null);
  if (!open) return null;

  async function analyze() {
    setBusy(true); setErr(null); setReport(null);
    try { setReport(await actions.importTranscript(name || "my-transcript", text)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function onFile(f?: File) {
    if (!f) return;
    setName(f.name.replace(/\.[^.]+$/, "")); setText(await f.text()); setReport(null);
  }

  return (
    <div className="modal-back" onClick={() => actions.openImport(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header><b>Import an agent transcript</b><button className="x" onClick={() => actions.openImport(false)} aria-label="Close">×</button></header>
        <div className="modal-body">
          <p className="hint">Any format works: JSONL or JSON exports, OpenAI or Anthropic message logs, or plain text such as <code>agent-a: Exported 93 contacts</code>. The server detects the format and tells you what it could and could not read. Nothing leaves your machine except the optional agent chat.</p>
          <div className="row2">
            <input ref={file} type="file" accept=".jsonl,.json,.txt,.log,.md,.ndjson,.csv" onChange={(e) => void onFile(e.target.files?.[0])} />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Episode name" />
          </div>
          <textarea rows={11} value={text} onChange={(e) => { setText(e.target.value); setReport(null); }} placeholder={'Paste a transcript here, for example:\n[09:01] agent-a: $ python export.py\n[09:01] tool: wrote 0 rows to contacts.csv\n[09:03] agent-a: Exported 93 contacts to contacts.csv'} />
          {err && <p className="err">{err}</p>}
          {report && (
            <div className="ingest">
              <div><span className="chip chip-ok">{FORMAT_LABEL[report.format] ?? report.format}</span> {report.records} records from {report.inputItems} items · {report.byRole.STATEMENT} statements · {report.byRole.ATTEMPT} attempts · {report.byRole.OBSERVATION} observations · {report.scratchpads} reasoning traces · agents: {report.agents.join(", ")}</div>
              {report.warnings.map((w, i) => <p key={i} className="warnline">{w}</p>)}
            </div>
          )}
        </div>
        <footer>
          {report && <button className="btn" onClick={() => { actions.openImport(false); }}>View graph</button>}
          {report && <button className="btn" onClick={() => { actions.openImport(false); actions.switchView("forensics"); }}>Run Step 2 →</button>}
          <span className="grow" />
          <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void analyze()}>{busy ? "Analyzing…" : "Analyze transcript"}</button>
        </footer>
      </div>
    </div>
  );
}
