import { useStudio } from "../studio/store";
import { actions } from "../studio/actions";
import Markdown from "../agent/Markdown";
import RealPanels from "./RealPanels";
import { leads, questions, unmappedEventTypes, judgments } from "./mock/data";

export default function Bottom() {
  const st = useStudio((x) => x);
  const { nodes, confirmed, overrides, bottomOpen: open, bottomTab: tab, leadThreshold: thr, dataset, report } = st;
  const onSelect = (id: string) => actions.selectNode(id);
  const claims = nodes.filter((n) => n.nodeType === "CLAIM");
  const mock = dataset === "mock";
  const real = !mock;
  const tabs: [typeof tab, string, number?][] = [["leads", "Lead Finder", mock ? leads.length : st.leads?.leads.length], ["ledger", "Claim Ledger", claims.length], ["judge", "Semantic Judge", mock ? judgments.length : st.leads?.judgments.length], ["eval", "Measured Detection"], ["coverage", "Coverage"], ["report", "Report"]];
  return (
    <div className={`bottom ${open ? "" : "collapsed"} ${tab === "report" ? "tall" : ""}`}>
      <div className="b-tabs">
        {tabs.map(([k, l, c]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => actions.openPanel(k)}>{l}{c !== undefined && <span className="count">{c}</span>}</button>)}
        <span className="grow" /><button className="b-toggle" onClick={() => actions.openPanel(tab, !open)}>{open ? "▾" : "▴"}</button>
      </div>
      {open && <div className="b-body">
        {real && (tab === "leads" || tab === "judge" || tab === "eval" || tab === "coverage") && <RealPanels tab={tab} />}
        {mock && (tab === "leads" || tab === "judge" || tab === "eval" || tab === "coverage") && <div className="b-tool"><span className="chip chip-warn">sample data</span><span className="hint">These tables belong to the built-in sample. Import your own transcript to run the real Semantic Judge.</span></div>}
        {mock && tab === "leads" && (
          <>
            <div className="b-tool"><label>Lead threshold <input type="range" min={0} max={1} step={0.05} value={thr} onChange={e => actions.setLeadThreshold(+e.target.value)} /> <b>{thr.toFixed(2)}</b></label>
              <span className="hint">Thresholds are set from the hand-labelled evaluation set (FR-4.1). Each route = SQL pre-filter → fixed model question.</span></div>
            <table><thead><tr><th>Lead</th><th>Route</th><th>Score</th><th>Episode</th><th>Summary</th><th>Questions</th><th></th></tr></thead>
              <tbody>{leads.map(l => { const pass = l.score >= thr; return (
                <tr key={l.id} className={pass ? "" : "faded"}>
                  <td className="mono">{l.id}</td><td><span className="route">R{l.route}</span> {l.routeName}</td>
                  <td><span className="score"><i style={{ width: l.score * 100 + "%" }} />{l.score.toFixed(2)}</span></td>
                  <td className="mono">{l.episode}</td><td>{l.summary}{l.control && <span className="chip chip-ok">control</span>}</td>
                  <td className="mono small">{l.questions.join(" · ")}</td>
                  <td>{pass ? <span className="chip chip-live">emits lead</span> : <span className="chip">below threshold</span>}</td></tr>); })}</tbody></table>
          </>)}
        {tab === "ledger" && (
          <table><thead><tr><th>Claim</th><th>Agent</th><th>Time</th><th>Verdict</th><th>Basis</th><th>Statement</th></tr></thead>
            <tbody>{claims.map(c => <tr key={c.id} className="click" onClick={() => onSelect(c.id)}>
              <td><b>{c.label}</b></td><td>{c.agent}</td><td className="mono">{c.time}</td>
              <td><span className={`vpill v-${(overrides[c.id] ?? c.verdict)!.toLowerCase()}`}>{overrides[c.id] ?? c.verdict}</span></td>
              <td>{c.modelAssisted ? (confirmed.includes(c.id) ? <span className="chip chip-ok">confirmed</span> : <span className="chip chip-warn">MODEL_ASSISTED</span>) : <span className="chip">rule only</span>}</td>
              <td className="small">{c.previewText}</td></tr>)}</tbody></table>)}
        {mock && tab === "judge" && (
          <table><thead><tr><th>Output</th><th>Question</th><th>Answer</th><th>p</th><th>Model</th><th>Inputs</th><th>Cache</th></tr></thead>
            <tbody>{judgments.map(j => <tr key={j.id}><td className="mono">{j.id}</td><td className="mono">{j.questionId}@{j.questionVersion}</td><td>{j.answer}</td>
              <td><span className="score"><i style={{ width: j.probability * 100 + "%" }} />{j.probability.toFixed(2)}</span></td>
              <td className="mono small">{j.model}</td><td className="mono small">{j.inputRecordIds.join(", ")}</td>
              <td>{j.cached ? <span className="chip chip-cache">hit</span> : <span className="chip chip-live">miss</span>}</td></tr>)}</tbody></table>)}
        {mock && tab === "eval" && (
          <table><thead><tr><th>Question</th><th>Question text (descriptive, no motive)</th><th>Used by</th><th>Thr.</th><th>Eval rows</th><th>Precision</th><th>Recall</th><th>Regression</th></tr></thead>
            <tbody>{questions.map(q => { const bad = q.storedPrecision - q.precision > 0.1 || q.storedRecall - q.recall > 0.1; return (
              <tr key={q.questionId}><td className="mono">{q.questionId}@{q.version}</td><td className="small">{q.text}</td><td>{q.usedBy}</td><td>{q.threshold}</td><td>{q.evalRows}</td>
                <td>{q.precision.toFixed(2)} <span className="small dim">/ {q.storedPrecision.toFixed(2)}</span></td><td>{q.recall.toFixed(2)} <span className="small dim">/ {q.storedRecall.toFixed(2)}</span></td>
                <td>{bad ? <span className="chip chip-bad">FAIL &gt;10pt drop</span> : <span className="chip chip-ok">pass</span>}</td></tr>); })}</tbody></table>)}
        {tab === "report" && (
          report ? <article className="report"><div className="b-tool"><span className={`chip ${report.author === "agent" ? "chip-live" : ""}`}>{report.author === "agent" ? "written by the studio agent (libfx)" : "assembled offline"}</span><span className="hint">{new Date(report.at).toLocaleString()}</span><button className="btn" onClick={() => navigator.clipboard?.writeText(report.markdown)}>Copy markdown</button></div><Markdown text={report.markdown} /></article>
          : <div className="b-tool"><span className="hint">No report yet. Use "Verbose Report" in the ribbon, or ask the agent to write one.</span></div>
        )}
        {mock && tab === "coverage" && (
          <>
            <div className="b-tool"><span className="chip chip-bad">2 unmapped event types</span><span className="hint">Module 2 does not start while this list is not empty, unless an analyst accepts it. Unknown types map to UNKNOWN, never STATEMENT.</span></div>
            <table><thead><tr><th>Event type</th><th>Records</th><th>Role</th><th></th></tr></thead>
              <tbody>{unmappedEventTypes.map(u => <tr key={u.eventType}><td className="mono">{u.eventType}</td><td>{u.count.toLocaleString()}</td>
                <td>{u.mapped ? <span className="chip chip-ok">{u.mapped}</span> : <span className="chip chip-bad">UNKNOWN</span>}</td>
                <td>{!u.mapped && <button className="btn">Map…</button>}</td></tr>)}</tbody></table>
          </>)}
      </div>}
    </div>
  );
}
