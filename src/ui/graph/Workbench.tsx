import { useMemo, useState } from "react";
import type { Core } from "cytoscape";
import GraphCanvas from "./GraphCanvas";
import Detail from "./Detail";
import Bottom from "./Bottom";
import { nodes, edges } from "./mock/data";
import { iconSvg, TYPE_LABEL } from "./icons";
import type { NodeType } from "./types";
import { App as ForensicsStudio } from "../App";
import "./workbench.css";

const TYPES: NodeType[] = ["AGENT", "CLAIM", "ATTEMPT", "OBSERVATION", "ARTIFACT", "CORRECTION", "CLUSTER"];
const LAYOUTS: [string, string][] = [["preset", "Episode"], ["breadthfirst", "Hierarchical"], ["cose", "Organic"], ["circle", "Circular"], ["grid", "Block"]];
const RIBBON = ["Investigate", "Entities", "Semantic Judge", "View"];

export default function Workbench() {
  const [selected, setSelected] = useState<string | null>("claim_1");
  const [hiddenTypes, setHiddenTypes] = useState<Set<NodeType>>(new Set());
  const [semantic, setSemantic] = useState(true);
  const [later, setLater] = useState(true);
  const [layout, setLayout] = useState("preset");
  const [expanded, setExpanded] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [bottomOpen, setBottomOpen] = useState(true);
  const [ribbon, setRibbon] = useState("Investigate");
  const [cy, setCy] = useState<Core | null>(null);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"graph" | "forensics">(location.hash === "#forensics" ? "forensics" : "graph");

  const hidden = useMemo(() => new Set(nodes.filter(n => hiddenTypes.has(n.nodeType)).map(n => n.id)), [hiddenTypes]);
  const sel = nodes.find(n => n.id === selected) ?? null;
  const counts = (t: NodeType) => nodes.filter(n => n.nodeType === t).length;
  const toggleType = (t: NodeType) => setHiddenTypes(s => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });
  const search = (v: string) => { setQ(v); const m = nodes.find(n => v && n.label.toLowerCase().includes(v.toLowerCase())); if (m) { setSelected(m.id); cy?.animate({ center: { eles: cy.getElementById(m.id) }, duration: 300 }); } };
  const stats = { sup: nodes.filter(n => n.verdict === "SUPPORTED").length, con: nodes.filter(n => n.verdict === "CONTRADICTED").length, unr: nodes.filter(n => n.verdict === "UNRESOLVED").length };

  return (
    <div className="wb">
      <div className="titlebar">
        <div className="brand"><span className="logo"><svg viewBox="0 0 32 32" width="18" height="18"><circle cx="8" cy="9" r="3.5" fill="#fff"/><circle cx="24" cy="9" r="3.5" fill="#fff"/><circle cx="16" cy="24" r="3.5" fill="#fff"/><path d="M8 9l8 15 8-15M8 9h16" stroke="#fff" strokeWidth="1.6" fill="none"/></svg></span>Swarm Evidence Graph</div>
        <div className="mode"><button className={mode === "graph" ? "on" : ""} onClick={() => setMode("graph")}>Step 1 · Investigation</button><button className={mode === "forensics" ? "on" : ""} onClick={() => setMode("forensics")}>Step 2 · Forensics Studio</button></div>
        <div className="case">Case · <b>June 11 2025 mailing-list incident</b> <span className="chip">mock data</span></div>
        <input className="search" placeholder="Search entities…" value={q} onChange={e => search(e.target.value)} />
      </div>

      {mode === "forensics" ? <div className="forensics-host"><ForensicsStudio /></div> : <>
      <nav className="ribbon-tabs">{RIBBON.map(r => <button key={r} className={ribbon === r ? "on" : ""} onClick={() => setRibbon(r)}>{r}</button>)}</nav>
      <div className="ribbon">
        <div className="grp"><div className="grp-body">
          <button className="rbtn big" onClick={() => setBottomOpen(true)}><span className="ri">⌕</span>Run Lead Finder</button>
          <button className="rbtn big" onClick={() => { setSelected(null); cy?.fit(undefined, 50); }}><span className="ri">⤢</span>Zoom to Fit</button>
        </div><div className="grp-name">Investigate</div></div>
        <div className="grp"><div className="grp-body layouts">
          {LAYOUTS.map(([k, l]) => <button key={k} className={`rbtn small ${layout === k ? "on" : ""}`} onClick={() => setLayout(k)}>{l}</button>)}
        </div><div className="grp-name">Layout</div></div>
        <div className="grp"><div className="grp-body col">
          <label className="chk"><input type="checkbox" checked={semantic} onChange={e => setSemantic(e.target.checked)} />Show inferred (semantic) links</label>
          <label className="chk"><input type="checkbox" checked={later} onChange={e => setLater(e.target.checked)} />Show later evidence</label>
          <label className="chk"><input type="checkbox" checked={expanded} onChange={e => setExpanded(e.target.checked)} />Expand endorsement clusters</label>
        </div><div className="grp-name">Graph Options</div></div>
        <div className="grp"><div className="grp-body">
          <div className="kpi k-sup"><b>{stats.sup}</b>Supported</div><div className="kpi k-con"><b>{stats.con}</b>Contradicted</div><div className="kpi k-unr"><b>{stats.unr}</b>Unresolved</div>
        </div><div className="grp-name">Claim Verdicts</div></div>
        <div className="grp"><div className="grp-body col model">
          <div><span className="dot" />Judge · local Ollama</div><code>qwen2.5:14b-instruct-q4_K_M</code><span className="hint">External API: off (opt-in only)</span>
        </div><div className="grp-name">Semantic Judge</div></div>
      </div>

      <div className="workspace">
        <aside className="palette">
          <div className="pane-title">Entity Palette</div>
          <div className="pal-group">Evidence entities</div>
          {TYPES.map(t => (
            <button key={t} className={`pal-item ${hiddenTypes.has(t) ? "off" : ""}`} onClick={() => toggleType(t)} title="Click to show / hide on the graph">
              <span dangerouslySetInnerHTML={{ __html: iconSvg(t, undefined, 22) }} /><span>{TYPE_LABEL[t]}</span><em>{counts(t)}</em>
            </button>))}
          <div className="pal-group">Link basis</div>
          <div className="legend-row"><svg width="34" height="8"><line x1="0" y1="4" x2="34" y2="4" stroke="#6a7683" strokeWidth="2"/></svg>Explicit link</div>
          <div className="legend-row"><svg width="34" height="8"><line x1="0" y1="4" x2="34" y2="4" stroke="#6a7683" strokeWidth="2" strokeDasharray="1 3"/></svg>Identifier match</div>
          <div className="legend-row"><svg width="34" height="8"><line x1="0" y1="4" x2="34" y2="4" stroke="#b8860b" strokeWidth="2" strokeDasharray="5 3"/></svg>Semantic (inferred)</div>
          <div className="pal-group">Verdict ring</div>
          <div className="legend-row"><i className="sw" style={{ background: "#1f9d55" }} />Supported</div>
          <div className="legend-row"><i className="sw" style={{ background: "#d03a2f" }} />Contradicted</div>
          <div className="legend-row"><i className="sw" style={{ background: "#d99a1d" }} />Unresolved</div>
          <div className="legend-row"><i className="sw glow" />Model-assisted</div>
        </aside>

        <main className="center">
          <div className="doc-tabs"><div className="doc-tab on">EP-0611-A · Mailing list<span>×</span></div><div className="doc-tab">EP-0611-B · Sponsor sheet (control)</div><div className="doc-tab plus">+</div></div>
          <div className="canvas-wrap">
            <GraphCanvas nodes={nodes} edges={edges} selected={selected} hidden={hidden} showSemantic={semantic} showLater={later} layout={layout} expanded={expanded}
              onSelect={setSelected} onToggleCluster={() => setExpanded(v => !v)} onReady={setCy} />
            <div className="zoom">
              <button onClick={() => cy?.zoom({ level: cy.zoom() * 1.25, renderedPosition: { x: 300, y: 200 } })}>+</button>
              <button onClick={() => cy?.zoom({ level: cy.zoom() / 1.25, renderedPosition: { x: 300, y: 200 } })}>−</button>
              <button onClick={() => cy?.fit(undefined, 50)}>⤢</button>
            </div>
            <div className="statusline">{nodes.length - 3} entities · {edges.length} links · {" "}double-click a cluster to expand</div>
          </div>
        </main>

        <aside className="right">
          <div className="pane-title">Detail View</div>
          <Detail onForensics={() => setMode("forensics")} node={sel} nodes={nodes} edges={edges} confirmed={confirmed} overrides={overrides} onSelect={setSelected}
            onConfirm={id => setConfirmed(s => new Set(s).add(id))} onOverride={(id, v) => setOverrides(o => ({ ...o, [id]: v }))} />
        </aside>
      </div>

      <Bottom nodes={nodes} confirmed={confirmed} onSelect={setSelected} open={bottomOpen} setOpen={setBottomOpen} />
      </>}
    </div>
  );
}
