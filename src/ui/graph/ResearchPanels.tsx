import { useEffect, useRef, useState } from "react";
import { useStudio } from "../studio/store";
import { actions } from "../studio/actions";
import { apiFetch } from "../studio/keys";

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toFixed(2));
const needsRun = (leads: unknown, loading: boolean) => !leads && !loading;

export function EpisodesPanel() {
  const { leads, episodeFilter, leadsLoading, dataset } = useStudio((s) => s);
  if (dataset === "mock" || dataset === "none") return <div className="b-tool"><span className="hint">Episode bounding runs on a transcript you load. Import one, then run the Lead Finder.</span></div>;
  if (!leads) return <div className="b-tool"><button className="btn primary" style={{ width: "auto", margin: 0 }} disabled={leadsLoading} onClick={() => void actions.runLeadFinder()}>{leadsLoading ? "Working…" : "Run Lead Finder and bound episodes"}</button><span className="hint">Episodes are built around the leads.</span></div>;
  return (<>
    <div className="b-tool"><span className="hint">Records join an episode by a recorded reference, a shared identifier, or a model-inferred link (Q_SAME_TASK, shown separately). Click a row to filter the graph.</span>
      {episodeFilter && <button className="btn" onClick={() => actions.setEpisodeFilter(null)}>Show all</button>}</div>
    <table><thead><tr><th>Episode</th><th>Records</th><th>Agents</th><th>Links</th><th>Why these records</th></tr></thead>
      <tbody>{leads.episodes.map((e) => (
        <tr key={e.episodeId} className={`click ${episodeFilter === e.episodeId ? "sel" : ""}`} onClick={() => actions.setEpisodeFilter(episodeFilter === e.episodeId ? null : e.episodeId)}>
          <td className="mono"><b>{e.episodeId}</b></td><td>{e.recordIds.length}</td><td className="small">{e.agents.join(", ")}</td>
          <td className="small"><span className="chip">{e.basisCounts.EXPLICIT_LINK} recorded</span><span className="chip">{e.basisCounts.IDENTIFIER_MATCH} identifier</span><span className="chip chip-warn">{e.basisCounts.SEMANTIC_LINK} inferred</span></td>
          <td className="small">{e.justification}</td></tr>))}
        {!leads.episodes.length && <tr><td colSpan={5} className="small">No lead passed the threshold, so there is nothing to bound.</td></tr>}</tbody></table></>);
}

export function QueuePanel() {
  const { leads, leadsLoading, dataset } = useStudio((s) => s);
  if (dataset === "mock" || dataset === "none") return <div className="b-tool"><span className="hint">The investigation queue ranks the episodes of a transcript you load.</span></div>;
  if (needsRun(leads, leadsLoading) || !leads) return <div className="b-tool"><button className="btn primary" style={{ width: "auto", margin: 0 }} disabled={leadsLoading} onClick={() => void actions.runLeadFinder()}>Run Lead Finder and rank the queue</button></div>;
  const q = leads.queue;
  return (<>
    <div className="b-tool"><span className="hint">Goal used: “{q.goal.slice(0, 120)}”. Equal weights. {q.method.relevance}. {q.method.diversity}. Suspicion and utility are kept apart. At least 20% of the list is ordinary control cases.</span></div>
    <table><thead><tr><th>#</th><th>Episode</th><th>Relevance</th><th>Traceability</th><th>Consequence</th><th>Uncertainty</th><th>Diversity</th><th>Suspicion</th><th>Utility</th><th>Notes</th></tr></thead>
      <tbody>{q.shortlist.map((r) => (
        <tr key={r.episodeId} className="click" onClick={() => actions.setEpisodeFilter(r.episodeId)}>
          <td>{r.rank}</td><td className="mono"><b>{r.episodeId}</b>{r.isControl && <span className="chip chip-ok">control</span>}</td>
          <td>{pct(r.scores.relevance)}</td><td>{pct(r.scores.traceability)}</td><td>{pct(r.scores.consequence)}</td><td>{pct(r.scores.uncertainty)}</td><td>{pct(r.scores.diversity)}</td>
          <td><b>{pct(r.suspicion)}</b></td><td>{pct(r.utility)}</td><td className="small">{r.notes.join("; ") || r.summary}</td></tr>))}</tbody></table></>);
}

const EVAL_QUESTIONS = [
  ["Q_CLAIMS_COMPLETION", "Does this message state that a task or action is finished?"],
  ["Q_ACTION_FAILED", "Did this action fail or return no useful result?"],
  ["Q_REPORTS_PROBLEM", "Does this message say an earlier result was wrong, failed, or must stop?"],
] as const;

