import { useStudio } from "../studio/store";
import { actions } from "../studio/actions";

const pct = (n: number) => <span className="score"><i style={{ width: n * 100 + "%" }} />{n.toFixed(2)}</span>;

export default function RealPanels({ tab }: { tab: "leads" | "judge" | "eval" | "coverage" }) {
  const st = useStudio((s) => s);
  const { leads, leadsLoading: loading, leadsError: error, leadThreshold: thr, dataset } = st;
  if (dataset === "none") return <div className="b-tool"><span className="hint">Load a transcript first.</span></div>;
  if (!leads) {
    return (
      <div className="b-tool">
        <button className="btn primary" style={{ width: "auto", margin: 0 }} disabled={loading} onClick={() => void actions.runLeadFinder()}>{loading ? "Asking the model…" : "Run Lead Finder"}</button>
        <span className="hint">Each route filters rows exactly (agent, order, time window, identifiers), then asks the Semantic Judge a fixed question about the rows that survive. It runs on the server with your OpenAI key.</span>
        {error && <span className="chip chip-bad">{error}</span>}
      </div>
    );
  }
  if (tab === "leads") {
    return (<>
      <div className="b-tool"><label>Lead threshold <input type="range" min={0} max={1} step={0.05} value={thr} onChange={(e) => actions.setLeadThreshold(+e.target.value)} /> <b>{thr.toFixed(2)}</b></label>
        <span className="hint">{leads.provider === "jev" ? "Jev" : "OpenAI fallback"} · {leads.model} · {leads.judge.asked} questions · {leads.judge.cacheHits} cached · {leads.judge.parseErrors + leads.judge.modelErrors} errors. Threshold is a slider, not tuned: no evaluation set exists yet.</span>
        <button className="btn" onClick={() => void actions.runLeadFinder()}>Re-run</button></div>
      <table><thead><tr><th>Lead</th><th>Route</th><th>Score</th><th>Summary</th><th>Pre-filter</th><th>Questions</th><th></th></tr></thead>
        <tbody>{leads.leads.map((l) => { const pass = l.score >= thr; return (
          <tr key={l.id} className={pass ? "" : "faded"}><td className="mono">{l.id}</td><td><span className="route">R{l.route}</span> {l.routeName}</td><td>{pct(l.score)}</td><td>{l.summary}</td><td className="mono small">{l.sql}</td><td className="mono small">{l.questions.join(" · ")}</td>
            <td>{pass ? <span className="chip chip-live">emits lead</span> : <span className="chip">below threshold</span>}</td></tr>); })}
          {!leads.leads.length && <tr><td colSpan={7} className="small">No leads found. Either nothing in this transcript matches a route, or the model answered "no" everywhere.</td></tr>}</tbody></table></>);
  }
  if (tab === "judge") {
    return (
      <table><thead><tr><th>Question</th><th>Answer</th><th>p(right)</th><th>Records</th><th>Text</th><th>Cache</th></tr></thead>
        <tbody>{leads.judgments.map((j, i) => (<tr key={i}><td className="mono">{j.questionId}@{j.questionVersion}</td><td>{String(j.answer)}</td><td>{pct(j.probability)}</td><td className="mono small">{j.inputRecordIds.join(", ")}</td><td className="small">{j.recordText}</td>
          <td>{j.cached ? <span className="chip chip-cache">hit</span> : <span className="chip chip-live">fresh</span>}</td></tr>))}</tbody></table>);
  }
  if (tab === "eval") {
    return (<>
      <div className="b-tool"><span className="chip chip-warn">unmeasured</span><span className="hint">Precision and recall need 30–50 rows per question labelled by hand before looking at model answers. None exist for this data, so no numbers are shown. Not built: {leads.notBuilt.join("; ")}.</span></div>
      <table><thead><tr><th>Question</th><th>Text</th><th>Answer type</th><th>Precision</th><th>Recall</th></tr></thead>
        <tbody>{leads.questions.map((q) => <tr key={q.questionId}><td className="mono">{q.questionId}@{q.version}</td><td className="small">{q.text}</td><td>{q.answerType}</td><td className="dim">no eval set</td><td className="dim">no eval set</td></tr>)}</tbody></table></>);
  }
  return (<>
    <div className="b-tool"><span className="hint">Event types found in this transcript and the role each one was given. Unknown types should map to UNKNOWN and be reviewed by an analyst.</span></div>
    <table><thead><tr><th>Event type</th><th>Records</th><th>Role</th></tr></thead>
      <tbody>{leads.coverage.map((c) => <tr key={c.eventType}><td className="mono">{c.eventType}</td><td>{c.count}</td><td><span className="chip chip-ok">{c.role}</span></td></tr>)}</tbody></table></>);
}
