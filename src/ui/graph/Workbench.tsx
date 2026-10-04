import { useEffect, useMemo, useState } from "react";
import type { Core } from "cytoscape";
import GraphCanvas from "./GraphCanvas";
import Detail from "./Detail";
import Bottom from "./Bottom";
import AgentDock from "../agent/AgentDock";
import { iconSvg, TYPE_LABEL } from "./icons";
import type { NodeType } from "./types";
import { App as ForensicsStudio } from "../App";
import { studio, useStudio, type Layout } from "../studio/store";
import { actions, resolveNode } from "../studio/actions";
import "./workbench.css";

const TYPES: NodeType[] = ["AGENT", "CLAIM", "ATTEMPT", "OBSERVATION", "ARTIFACT", "CORRECTION", "CLUSTER"];
const LAYOUTS: [Layout, string][] = [["preset", "Episode"], ["breadthfirst", "Hierarchical"], ["cose", "Organic"], ["circle", "Circular"], ["grid", "Block"]];
const RIBBON = ["Investigate", "Entities", "Semantic Judge", "View"];

export default function Workbench() {
  const s = useStudio((x) => x);
  const [cy, setCy] = useState<Core | null>(null);
  const [q, setQ] = useState("");
  const [ribbon, setRibbon] = useState("Investigate");
  const [agentOpen, setAgentOpen] = useState(false);

  useEffect(() => { void actions.refreshServer(); }, []);

  const hiddenIds = useMemo(() => new Set(s.nodes.filter((n) => s.hiddenTypes.includes(n.nodeType)).map((n) => n.id)), [s.nodes, s.hiddenTypes]);
  const sel = s.nodes.find((n) => n.id === s.selected) ?? null;
  const counts = (t: NodeType) => s.nodes.filter((n) => n.nodeType === t).length;
  const stats = { sup: s.nodes.filter((n) => (s.overrides[n.id] ?? n.verdict) === "SUPPORTED").length, con: s.nodes.filter((n) => (s.overrides[n.id] ?? n.verdict) === "CONTRADICTED").length, unr: s.nodes.filter((n) => (s.overrides[n.id] ?? n.verdict) === "UNRESOLVED").length };
  const search = (v: string) => { setQ(v); const m = v ? resolveNode(v) : null; if (m) { actions.selectNode(m.id); cy?.animate({ center: { eles: cy.getElementById(m.id) }, duration: 300 }); } };
  const llm = s.status?.llm.configured;

  return (
    <div className="wb">
      <div className="titlebar">
        <div className="brand"><span className="logo"><svg viewBox="0 0 32 32" width="18" height="18"><circle cx="8" cy="9" r="3.5" fill="#fff"/><circle cx="24" cy="9" r="3.5" fill="#fff"/><circle cx="16" cy="24" r="3.5" fill="#fff"/><path d="M8 9l8 15 8-15M8 9h16" stroke="#fff" strokeWidth="1.6" fill="none"/></svg></span>Swarm Evidence Graph</div>
        <div className="mode"><button className={s.view === "graph" ? "on" : ""} onClick={() => actions.switchView("graph")}>Step 1 · Investigation</button><button className={s.view === "forensics" ? "on" : ""} onClick={() => actions.switchView("forensics")}>Step 2 · Forensics Studio</button></div>
        <div className="case">Case · <b>{s.dataset === "mock" ? "June 11 2025 mailing-list incident" : s.dataset}</b> <span className="chip">{s.dataset === "mock" ? "mock data" : "backend fixture"}</span>
          <span className={`chip ${s.status ? "chip-ok" : "chip-bad"}`}>{s.status ? "API online" : "API offline"}</span>
          {s.status && <span className={`chip ${s.status.huggingface.datasetPresent ? "chip-ok" : ""}`}>HF dataset {s.status.huggingface.datasetPresent ? "local" : "missing"}</span>}
        </div>
        <button className={`agent-btn ${agentOpen ? "on" : ""}`} onClick={() => setAgentOpen((v) => !v)}>◆ Agent{llm ? "" : " (offline)"}</button>
        <input className="search" placeholder="Search entities…" value={q} onChange={(e) => search(e.target.value)} />
      </div>

      {s.view === "forensics" ? <div className="forensics-host"><ForensicsStudio /></div> : <>
        <nav className="ribbon-tabs">{RIBBON.map((r) => <button key={r} className={ribbon === r ? "on" : ""} onClick={() => setRibbon(r)}>{r}</button>)}</nav>
        <div className="ribbon">
          <div className="grp"><div className="grp-body">
            <button className="rbtn big" onClick={() => actions.openPanel("leads")}><span className="ri">⌕</span>Run Lead Finder</button>
            <button className="rbtn big" onClick={() => { actions.selectNode(null); actions.fit(); }}><span className="ri">⤢</span>Zoom to Fit</button>
            <button className="rbtn big" onClick={() => actions.writeOfflineReport()}><span className="ri">≣</span>Verbose Report</button>
          </div><div className="grp-name">Investigate</div></div>
          <div className="grp"><div className="grp-body layouts">
            {LAYOUTS.map(([k, l]) => <button key={k} className={`rbtn small ${s.layout === k ? "on" : ""}`} onClick={() => actions.setLayout(k)}>{l}</button>)}
          </div><div className="grp-name">Layout</div></div>
          <div className="grp"><div className="grp-body col">
            <label className="chk"><input type="checkbox" checked={s.showSemantic} onChange={(e) => actions.setOption("showSemantic", e.target.checked)} />Show inferred (semantic) links</label>
            <label className="chk"><input type="checkbox" checked={s.showLater} onChange={(e) => actions.setOption("showLater", e.target.checked)} />Show later evidence</label>
            <label className="chk"><input type="checkbox" checked={s.expanded} onChange={(e) => actions.setOption("expanded", e.target.checked)} />Expand endorsement clusters</label>
          </div><div className="grp-name">Graph Options</div></div>
          <div className="grp"><div className="grp-body col">
            <label className="chk dataset">Episode
              <select value={s.dataset} onChange={(e) => void actions.loadDataset(e.target.value).catch((err) => alert(err.message))}>
                <option value="mock">Mock · June 11 incident</option>
                {s.graphFixtures.map((f) => <option key={f} value={f}>{f}</option>)}
              </select></label>
            <span className="hint">{s.graphFixtures.length ? "Graph built by the backend ledger rule" : "Start the API to load real fixtures"}</span>
          </div><div className="grp-name">Dataset</div></div>
          <div className="grp"><div className="grp-body">
            <div className="kpi k-sup"><b>{stats.sup}</b>Supported</div><div className="kpi k-con"><b>{stats.con}</b>Contradicted</div><div className="kpi k-unr"><b>{stats.unr}</b>Unresolved</div>
          </div><div className="grp-name">Claim Verdicts</div></div>
          <div className="grp"><div className="grp-body col model">
            <div><span className={`dot ${llm ? "" : "off"}`} />Agent · libfx (WASM)</div><code>{s.status?.llm.model ?? "—"}</code><span className="hint">{llm ? "OpenAI key loaded on the server" : "No OPENAI_API_KEY yet"}</span>
          </div><div className="grp-name">Semantic Judge</div></div>
        </div>

        <div className="workspace">
          <aside className="palette">
            <div className="pane-title">Entity Palette</div>
            <div className="pal-group">Evidence entities</div>
            {TYPES.map((t) => (
              <button key={t} className={`pal-item ${s.hiddenTypes.includes(t) ? "off" : ""}`} onClick={() => actions.toggleType(t)} title="Click to show / hide on the graph">
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
            <div className="doc-tabs"><div className="doc-tab on">{s.dataset === "mock" ? "EP-0611-A · Mailing list" : s.dataset}<span>×</span></div></div>
            <div className="canvas-wrap">
              <GraphCanvas key={s.dataset} nodes={s.nodes} edges={s.edges} selected={s.selected} hidden={hiddenIds} showSemantic={s.showSemantic} showLater={s.showLater} layout={s.layout} expanded={s.expanded}
                fitTick={s.fitTick} zoomTick={s.zoomTick} onSelect={(id) => actions.selectNode(id)} onToggleCluster={() => actions.setOption("expanded", !studio.get().expanded)} onReady={setCy} />
              <div className="zoom"><button onClick={() => actions.zoom(1)}>+</button><button onClick={() => actions.zoom(-1)}>−</button><button onClick={() => actions.fit()}>⤢</button></div>
              <div className="statusline">{s.nodes.length} entities · {s.edges.length} links · double-click a cluster to expand</div>
            </div>
          </main>

          <aside className="right">
            <div className="pane-title">Detail View</div>
            <Detail onForensics={() => actions.switchView("forensics")} node={sel} nodes={s.nodes} edges={s.edges} confirmed={new Set(s.confirmed)} overrides={s.overrides} onSelect={(id) => actions.selectNode(id)}
              onConfirm={(id) => actions.confirm(id)} onOverride={(id, v, why) => actions.override(id, v as never, why)} />
          </aside>
        </div>
        <Bottom />
      </>}
      {agentOpen && <AgentDock onClose={() => setAgentOpen(false)} />}
    </div>
  );
}
