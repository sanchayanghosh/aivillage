import { useState } from "react";
import type { GNode, GEdge } from "./types";
import { iconSvg, TYPE_LABEL } from "./icons";

const pct = (p: number) => Math.round(p * 100) + "%";

export default function Detail({ onForensics, node, nodes, edges, confirmed, overrides, onConfirm, onOverride, onSelect }: {
  onForensics: () => void; node: GNode | null; nodes: GNode[]; edges: GEdge[]; confirmed: Set<string>; overrides: Record<string, string>;
  onConfirm: (id: string) => void; onOverride: (id: string, v: string, why: string) => void; onSelect: (id: string) => void;
}) {
  const [why, setWhy] = useState("");
  if (!node) return (
    <div className="empty"><div className="empty-ring">◎</div><p>Select an entity on the graph to inspect its evidence, judgments and verdict basis.</p><p className="hint">Double-click an Endorsement Cluster to expand it.</p></div>
  );
  const links = edges.filter(e => e.source === node.id || e.target === node.id);
  const other = (e: GEdge) => nodes.find(n => n.id === (e.source === node.id ? e.target : e.source))!;
  const isConf = confirmed.has(node.id);
  const decisiveEdge = edges.find((e) => e.source === node.id && (e.edgeType === "CONTRADICTED_BY" || e.edgeType === "SUPPORTED_BY"));
  const obsBefore = node.nodeType === "CLAIM" && node.time ? nodes.filter((n) => n.nodeType === "OBSERVATION" && n.time && n.time <= node.time!) : [];
  const later = node.nodeType === "CLAIM" ? nodes.filter((n) => n.laterEvidence && (n.time ?? "") > (node.time ?? "")) : [];
  const latest = (decisiveEdge && nodes.find((n) => n.id === decisiveEdge.target)) || (obsBefore.length ? obsBefore.reduce((a, b) => (a.time! > b.time! ? a : b)) : null);
  const ov = overrides[node.id];

  return (
    <div className="detail">
      <header className="d-head">
        <span className="d-icon" dangerouslySetInnerHTML={{ __html: iconSvg(node.nodeType, undefined, 34) }} />
        <div><div className="d-type">{TYPE_LABEL[node.nodeType]}</div><h3>{node.label}</h3></div>
      </header>

      {node.verdict && (
        <div className={`verdict v-${node.verdict.toLowerCase()}`}>
          <b>{ov ? `${ov} (override)` : node.verdict}</b>
          {node.modelAssisted && !isConf && <span className="chip chip-warn">MODEL_ASSISTED</span>}
          {node.modelAssisted && isConf && <span className="chip chip-ok">ANALYST CONFIRMED</span>}
        </div>
      )}
      <p className="preview">{node.previewText}</p>

      {node.nodeType === "CLAIM" && (
        <section>
          <h4>Verdict rule · latest relevant observation before claim</h4>
          <ol className="timeline">
            {obsBefore.sort((a, b) => a.time!.localeCompare(b.time!)).map(o => (
              <li key={o.id} className={o === latest ? "decisive" : "ctx"} onClick={() => onSelect(o.id)}>
                <time>{o.time}</time><span>{o.label}</span><em>{o === latest ? "decides verdict" : "earlier · context"}</em>
              </li>))}
            <li className="claim-mark"><time>{node.time}</time><span>Claim made</span></li>
            {later.map(o => <li key={o.id} className="later" onClick={() => onSelect(o.id)}><time>{o.time}</time><span>{o.label}</span><em>later evidence · does not change verdict</em></li>)}
          </ol>
        </section>
      )}

      {node.props && Object.keys(node.props).length > 0 && (
        <section><h4>Properties</h4>
          <dl className="props">{Object.entries(node.props).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            <div><dt>Source record</dt><dd className="mono">{node.sourceRecordId}</dd></div></dl></section>)}

      {node.judgments && node.judgments.length > 0 && (
        <section><h4>Semantic judgments <span className="count">{node.judgments.length}</span></h4>
          {node.judgments.map(j => (
            <div className="judg" key={j.id}>
              <div className="j-top"><code>{j.questionId}@{j.questionVersion}</code><span className={`chip ${j.cached ? "chip-cache" : "chip-live"}`}>{j.cached ? "cache hit" : "fresh"}</span></div>
              <div className="j-bar"><i style={{ width: pct(j.probability) }} /></div>
              <div className="j-meta"><span>answer <b>{j.answer}</b></span><span>p = {j.probability.toFixed(2)}</span></div>
              <div className="j-meta mono"><span>{j.model}</span><span>{j.inputRecordIds.join(", ")}</span></div>
              <div className="j-meta mono"><span>{j.id}</span><span>{j.inputHash}</span></div>
            </div>))}
          <p className="note">A model answer is a classifier output. It never sets a verdict by itself.</p>
        </section>)}

      {node.verdict === "CONTRADICTED" && <section><h4>Step 2</h4><button className="btn primary" onClick={onForensics}>Open episode in Forensics Studio →</button><p className="note">Concerning event. Forensics always produces at least two competing explanations, including benign ones.</p></section>}

      <section><h4>Links <span className="count">{links.length}</span></h4>
        <ul className="links">{links.map(e => { const o = other(e); return (
          <li key={e.id} onClick={() => onSelect(o.id)}>
            <span className={`basis b-${e.basis.toLowerCase()}`} title={e.basis}>{e.basis === "EXPLICIT_LINK" ? "━" : e.basis === "IDENTIFIER_MATCH" ? "┅" : "╌"}</span>
            <span className="l-type">{e.edgeType.replaceAll("_", " ")}</span><span className="l-name">{o.label}</span>
            {e.basis === "SEMANTIC_LINK" && <span className="chip chip-warn">inferred</span>}
          </li>); })}</ul></section>

      {node.verdict && (
        <section><h4>Analyst actions</h4>
          {node.modelAssisted && !isConf && <button className="btn primary" onClick={() => onConfirm(node.id)}>Confirm model-assisted inputs</button>}
          <label className="ov">Override verdict · justification (≥10 chars)
            <textarea value={why} onChange={e => setWhy(e.target.value)} rows={2} placeholder="Why does the evidence justify a different verdict?" /></label>
          <div className="row">
            {(["SUPPORTED", "UNRESOLVED", "CONTRADICTED"] as const).filter(v => v !== node.verdict).map(v =>
              <button key={v} className="btn" disabled={why.trim().length < 10} onClick={() => { onOverride(node.id, v, why); setWhy(""); }}>→ {v}</button>)}
          </div>
        </section>)}
    </div>
  );
}
