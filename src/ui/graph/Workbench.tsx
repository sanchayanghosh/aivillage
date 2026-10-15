import { useEffect, useMemo, useState } from "react";
import type { Core } from "cytoscape";
import GraphCanvas from "./GraphCanvas";
import Detail from "./Detail";
import Bottom from "./Bottom";
import AgentDock from "../agent/AgentDock";
import ImportDialog from "./ImportDialog";
import SettingsDialog from "./SettingsDialog";
import { iconSvg, TYPE_LABEL } from "./icons";
import type { NodeType } from "./types";
import { App as ForensicsStudio } from "../App";
import { studio, useStudio, type Layout } from "../studio/store";
import { actions, resolveNode } from "../studio/actions";
import "./workbench.css";

const TYPES: NodeType[] = ["AGENT", "CLAIM", "ATTEMPT", "OBSERVATION", "ARTIFACT", "CORRECTION", "CLUSTER"];
const LAYOUTS: [Layout, string][] = [["preset", "Episode"], ["breadthfirst", "Hierarchical"], ["cose", "Organic"], ["circle", "Circular"], ["grid", "Block"]];
const RIBBON = ["Investigate", "Causal Forensics", "Entities", "Semantic Judge", "View"];

export default function Workbench() {
  const s = useStudio((x) => x);
  const [cy, setCy] = useState<Core | null>(null);
  const [q, setQ] = useState("");
  const [ribbon, setRibbon] = useState("Investigate");
  const [agentOpen, setAgentOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void actions.refreshServer();
    if (studio.get().dataset === "none") {
      void actions.loadDataset("mock");
    }
  }, []);

  // When switching views, align the active ribbon tab with the current phase
  useEffect(() => {
    if (s.view === "forensics" && ribbon === "Investigate") {
      setRibbon("Causal Forensics");
    } else if (s.view === "graph" && ribbon === "Causal Forensics") {
      setRibbon("Investigate");
    }
  }, [s.view]);

  const hiddenIds = useMemo(() => {
    const ep = s.leads?.episodes.find((e) => e.episodeId === s.episodeFilter);
    const inEp = ep ? new Set(ep.recordIds) : null;
    return new Set(s.nodes.filter((n) => s.hiddenTypes.includes(n.nodeType) || (inEp && n.nodeType !== "AGENT" && !inEp.has(n.sourceRecordId))).map((n) => n.id));
  }, [s.nodes, s.hiddenTypes, s.episodeFilter, s.leads]);
  const sel = s.nodes.find((n) => n.id === s.selected) ?? null;
  const counts = (t: NodeType) => s.nodes.filter((n) => n.nodeType === t).length;
  const stats = { sup: s.nodes.filter((n) => (s.overrides[n.id] ?? n.verdict) === "SUPPORTED").length, con: s.nodes.filter((n) => (s.overrides[n.id] ?? n.verdict) === "CONTRADICTED").length, unr: s.nodes.filter((n) => (s.overrides[n.id] ?? n.verdict) === "UNRESOLVED").length };
  const search = (v: string) => { setQ(v); const m = v ? resolveNode(v) : null; if (m) { actions.selectNode(m.id); cy?.animate({ center: { eles: cy.getElementById(m.id) }, duration: 300 }); } };
  const llm = s.status?.llm.configured;

  return (
    <div className="wb">
      <div className="titlebar">
        <a className="brand" href="/" title="Back to the landing page"><span className="logo"><svg viewBox="0 0 32 32" width="18" height="18"><circle cx="8" cy="9" r="3.5" fill="#fff"/><circle cx="24" cy="9" r="3.5" fill="#fff"/><circle cx="16" cy="24" r="3.5" fill="#fff"/><path d="M8 9l8 15 8-15M8 9h16" stroke="#fff" strokeWidth="1.6" fill="none"/></svg></span>Swarm Evidence Graph</a>
        <div className="mode">
          <button
            className={s.view === "graph" ? "on" : ""}
            onClick={() => actions.switchView("graph")}
            title="Step 1: Evidence Graph & Ledger Audit"
          >
            Step 1 · Graph
          </button>
          <button
            className={s.view === "split" ? "on" : ""}
            onClick={() => actions.investigateInForensics(sel?.id, true)}
            title="Unified Split Investigation: Graph and Forensics side-by-side"
          >
            ◫ Split (1 + 2)
          </button>
          <button
            className={s.view === "forensics" ? "on" : ""}
            onClick={() => actions.investigateInForensics(sel?.id, false)}
            title="Step 2: Causal Forensics Deep-Dive"
          >
            Step 2 · Forensics Studio {stats.con > 0 && <span className="chip chip-bad" style={{ marginLeft: 4, verticalAlign: "middle" }}>{stats.con} {stats.con === 1 ? "anomaly" : "anomalies"}</span>}
          </button>
        </div>
        <div className="case">Case · <b>{s.dataset === "none" ? "no transcript loaded" : s.dataset === "mock" ? "June 11 2025 mailing-list incident" : s.dataset}</b> <span className="chip">{s.dataset === "none" ? "empty" : s.dataset === "mock" ? "sample" : s.dataset.startsWith("upload:") ? "imported" : "backend fixture"}</span>
          <span className={`chip ${s.status ? "chip-ok" : "chip-bad"}`}>{s.status ? "API online" : "API offline"}</span>
          {s.status && <span className={`chip ${s.status.huggingface.datasetPresent ? "chip-ok" : ""}`}>HF dataset {s.status.huggingface.datasetPresent ? "local" : "missing"}</span>}
        </div>
        <button className="agent-btn" onClick={() => setSettingsOpen(true)} title="Use your own API keys">Keys</button>
        <button className={`agent-btn ${agentOpen ? "on" : ""}`} onClick={() => setAgentOpen((v) => !v)}>◆ Agent{llm ? "" : " (offline)"}</button>
        <input className="search" placeholder="Search entities…" value={q} onChange={(e) => search(e.target.value)} />
      </div>

      <nav className="ribbon-tabs">{RIBBON.map((r) => <button key={r} className={ribbon === r ? "on" : ""} onClick={() => setRibbon(r)}>{r}</button>)}</nav>

      {ribbon === "Causal Forensics" ? (
        <div className="ribbon">
          <div className="grp"><div className="grp-body">
            <button
              className="rbtn big"
              onClick={() => {
                if (s.view === "graph") actions.switchView("split");
                void actions.runForensics().catch(() => {});
              }}
              title="Run causal motive reconstruction and latent payoff estimation"
            >
              <span className="ri">🔬</span>Run Forensics
            </button>
            <button
              className="rbtn big"
              onClick={() => actions.investigateInForensics(sel?.id, true)}
              title="Open unified side-by-side split view"
            >
              <span className="ri">◫</span>Split Layout
            </button>
            <button
              className="rbtn big"
              onClick={() => actions.investigateInForensics(sel?.id, false)}
              title="Full screen forensics deep-dive"
            >
              <span className="ri">🗖</span>Forensics Only
            </button>
          </div><div className="grp-name">Forensics Execution</div></div>

          <div className="grp"><div className="grp-body col">
            <div style={{ display: "flex", gap: 6 }}>
              <button className={`rbtn small ${s.view === "graph" ? "on" : ""}`} onClick={() => actions.switchView("graph")}>⊞ Graph</button>
              <button className={`rbtn small ${s.view === "split" ? "on" : ""}`} onClick={() => actions.investigateInForensics(sel?.id, true)}>◫ Split</button>
              <button className={`rbtn small ${s.view === "forensics" ? "on" : ""}`} onClick={() => actions.investigateInForensics(sel?.id, false)}>🔬 Forensics</button>
            </div>
            <span className="hint">Unified two-step investigation</span>
          </div><div className="grp-name">Workbench Layout</div></div>

          <div className="grp"><div className="grp-body">
            <div className="kpi k-con"><b>{stats.con}</b>Contradicted</div>
            <div className="kpi k-unr"><b>{stats.unr}</b>Unresolved</div>
          </div><div className="grp-name">Targeted Anomalies</div></div>

          <div className="grp"><div className="grp-body col model">
            <div><span className="dot" />Engine: Python AST & Replay</div>
            <code>{s.status?.llm.model ?? "Direct Python Engine"}</code>
            <span className="hint">Pearl Layer 3 Counterfactual Verification</span>
          </div><div className="grp-name">Causal Engine</div></div>
        </div>
      ) : (
        <div className="ribbon">
          <div className="grp"><div className="grp-body">
            <button className="rbtn big" onClick={() => actions.openImport(true)}><span className="ri">⇪</span>Import Transcript</button>
            <button className="rbtn big" onClick={() => void actions.runLeadFinder()}><span className="ri">⌕</span>Run Lead Finder</button>
            <button className="rbtn big" onClick={() => { actions.selectNode(null); actions.fit(); }}><span className="ri">⤢</span>Zoom to Fit</button>
            <button className="rbtn big" onClick={() => actions.writeOfflineReport()}><span className="ri">≣</span>Verbose Report</button>
            <button
              className="rbtn big"
              onClick={() => actions.investigateInForensics(sel?.id, true)}
              title="Continue directly to Step 2 Causal Forensics"
            >
              <span className="ri">🔬</span>Step 2 Forensics
            </button>
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
              <select value={s.dataset} onChange={(e) => !e.target.value.startsWith("upload:") && void actions.loadDataset(e.target.value).catch((err) => alert(err.message))}>
                <option value="none">— none —</option>
                <option value="mock">Sample · June 11 incident</option>
                {s.dataset.startsWith("upload:") && <option value={s.dataset}>{s.dataset.slice(7)} (imported)</option>}
                {s.graphFixtures.map((f) => <option key={f} value={f}>{f}</option>)}
              </select></label>
            <span className="hint">{s.graphFixtures.length ? "Graph built by the backend ledger rule" : "Start the API to load real fixtures"}</span>
          </div><div className="grp-name">Dataset</div></div>
          <div className="grp"><div className="grp-body">
            <div className="kpi k-sup"><b>{stats.sup}</b>Supported</div><div className="kpi k-con"><b>{stats.con}</b>Contradicted</div><div className="kpi k-unr"><b>{stats.unr}</b>Unresolved</div>
          </div><div className="grp-name">Claim Verdicts</div></div>
          <div className="grp"><div className="grp-body col model">
            <div><span className={`dot ${llm ? "" : "off"}`} />Agent · libfx (WASM) · OpenAI</div><code>{s.status?.llm.model ?? "—"}</code><span className="hint">Judge: {s.status?.judge.provider === "jev" ? `Jev (${s.status.judge.model})` : s.status?.judge.provider === "openai" ? "OpenAI fallback (add a Jev key)" : "none"}</span>
          </div><div className="grp-name">Semantic Judge</div></div>
        </div>
      )}

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

          {stats.con > 0 && (
            <div className="pal-forensics-box">
              <div className="pal-forensics-title">🚨 Step 2 Continuation</div>
              <div className="pal-forensics-desc">
                {stats.con} contradicted claim{stats.con === 1 ? "" : "s"} flagged for causal deep-dive
              </div>
              <button
                className="pal-forensics-btn"
                onClick={() => actions.investigateInForensics(sel?.id, true)}
              >
                ◫ Open Split View
              </button>
            </div>
          )}
        </aside>

        <main className="center">
          <div className="doc-tabs">
            <button
              className={`doc-tab ${s.view === "graph" ? "on" : ""}`}
              onClick={() => actions.switchView("graph")}
            >
              ⊞ Step 1 · Evidence Graph {s.dataset === "mock" ? "· EP-0611-A" : s.dataset !== "none" ? `· ${s.dataset.replace(/^upload:/, "")}` : ""}
            </button>
            <button
              className={`doc-tab ${s.view === "split" ? "on" : ""}`}
              onClick={() => actions.investigateInForensics(sel?.id, true)}
            >
              ◫ Step 1 + 2 · Split Investigation
            </button>
            <button
              className={`doc-tab ${s.view === "forensics" ? "on" : ""}`}
              onClick={() => actions.investigateInForensics(sel?.id, false)}
            >
              🔬 Step 2 · Causal Forensics Deep-Dive
              {stats.con > 0 && <span className="chip chip-bad" style={{ marginLeft: 4 }}>{stats.con}</span>}
            </button>
            <div className="doc-tab-pipeline">
              <span className={`pipeline-step ${s.view === "graph" ? "current" : "done"}`}>① Graph Discovery</span>
              <span className="pipeline-arrow">➔</span>
              <span className={`pipeline-step ${s.view !== "graph" ? "current" : ""}`}>② Causal Motives</span>
            </div>
          </div>

          {s.view === "graph" && (
            <div className="canvas-wrap">
              <GraphCanvas key={s.dataset} nodes={s.nodes} edges={s.edges} selected={s.selected} hidden={hiddenIds} showSemantic={s.showSemantic} showLater={s.showLater} layout={s.layout} expanded={s.expanded}
                fitTick={s.fitTick} zoomTick={s.zoomTick} onSelect={(id) => actions.selectNode(id)} onToggleCluster={() => actions.setOption("expanded", !studio.get().expanded)} onReady={setCy} />
              {s.nodes.length === 0 && (
                <div className="empty-canvas">
                  <div className="ec-card">
                    <div className="ec-kicker">New investigation</div>
                    <h2>Bring a transcript. Check it against its own evidence.</h2>
                    <p>Paste or upload any agent transcript: JSONL, JSON, OpenAI or Anthropic message logs, or a plain text chat. The workbench finds the claims, finds the tool results, and tells you which claims the record contradicts.</p>
                    <div className="ec-actions">
                      <button className="btn primary" onClick={() => actions.openImport(true)}>Import a transcript</button>
                      <button className="btn" onClick={() => void actions.loadDataset("mock")}>Load the sample incident</button>
                    </div>
                    {s.graphFixtures.length > 0 && <div className="ec-fix"><span>or open a bundled episode:</span>{s.graphFixtures.map((f) => <button key={f} className="link" onClick={() => void actions.loadDataset(f)}>{f}</button>)}</div>}
                  </div>
                </div>
              )}
              <div className="zoom"><button onClick={() => actions.zoom(1)}>+</button><button onClick={() => actions.zoom(-1)}>−</button><button onClick={() => actions.fit()}>⤢</button></div>
              <div className="statusline">{s.nodes.length} entities · {s.edges.length} links · {s.graphNote ?? "double-click a cluster to expand"}</div>
            </div>
          )}

          {s.view === "split" && (
            <div className="split-workspace">
              <div className="split-canvas-pane">
                <div className="split-pane-header">
                  <span>⊞ Step 1: Evidence Graph</span>
                  <button className="split-pane-btn" onClick={() => actions.fit()} title="Fit graph">⤢ Fit</button>
                </div>
                <div className="canvas-wrap" style={{ flex: 1, position: "relative" }}>
                  <GraphCanvas key={s.dataset} nodes={s.nodes} edges={s.edges} selected={s.selected} hidden={hiddenIds} showSemantic={s.showSemantic} showLater={s.showLater} layout={s.layout} expanded={s.expanded}
                    fitTick={s.fitTick} zoomTick={s.zoomTick} onSelect={(id) => actions.selectNode(id)} onToggleCluster={() => actions.setOption("expanded", !studio.get().expanded)} onReady={setCy} />
                  <div className="zoom"><button onClick={() => actions.zoom(1)}>+</button><button onClick={() => actions.zoom(-1)}>−</button><button onClick={() => actions.fit()}>⤢</button></div>
                  <div className="statusline">{s.nodes.length} entities · {stats.con} contradicted</div>
                </div>
              </div>
              <div className="split-forensics-pane forensics-host">
                <ForensicsStudio embedded />
              </div>
            </div>
          )}

          {s.view === "forensics" && (
            <div className="forensics-full-pane forensics-host">
              <ForensicsStudio embedded />
            </div>
          )}
        </main>

        {s.view === "graph" && (
          <aside className="right">
            <div className="pane-title">Detail View</div>
            <Detail
              onForensics={() => actions.investigateInForensics(sel?.id, false)}
              onSplitForensics={() => actions.investigateInForensics(sel?.id, true)}
              node={sel}
              nodes={s.nodes}
              edges={s.edges}
              confirmed={new Set(s.confirmed)}
              overrides={s.overrides}
              onSelect={(id) => actions.selectNode(id)}
              onConfirm={(id) => actions.confirm(id)}
              onOverride={(id, v, why) => actions.override(id, v as never, why)}
            />
          </aside>
        )}
      </div>
      <Bottom />
      <ImportDialog />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {agentOpen && <AgentDock onClose={() => setAgentOpen(false)} />}
    </div>
  );
}