interface Row { inputHash: string; text: string }
interface Label { inputHash: string; text: string; label: boolean; source: string }
interface Metrics { status: string; labels: number; positives: number; tp: number; fp: number; fn: number; tn: number; precision: number | null; recall: number | null; model: string; regression: boolean; baseline: { precision: number; recall: number } | null; threshold: number }

/** Measured detection: blind labelling of 30 to 50 rows, then precision and recall against the judge. */
export function EvalPanel() {
  const { dataset, imported } = useStudio((s) => s);
  const [q, setQ] = useState<(typeof EVAL_QUESTIONS)[number][0]>("Q_CLAIMS_COMPLETION");
  const [rows, setRows] = useState<Row[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [manual, setManual] = useState("");
  const [thr, setThr] = useState(0.5);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const min = 30, max = 50;
  const loadedFor = useRef("");

  const source = dataset.startsWith("upload:") ? { transcript: imported?.jsonl } : dataset !== "none" && dataset !== "mock" ? { fixture: dataset } : null;
  const post = async (path: string, body: unknown) => {
    const res = await apiFetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json(); if (!res.ok) throw new Error(d.error ?? `${res.status}`); return d;
  };
  const refresh = async () => { const d = await apiFetch(`/api/eval/labels?question=${q}`).then((r) => r.json()); setLabels(d.labels); };
  useEffect(() => { setRows([]); setMetrics(null); setErr(null); void refresh().catch(() => setErr("Evaluation needs the API. Start it or check the connection.")); }, [q]);
  useEffect(() => { if (source && loadedFor.current !== `${q}|${dataset}`) { loadedFor.current = `${q}|${dataset}`; void post("/api/eval/sample", { question: q, ...source }).then((d) => setRows(d.rows)).catch(() => undefined); } }, [q, dataset, labels.length === 0]);

  const current = rows[0];
  const answer = async (label: boolean) => { if (!current) return; setBusy(true); try { await post("/api/eval/label", { question: q, inputHash: current.inputHash, text: current.text, label }); setRows((r) => r.slice(1)); await refresh(); } catch (e) { setErr(String(e instanceof Error ? e.message : e)); } finally { setBusy(false); } };
  const addManual = async (label: boolean) => { try { await post("/api/eval/manual", { question: q, text: manual, label }); setManual(""); await refresh(); } catch (e) { setErr(String(e instanceof Error ? e.message : e)); } };
  const remove = async (h: string) => { await apiFetch("/api/eval/label", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, inputHash: h }) }); await refresh(); };
  const measure = async (setBaseline = false) => { setBusy(true); setErr(null); try { setMetrics(await post("/api/eval/metrics", { question: q, threshold: thr, setBaseline })); } catch (e) { setErr(String(e instanceof Error ? e.message : e)); } finally { setBusy(false); } };

  return (
    <div className="evalp">
      <div className="b-tool">
        <label>Question <select value={q} onChange={(e) => setQ(e.target.value as typeof q)}>{EVAL_QUESTIONS.map(([id]) => <option key={id} value={id}>{id}</option>)}</select></label>
        <span className="hint">{EVAL_QUESTIONS.find(([id]) => id === q)![1]}</span>
        <span className={`chip ${labels.length >= min ? "chip-ok" : "chip-warn"}`}>{labels.length} / {min}–{max} labelled</span>
        <a className="link" href={`/api/eval/export?question=${q}`} download>Export JSONL</a>
      </div>
      {err && <div className="b-tool"><span className="chip chip-bad">{err}</span></div>}
      <div className="evalgrid">
        <section>
          <h4>1. Label rows blind</h4>
          {!source && <p className="hint">Load or import a transcript to draw rows from it, or add rows by hand on the right.</p>}
          {source && current && (<>
            <p className="hint">The row passed the structural pre-filter for this question. The model’s answer is hidden until you press Measure. Answer as a careful reader would.</p>
            <blockquote className="row-text">{current.text}</blockquote>
            <div className="row">
              <button className="btn primary" style={{ width: "auto", margin: 0 }} disabled={busy} onClick={() => void answer(true)}>Yes</button>
              <button className="btn" disabled={busy} onClick={() => void answer(false)}>No</button>
              <button className="btn" disabled={busy} onClick={() => setRows((r) => r.slice(1))}>Skip</button>
              <span className="hint">{rows.length} rows left in this sample</span>
            </div></>)}
          {source && !current && <p className="hint">No unlabelled rows left for this question in this transcript. Import more data or add rows manually.</p>}
          <h4 style={{ marginTop: 14 }}>Add a row by hand</h4>
          <textarea rows={2} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Paste or write an example, then say what the right answer is." />
          <div className="row"><button className="btn" disabled={manual.trim().length < 4 || labels.length >= max} onClick={() => void addManual(true)}>Add as Yes</button><button className="btn" disabled={manual.trim().length < 4 || labels.length >= max} onClick={() => void addManual(false)}>Add as No</button></div>
        </section>
        <section>
          <h4>2. Measure</h4>
          <div className="row"><label>Threshold <input type="number" min={0} max={1} step={0.05} value={thr} onChange={(e) => setThr(+e.target.value)} style={{ width: 64 }} /></label>
            <button className="btn primary" style={{ width: "auto", margin: 0 }} disabled={busy || labels.length < 1} onClick={() => void measure()}>{busy ? "Asking the judge…" : "Measure precision and recall"}</button></div>
          {labels.length < min && <p className="hint">Needs at least {min} labelled rows for numbers you can trust. Below that the result is shown as a draft.</p>}
          {metrics && (<div className={`metrics ${metrics.status}`}>
            <div className="mrow"><div><b>{pct(metrics.precision)}</b><span>precision</span></div><div><b>{pct(metrics.recall)}</b><span>recall</span></div><div><b>{metrics.labels}</b><span>labels</span></div></div>
            <p className="small">TP {metrics.tp} · FP {metrics.fp} · FN {metrics.fn} · TN {metrics.tn} · judge {metrics.model} · threshold {metrics.threshold}</p>
            {metrics.status === "need_more_labels" && <p className="warnline">Draft only: fewer than {min} labels.</p>}
            {metrics.baseline && <p className="small">Stored baseline: precision {pct(metrics.baseline.precision)}, recall {pct(metrics.baseline.recall)}. {metrics.regression ? <span className="chip chip-bad">dropped more than 10 points</span> : <span className="chip chip-ok">within 10 points</span>}</p>}
            {metrics.status === "measured" && <button className="btn" onClick={() => void measure(true)}>Save as baseline</button>}
          </div>)}
          <h4 style={{ marginTop: 14 }}>Labelled rows</h4>
          <div className="lablist">{labels.map((l) => <div key={l.inputHash} className="lab"><span className={`chip ${l.label ? "chip-ok" : "chip-bad"}`}>{l.label ? "yes" : "no"}</span><span className="small">{l.text.slice(0, 120)}</span><i className="small dim">{l.source}</i><button className="link" onClick={() => void remove(l.inputHash)}>remove</button></div>)}</div>
        </section>
      </div>
    </div>
  );
}

export function AuditPanel() {
  const [data, setData] = useState<{ findings: Array<{ id: number; claimText: string; originalVerdict: string; overrideVerdict: string; justification: string; createdAt: string }>; rules: Array<{ route: number; sql_text: string; question_ids: string; thresholds: string; created_at: string }>; classifierOutputs: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const overrides = useStudio((s) => s.overrides);
  useEffect(() => { apiFetch("/api/audit").then((r) => r.json()).then(setData).catch(() => setErr("The audit store needs the API.")); }, [overrides]);
  if (err) return <div className="b-tool"><span className="chip chip-bad">{err}</span></div>;
  if (!data) return <div className="b-tool"><span className="hint">Loading…</span></div>;
  return (<>
    <div className="b-tool"><span className="hint">Three partitions, stored in SQLite on the server: <b>discovery rules</b> ({data.rules.length}), <b>classifier outputs</b> ({data.classifierOutputs}, also the judge’s cache) and <b>verified findings</b> ({data.findings.length}). On Render’s free plan the disk is ephemeral, so this resets on restart.</span></div>
    <table><thead><tr><th>Finding</th><th>Claim</th><th>Change</th><th>Justification</th><th>When</th></tr></thead>
      <tbody>{data.findings.map((f) => <tr key={f.id}><td className="mono">F-{f.id}</td><td className="small">{f.claimText}</td><td><span className="chip">{f.originalVerdict || "?"}</span> → <span className="chip chip-warn">{f.overrideVerdict}</span></td><td className="small">{f.justification}</td><td className="mono small">{f.createdAt}</td></tr>)}
        {!data.findings.length && <tr><td colSpan={5} className="small">No analyst overrides yet. Overrides need a justification of at least 10 characters.</td></tr>}</tbody></table>
    <table><thead><tr><th>Route</th><th>Pre-filter</th><th>Questions</th><th>Thresholds</th><th>When</th></tr></thead>
      <tbody>{data.rules.slice(0, 12).map((r, i) => <tr key={i}><td>R{r.route}</td><td className="mono small">{r.sql_text}</td><td className="mono small">{r.question_ids}</td><td className="mono small">{r.thresholds}</td><td className="mono small">{r.created_at}</td></tr>)}</tbody></table></>);
}
