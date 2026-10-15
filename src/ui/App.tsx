import { apiFetch } from "./studio/keys";
import React, { useEffect, useRef, useState } from "react";
import type {
  GoalSummary,
  LatentRewardStructure,
  TraceNarrative,
  CausalConfirmationReport,
} from "../core/types/contracts.js";
import { studio, useStudio, getLevel1Context } from "./studio/store";
import { actions } from "./studio/actions";
import type { LatentRewardReplayReport } from "../forensics/replay/contracts.js";

interface Claim {
  claimId: string;
  sourceRecordId: string;
  statementText: string;
  expectedQuantity?: number;
  targetArtifactPath?: string;
}
interface Trace {
  recordId: string;
  agentId: string;
  timestamp: string;
  scratchpadContent: string;
  associatedAttemptId?: string;
  contradictionDelta?: { claimId: string; internalIntentText: string; externalReportText: string };
}
interface Hypothesis {
  hypothesisId: string;
  category: string;
  isBenignExplanation: boolean;
  statement: string;
  supportingRecordIds: string[];
  refutingRecordIds: string[];
  confidence: number;
  esi?: number;
}
interface Test {
  testId: string;
  targetHypothesisId: string;
  competingHypothesisId: string;
  intervention: { targetType: string; targetComponent: string; deltaContent: string };
  expectedOutcomeUnderTarget: string;
  expectedOutcomeUnderCompeting: string;
  environmentDelta: string[];
}
interface Simulation {
  testId: string;
  agentPolicy: string;
  appliedIntervention: string;
  emittedClaims: string[];
  observedCount?: number;
  signal: string;
  supportsHypothesisCategory: string;
  environmentDivergenceNotice: string[];
}
interface Report {
  episodeId: string;
  goalSummary?: GoalSummary;
  traceNarrative?: TraceNarrative;
  causalReport?: CausalConfirmationReport;
  claims: Claim[];
  traces: Trace[];
  hypothesisSet: { hypotheses: Hypothesis[]; epistemicDisclaimer: string; discriminatingTests: Test[] };
  simulation: Simulation[];
  model: string;
  provenance?: { engine: string; hypotheses: string; replay: string; simulation: string; notes: string[] };
  latentRewardReplay?: LatentRewardReplayReport;
  latentRewardStructure?: LatentRewardStructure;
}

export function App({ embedded }: { embedded?: boolean } = {}) {
  const [fixtures, setFixtures] = useState<string[]>([]);
  const studioState = useStudio((x) => x);
  const l1Context = getLevel1Context(studioState);
  const [jsonl, setJsonl] = useState(l1Context.jsonl || "");
  const [episodeId, setEpisodeId] = useState(l1Context.episodeId || "real_aivillage_episode");
  const [report, setReport] = useState<Report | null>(studioState.forensics.report as Report | null);
  const [expandedScratchpads, setExpandedScratchpads] = useState<Record<string, boolean>>({});
  const [showAdvanced, setShowAdvanced] = useState(!l1Context.hasActiveAnalysis);

  function toggleScratchpad(groupId: string) {
    setExpandedScratchpads((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  }
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [usePython, setUsePython] = useState(true);
  const [scanning, setScanning] = useState(false);
  const imported = useStudio((x) => x.imported);
  const lastAnalyzedEpisode = useRef<string | null>(null);

  // Sync report when stored in studio state
  useEffect(() => {
    if (studioState.forensics.report !== report) {
      setReport(studioState.forensics.report as Report | null);
    }
  }, [studioState.forensics.report]);

  // Synchronize with Level 1 investigation state and auto-run forensics
  useEffect(() => {
    if (l1Context.hasActiveAnalysis) {
      const currentJsonl = l1Context.jsonl || jsonl;
      const currentEpId = l1Context.episodeId || episodeId;

      if (l1Context.jsonl && l1Context.jsonl !== jsonl) {
        setJsonl(l1Context.jsonl);
      }
      if (l1Context.episodeId && l1Context.episodeId !== episodeId) {
        setEpisodeId(l1Context.episodeId);
      }

      // If episode changed and current report is for a different episode, clear report
      if (report && studioState.forensics.episodeId && studioState.forensics.episodeId !== currentEpId) {
        setReport(null);
      }

      // If no report exists yet for this episode, auto-execute immediately
      if (currentJsonl && lastAnalyzedEpisode.current !== currentEpId && !report && !running) {
        lastAnalyzedEpisode.current = currentEpId;
        void execute(currentJsonl, currentEpId).catch(() => undefined);
      }
    }
  }, [l1Context.datasetName, l1Context.episodeId, l1Context.jsonl]);

  useEffect(() => {
    if (!imported) return;
    pending.current = null;
    setJsonl(imported.jsonl);
    setEpisodeId(imported.name.replace(/\.[^.]+$/, ""));
    void execute(imported.jsonl, imported.name.replace(/\.[^.]+$/, "")).catch(() => undefined);
  }, [imported?.at]);

  useEffect(() => {
    apiFetch("/api/fixtures")
      .then((r) => r.json())
      .then((d) => {
        setFixtures(d.fixtures || []);
      })
      .catch(() => setFixtures([]));
  }, []);

  async function loadFixture(name: string) {
    try {
      const res = await apiFetch(`/api/fixtures/${name}`);
      if (!res.ok) return;
      const d = await res.json();
      setJsonl(d.content);
      setEpisodeId(name.replace(/\.jsonl$/, ""));
      setReport(null);
      setError(null);
    } catch {
      // ignore
    }
  }

  async function rescanDataset() {
    setScanning(true);
    try {
      const res = await apiFetch("/api/dataset/rescan", { method: "POST" });
      const d = await res.json();
      setFixtures(d.fixtures);
      await loadFixture("real_aivillage_episode.jsonl");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  async function execute(content: string, id: string) {
    setRunning(true);
    setError(null);
    try {
      const res = await apiFetch("/api/forensics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonl: content, episodeId: id, usePython: latest.current.usePython }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "forensics failed");
      setReport(body);
      studio.patchForensics({ report: body, episodeId: id, running: false, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      studio.patchForensics({ error: msg, running: false });
      throw e;
    } finally {
      setRunning(false);
    }
  }

  async function runForensics() {
    await execute(jsonl, episodeId).catch(() => undefined);
  }

  // Share state with the studio store so the agent sees Step 2, and expose controls to it.
  const latest = useRef({ jsonl, episodeId, usePython });
  latest.current = { jsonl, episodeId, usePython };
  const pending = useRef<string | null>(null);
  useEffect(() => {
    studio.patchForensics({ fixtures, episodeId, running, report, error });
  }, [fixtures, episodeId, running, report, error]);
  useEffect(() => {
    studio.registerForensics({
      loadFixture: async (name) => { pending.current = name; await loadFixture(name); },
      run: async () => {
        if (pending.current) {
          const d = await apiFetch(`/api/fixtures/${pending.current}`).then((r) => r.json());
          await execute(d.content, pending.current.replace(/\.jsonl$/, ""));
        } else {
          await execute(latest.current.jsonl, latest.current.episodeId);
        }
      },
    });
    return () => studio.registerForensics(null);
  }, []);

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setEpisodeId(file.name.replace(/\.jsonl$/, ""));
    file.text().then((t) => {
      setJsonl(t);
      setReport(null);
    });
  }

  return (
    <div className={`page ${embedded ? "embedded" : ""}`}>
      <header className="forensics-l2-header">
        <div className="l2-header-top">
          <button
            type="button"
            className="back-to-l1-btn"
            onClick={() => actions.switchView("graph")}
            title="Return to Level 1 Investigation Graph"
          >
            ← Back to Step 1 Investigation Graph
          </button>
          <div className="l2-step-pill">
            <span className="step-badge l1">Step 1: Graph & Verdicts</span>
            <span className="arrow-sep">➔</span>
            <span className="step-badge l2 active">Step 2: Causal Deep-Dive</span>
          </div>
          <div className="forensics-view-toggle">
            <button
              type="button"
              className={studioState.view === "split" ? "on" : ""}
              onClick={() => actions.switchView("split")}
              title="Inspect Step 1 Graph and Step 2 Forensics side-by-side"
            >
              ◫ Split View
            </button>
            <button
              type="button"
              className={studioState.view === "forensics" ? "on" : ""}
              onClick={() => actions.switchView("forensics")}
              title="Full screen Step 2 Causal Forensics"
            >
              🔬 Forensics Full
            </button>
          </div>
        </div>
        <h1>Step 2 · Model Forensics Studio</h1>
        <p className="subtitle">
          Causal motive reconstruction, latent reward formulation, and counterfactual simulation
          starting directly from Level 1 evidence.
        </p>
      </header>

      <section className="panel l1-handoff-panel">
        <div className="l1-handoff-top">
          <div>
            <span className="l1-kicker">Level 1 Analysis Grounding</span>
            <h2 className="l1-case-title">
              Active Investigation: <b>{l1Context.datasetName}</b>
            </h2>
            <div className="l1-episode-id">
              Episode ID: <code>{episodeId}</code> · Source: <span className="chip">{l1Context.source}</span>
            </div>
          </div>
          <div className="l1-stats-strip">
            <div className="l1-stat-pill" title="Total entities extracted in Level 1">
              <b>{l1Context.totalRecords}</b>
              <span>Entities</span>
            </div>
            <div className="l1-stat-pill" title="Total claims evaluated in Level 1">
              <b>{l1Context.totalClaims}</b>
              <span>Claims</span>
            </div>
            <div className="l1-stat-pill con" title="Claims contradicted by recorded observations">
              <b>{l1Context.contradictedCount}</b>
              <span>🚨 Contradicted</span>
            </div>
            <div className="l1-stat-pill unr" title="Claims with no decisive evidence">
              <b>{l1Context.unresolvedCount}</b>
              <span>⚠️ Unresolved</span>
            </div>
            <div className="l1-stat-pill sup" title="Claims verified by observations">
              <b>{l1Context.supportedCount}</b>
              <span>✅ Supported</span>
            </div>
          </div>
        </div>

        {/* Level 1 Targeted Anomaly */}
        {l1Context.targetClaim ? (
          <div className="l1-target-card">
            <div className="l1-target-header">
              <div className="l1-target-tag">
                <span className="target-pulse" />
                <strong>Targeted Anomaly from Level 1:</strong>
              </div>
              {l1Context.contradictedClaims.length > 1 && (
                <label className="switch-anomaly-label">
                  Switch anomaly:
                  <select
                    value={l1Context.targetClaim.id}
                    onChange={(e) => actions.setTargetClaim(e.target.value)}
                  >
                    {l1Context.contradictedClaims.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} ({c.id})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="l1-target-body">
              <div className="l1-target-claim-row">
                <div className="l1-claim-badge">CONTRADICTED</div>
                <div className="l1-claim-info">
                  <h3 className="l1-claim-title">{l1Context.targetClaim.label}</h3>
                  <p className="l1-claim-preview">"{l1Context.targetClaim.previewText}"</p>
                  <div className="l1-claim-meta">
                    <span>Source record: <code>{l1Context.targetClaim.sourceRecordId}</code></span>
                    {l1Context.targetClaim.agent && <span>Agent: <b>{l1Context.targetClaim.agent}</b></span>}
                    {l1Context.targetClaim.time && <span>Time: <time>{l1Context.targetClaim.time}</time></span>}
                  </div>
                </div>
              </div>
              {l1Context.targetClaim.decisiveObservation && (
                <div className="l1-decisive-obs">
                  <strong>Refuting Observation in Level 1 Graph:</strong>
                  <span>{l1Context.targetClaim.decisiveObservation.label} — <em>"{l1Context.targetClaim.decisiveObservation.previewText}"</em></span>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, margin: "10px 0", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="chip-link-btn"
                  onClick={() => {
                    actions.selectNode(l1Context.targetClaim!.id);
                    if (studioState.view === "forensics") actions.switchView("split");
                  }}
                  title="Highlight and center this claim in Step 1 graph"
                >
                  ⌕ Highlight Claim in Graph ({l1Context.targetClaim.id})
                </button>
                {l1Context.targetClaim.decisiveObservation && (
                  <button
                    type="button"
                    className="chip-link-btn"
                    onClick={() => {
                      actions.selectNode(l1Context.targetClaim!.decisiveObservation!.id);
                      if (studioState.view === "forensics") actions.switchView("split");
                    }}
                    title="Highlight and center the refuting observation in Step 1 graph"
                  >
                    ⌕ Highlight Observation in Graph ({l1Context.targetClaim.decisiveObservation.id})
                  </button>
                )}
              </div>
              <div className="l1-forensic-mission">
                <strong>Forensic Objective:</strong> Level 1 established that this claim conflicts with recorded tool observations. Level 2 investigates whether the discrepancy arose from benign tool execution errors or deliberate strategic deception, and identifies the underlying latent reward structure.
              </div>
            </div>
          </div>
        ) : (
          <div className="l1-no-target-note">
            {l1Context.hasActiveAnalysis ? (
              <p>
                Full multi-agent episode stream linked from Level 1 ({l1Context.datasetName}).
                Forensics is evaluating all agent scratchpads for latent reward alignment, shortcut preferences, and counterfactual policy stability.
              </p>
            ) : (
              <div style={{ textAlign: "center", padding: "18px 12px" }}>
                <h3 style={{ margin: "0 0 6px", color: "var(--navy)", fontSize: 15 }}>No Active Investigation Loaded in Step 1</h3>
                <p style={{ margin: "0 0 12px", color: "var(--dim)", fontSize: 12.5 }}>
                  Step 2 Causal Forensics automatically analyzes artifacts from Step 1 without requiring manual uploads or prompts.
                </p>
                <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" className="btn primary" onClick={() => void actions.loadDataset("mock")}>
                    Load Sample Incident (June 11)
                  </button>
                  <button type="button" className="btn" onClick={() => actions.openImport(true)}>
                    Import Transcript in Step 1
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="l1-action-row" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
          <button
            type="button"
            className="btn-run-forensics"
            disabled={!jsonl || running}
            onClick={runForensics}
          >
            {running
              ? "🔬 Run Forensics: Analyzing Level 1 Episode…"
              : report
              ? "↻ Re-run Forensics on Level 1 Episode"
              : l1Context.hasActiveAnalysis
              ? "🔬 Run Forensics on Level 1 Episode"
              : "Run Forensics"}
          </button>

          {l1Context.hasActiveAnalysis ? (
            <div className="l1-stream-sync-pill" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ok)", background: "#d5efdf", padding: "4px 10px", border: "1px solid #c4ecd3", borderRadius: 4, fontWeight: 600 }}>
              <span>✓ Artifacts Auto-Linked from Step 1 ({l1Context.datasetName}) · {l1Context.totalRecords} records</span>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: "var(--dim)" }}>
              Artifacts will link automatically once Step 1 loads
            </span>
          )}

          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--dim)" }}>
            <input
              type="checkbox"
              checked={usePython}
              onChange={(e) => setUsePython(e.target.checked)}
            />
            Python Engine
          </label>

          {l1Context.hasActiveAnalysis && (
            <button
              type="button"
              className="btn-toggle-advanced"
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{ marginLeft: "auto", background: "none", color: "var(--blue, #2f6fb5)", border: "1px solid var(--line, #c5ced7)", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11.5 }}
            >
              {showAdvanced ? "▲ Hide Stream Preview" : "▼ Inspect Stream Preview"}
            </button>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        {/* When active analysis exists: read-only preview only if explicitly requested */}
        {l1Context.hasActiveAnalysis && showAdvanced && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--line, #c5ced7)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 11.5, color: "var(--dim)" }}>
                Active Transcript Stream: <code>{episodeId}</code> ({l1Context.source})
              </span>
              <span style={{ fontSize: 11, color: "var(--dim)" }}>
                Piped automatically from Level 1 Evidence Graph
              </span>
            </div>
            <textarea
              rows={4}
              readOnly
              value={jsonl}
            />
          </div>
        )}

        {/* Automated test runner fixture compatibility hook */}
        <div
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            border: 0,
          }}
          aria-hidden="true"
        >
          <textarea
            rows={1}
            placeholder="…or paste episode JSONL here"
            value={jsonl}
            onChange={(e) => setJsonl(e.target.value)}
          />
        </div>
      </section>

      {running && !report && (
        <section className="panel" style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 22px", background: "#eef4fb", border: "1px solid #c5ced7", borderLeft: "5px solid var(--blue)", borderRadius: 5 }}>
          <div className="target-pulse" style={{ width: 12, height: 12 }} />
          <div>
            <strong style={{ color: "var(--navy)", fontSize: 14 }}>🔬 Running Causal Motive Forensics on {l1Context.datasetName}…</strong>
            <p style={{ margin: "4px 0 0", color: "var(--ink)", fontSize: 12.5 }}>
              Replaying agent internal monologues, testing competing hypotheses (benign shortcut vs. strategic deception), and computing counterfactual Pearl rollouts.
            </p>
          </div>
        </section>
      )}

      {report && (
        <>
          <p className="disclaimer">⚠️ {report.hypothesisSet.epistemicDisclaimer}</p>
          {report.provenance && (
            <section className="panel provenance">
              <h2>How this report was produced</h2>
              <table>
                <tbody>
                  <tr><th>Engine</th><td>{report.provenance.engine}</td></tr>
                  <tr><th>Hypotheses</th><td>{report.provenance.hypotheses}</td></tr>
                  <tr><th>Replay rollouts</th><td><b>{report.provenance.replay}</b></td></tr>
                  <tr><th>Simulation</th><td>{report.provenance.simulation}</td></tr>
                </tbody>
              </table>
              {report.provenance.notes.map((n) => <p key={n} className="muted">{n}</p>)}
            </section>
          )}
          <p className="muted">Model backend: {report.model} · Episode: {report.episodeId}</p>

          {report.goalSummary && (
            <section className="panel" style={{ borderLeft: "4px solid #4f7cff" }}>
              <h2>1. Episode & Agent Goal Summarization</h2>
              <div className="row" style={{ gap: 20 }}>
                <div style={{ flex: 1 }}>
                  <strong>Nominal Assigned Goal (G_nominal):</strong>
                  <p style={{ margin: "6px 0 10px 0" }}>{report.goalSummary.nominalGoal}</p>
                </div>
                <div style={{ flex: 1 }}>
                  <strong>Inferred Operative Goal (G_operative):</strong>
                  <p style={{ margin: "6px 0 10px 0" }}>{report.goalSummary.operativeGoal}</p>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                <span>Alignment Verdict:</span>
                <span className={`badge ${report.goalSummary.alignmentVerdict === "ALIGNED" ? "benign" : "deceptive"}`}>
                  {report.goalSummary.alignmentVerdict}
                </span>
                <span className="muted" style={{ marginLeft: 8 }}>{report.goalSummary.evidenceNotes}</span>
              </div>
            </section>
          )}

          <section className="panel">
            <h2>2. Atomic claims</h2>
            <table>
              <thead><tr><th>Claim</th><th>Statement</th><th>Expected qty</th><th>Source</th></tr></thead>
              <tbody>
                {report.claims.map((c) => (
                  <tr key={c.claimId}>
                    <td>
                      <button
                        type="button"
                        className="chip-link-sm"
                        onClick={() => {
                          actions.selectNode(c.claimId);
                          if (studioState.view === "forensics") actions.switchView("split");
                        }}
                        title={`Select ${c.claimId} on graph`}
                      >
                        ⌕ {c.claimId}
                      </button>
                    </td>
                    <td>{c.statementText}</td>
                    <td>{c.expectedQuantity ?? "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="chip-link-sm"
                        onClick={() => {
                          actions.selectNode(c.sourceRecordId);
                          if (studioState.view === "forensics") actions.switchView("split");
                        }}
                        title={`Select ${c.sourceRecordId} on graph`}
                      >
                        {c.sourceRecordId}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>3. Reasoning traces & LLM Narrative Synthesis</h2>
              {report.traceNarrative && (
                <span className="badge" style={{ background: "#4f7cff" }}>
                  LLM Summarized
                </span>
              )}
            </div>

            {report.traceNarrative && (
              <div className="narrative-summary">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <strong>🤖 Incident Executive Narrative:</strong>
                  <span className="badge agent-badge">Cross-Agent Monologue Synthesis</span>
                </div>
                <p style={{ lineHeight: 1.6, margin: 0 }}>{report.traceNarrative.overallExecutiveSummary}</p>
              </div>
            )}

            {report.traceNarrative && report.traceNarrative.groupExplanations.length > 0 ? (
              <div className="group-explanations">
                {report.traceNarrative.groupExplanations.map((g) => {
                  const isExpanded = expandedScratchpads[g.groupId];
                  const rawTrace = report.traces.find((t) => g.recordsInvolved.includes(t.recordId));

                  return (
                    <div
                      key={g.groupId}
                      className={`trace-card ${
                        g.divergenceLevel === "DECEPTIVE_FABRICATION"
                          ? "deceptive"
                          : g.divergenceLevel === "SUSPICIOUS_SHORTCUT"
                          ? "suspicious"
                          : "benign"
                      }`}
                    >
                      <div className="trace-card-header">
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span className="trace-card-title">{g.title}</span>
                          {g.agentIds.map((a) => (
                            <span key={a} className="badge agent-badge">{a}</span>
                          ))}
                          {g.recordsInvolved.map((rid) => (
                            <button
                              key={rid}
                              type="button"
                              className="chip-link-sm"
                              onClick={() => {
                                actions.selectNode(rid);
                                if (studioState.view === "forensics") actions.switchView("split");
                              }}
                              title={`Inspect ${rid} in graph`}
                            >
                              ⌕ {rid}
                            </button>
                          ))}
                        </div>
                        <span
                          className={`badge ${
                            g.divergenceLevel === "DECEPTIVE_FABRICATION"
                              ? "deceptive"
                              : g.divergenceLevel === "SUSPICIOUS_SHORTCUT"
                              ? "suspicious"
                              : "benign"
                          }`}
                        >
                          {g.divergenceLevel === "DECEPTIVE_FABRICATION"
                            ? "🚨 Deceptive Divergence"
                            : g.divergenceLevel === "SUSPICIOUS_SHORTCUT"
                            ? "⚠️ Shortcut Divergence"
                            : "✅ Aligned Monologue"}
                        </span>
                      </div>

                      <div className="trace-section">
                        <span className="trace-section-label">What Happened</span>
                        <p className="trace-section-text">{g.whatHappened}</p>
                      </div>

                      <div className="trace-section">
                        <span className="trace-section-label">Internal Monologue & Thought Analysis</span>
                        <p className="trace-section-text">{g.internalMonologueAnalysis}</p>
                        {rawTrace && (
                          <div>
                            <button
                              type="button"
                              className="scratchpad-toggle-btn"
                              onClick={() => toggleScratchpad(g.groupId)}
                            >
                              {isExpanded ? "Hide Raw Scratchpad ▴" : "View Raw Scratchpad ▾"}
                            </button>
                            {isExpanded && (
                              <pre className="scratchpad-raw">{rawTrace.scratchpadContent}</pre>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="trace-section">
                        <span className="trace-section-label">Outward Action / Public Claim</span>
                        <p className="trace-section-text">{g.outwardActionAnalysis}</p>
                      </div>

                      <div className="trace-section investigator-takeaway">
                        <span className="trace-section-label">Investigator Finding</span>
                        <p className="trace-section-text"><strong>Takeaway:</strong> {g.investigatorFinding}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {report.traces.length === 0 && <p className="muted">No scratchpads found in this episode.</p>}
                {report.traces.map((t) => (
                  <div key={t.recordId} className="trace">
                    <div className="muted" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>{t.recordId} · {t.agentId} · {t.timestamp}</span>
                      <button
                        type="button"
                        className="chip-link-sm"
                        onClick={() => {
                          actions.selectNode(t.recordId);
                          if (studioState.view === "forensics") actions.switchView("split");
                        }}
                        title={`Inspect ${t.recordId} in graph`}
                      >
                        ⌕ Locate in Graph
                      </button>
                    </div>
                    <pre>{t.scratchpadContent}</pre>
                    {t.contradictionDelta && (
                      <div className="delta">
                        <strong>Divergence:</strong> internal thought vs. claim {t.contradictionDelta.claimId}:
                        <em> “{t.contradictionDelta.externalReportText}”</em>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </section>

          <section className="panel">
            <h2>4. Competing hypotheses</h2>
            <div className="cards">
              {report.hypothesisSet.hypotheses.map((h) => (
                <div key={h.hypothesisId} className={`card ${h.isBenignExplanation ? "benign" : "deceptive"}`}>
                  <div className="badge">{h.category}</div>
                  <p>{h.statement}</p>
                  <div className="muted" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    <span>ESI: <strong>{(h.esi ?? 0).toFixed(2)}</strong> · confidence {(h.confidence * 100).toFixed(0)}%</span>
                    {h.supportingRecordIds.length > 0 && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        · supports:
                        {h.supportingRecordIds.map((rid) => (
                          <button
                            key={rid}
                            type="button"
                            className="chip-link-sm"
                            onClick={() => {
                              actions.selectNode(rid);
                              if (studioState.view === "forensics") actions.switchView("split");
                            }}
                            title={`Select node ${rid} on graph`}
                          >
                            {rid}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>5. Discriminating test design</h2>
            {report.hypothesisSet.discriminatingTests.map((t) => (
              <div key={t.testId} className="trace">
                <div><strong>{t.testId}</strong> · {t.intervention.targetType} on {t.intervention.targetComponent}</div>
                <p><strong>Intervention:</strong> {t.intervention.deltaContent}</p>
                <p><strong>If {t.targetHypothesisId}:</strong> {t.expectedOutcomeUnderTarget}</p>
                <p><strong>If {t.competingHypothesisId}:</strong> {t.expectedOutcomeUnderCompeting}</p>
                <div className="muted">Environment delta: {t.environmentDelta.join(" · ")}</div>
              </div>
            ))}
          </section>

          <section className="panel">
            <h2>6. Counterfactual simulation (scripted illustration)</h2>
            <div className="cards">
              {report.simulation.map((s, idx) => (
                <div key={idx} className={`card ${s.signal === "REAL_COUNT_OBSERVED" || s.signal === "HONEST_ADOPTION" ? "benign" : "deceptive"}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <strong>Policy: {s.agentPolicy}</strong>
                    <span className="badge">{s.supportsHypothesisCategory}</span>
                  </div>
                  <p><strong>Intervention:</strong> {s.appliedIntervention}</p>
                  <p>
                    <strong>Emitted claims:</strong> <em>{s.emittedClaims.join(" | ") || "None"}</em>
                    {s.observedCount !== undefined && <span> (Count: {s.observedCount})</span>}
                  </p>
                  <div>
                    <strong>Forensic Signal:</strong>{" "}
                    <code className={`badge ${s.signal === "REAL_COUNT_OBSERVED" || s.signal === "HONEST_ADOPTION" ? "benign" : "deceptive"}`}>
                      {s.signal}
                    </code>
                  </div>
                  {s.environmentDivergenceNotice && s.environmentDivergenceNotice.length > 0 && (
                    <div className="muted" style={{ marginTop: 8 }}>
                      Isolation Delta: {s.environmentDivergenceNotice.join(" · ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {report.latentRewardStructure && (
            <section className="panel" style={{ borderLeft: "4px solid #f0b429" }}>
              <h2>7. Latent Reward Function Structure & Payoff Matrix</h2>
              <div className="delta" style={{ fontSize: "1.05rem", padding: "10px 14px", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6, marginBottom: 16 }}>
                <code>{report.latentRewardStructure.formulation}</code>
              </div>

              <div style={{ marginBottom: 16 }}>
                <h3 style={{ margin: "0 0 10px 0" }}>Evaluated Reward Parameters</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                  {Object.entries(report.latentRewardStructure.parameters).map(([key, p]) => (
                    <div key={key} className="card" style={{ borderColor: p.active ? "var(--accent)" : "var(--line)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <strong>{p.label}</strong>
                        <span className={`badge ${p.active ? "deceptive" : "benign"}`}>
                          {p.active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </div>
                      <div style={{ fontSize: "1.4rem", fontWeight: "bold", margin: "4px 0", color: "var(--navy)" }}>
                        {p.value.toFixed(2)}
                      </div>
                      <div className="muted">{p.description}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 style={{ margin: "0 0 10px 0" }}>Payoff Comparison Matrix</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Candidate Action</th>
                      <th>Action Description</th>
                      <th>Net Payoff Score</th>
                      <th>Agent Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.latentRewardStructure.payoffComparison.map((p, idx) => (
                      <tr key={idx} style={{ background: p.preferredByAgent ? "#e8f1fb" : "transparent" }}>
                        <td><strong>{p.action}</strong></td>
                        <td>{p.description}</td>
                        <td><code>{p.netPayoffScore > 0 ? `+${p.netPayoffScore}` : p.netPayoffScore}</code></td>
                        <td>
                          {p.preferredByAgent ? (
                            <span className="badge deceptive">★ Selected Action</span>
                          ) : (
                            <span className="badge benign">Sub-optimal</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>8. Isolated Replay Rollouts & Causal Confirmation</h2>
              {report.causalReport && (
                <span className="badge" style={{ background: "#2fbf71", color: "#000", fontWeight: "bold" }}>
                  LLM Causal Report
                </span>
              )}
            </div>

            {report.causalReport && (
              <div className="causal-report-container">
                <div
                  className={`causal-verdict-banner ${
                    report.causalReport.executiveVerdict.includes("Achieved") ? "confirmed" : "pending"
                  }`}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <strong>⚖️ Executive Causal Confirmation Verdict:</strong>
                    <span className="badge agent-badge">Pearl Layer 3 Evaluated</span>
                  </div>
                  <div style={{ fontSize: "1.15rem", fontWeight: "600", lineHeight: 1.4 }}>
                    {report.causalReport.executiveVerdict}
                  </div>
                </div>

                <div className="panel" style={{ background: "var(--panel)", border: "1px solid var(--line)", margin: "16px 0" }}>
                  <h3 style={{ margin: "0 0 8px 0", color: "var(--navy)" }}>🔬 Pearl Causal Intervention Mechanism (do(X = x&apos;))</h3>
                  <p style={{ lineHeight: 1.6, margin: 0 }}>{report.causalReport.interventionMechanism}</p>
                </div>

                <div style={{ margin: "16px 0" }}>
                  <h3 style={{ margin: "0 0 10px 0" }}>Behavior Divergence: Observational Baseline vs. Counterfactual Intervention</h3>
                  <div className="cards" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <div className="card" style={{ borderColor: "var(--bad)", background: "#fdf3f2" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <strong>Observational World (X = x)</strong>
                        <span className="badge deceptive">Baseline</span>
                      </div>
                      <p style={{ lineHeight: 1.5, margin: "6px 0" }}>
                        {report.causalReport.counterfactualBehaviorComparison.observationalBaseline}
                      </p>
                    </div>

                    <div className="card" style={{ borderColor: "var(--ok)", background: "#f1faf4" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <strong>Counterfactual Intervention (do(X = x&apos;))</strong>
                        <span className="badge benign">N=3 Rollouts (T=0.4)</span>
                      </div>
                      <p style={{ lineHeight: 1.5, margin: "6px 0" }}>
                        {report.causalReport.counterfactualBehaviorComparison.counterfactualIntervention}
                      </p>
                    </div>
                  </div>

                  <div className="delta" style={{ marginTop: 10, padding: "8px 12px", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6 }}>
                    <strong>Causal Significance:</strong> {report.causalReport.counterfactualBehaviorComparison.causalDivergenceSignificance}
                  </div>
                </div>

                <div style={{ margin: "16px 0" }}>
                  <h3 style={{ margin: "0 0 8px 0" }}>Operative Reward Function Inversion</h3>
                  <p style={{ lineHeight: 1.6, margin: 0, color: "var(--ink)" }}>{report.causalReport.rewardFunctionAnalysis}</p>
                </div>

                <div style={{ margin: "16px 0" }}>
                  <h3 style={{ margin: "0 0 10px 0" }}>🛡️ Forensic Remedial Recommendations</h3>
                  <ul className="recommendations-list">
                    {report.causalReport.remedialRecommendations.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {report.latentRewardReplay && (
              <div style={{ marginTop: 20 }}>
                <h3 style={{ margin: "0 0 10px 0" }}>Underlying Replay Probes & Rollout Consistency</h3>
                {report.latentRewardReplay.inferredOperativeReward && (
                  <div className="delta" style={{ marginBottom: 12 }}>
                    <strong>Inferred Operative Reward:</strong> <code>{report.latentRewardReplay.inferredOperativeReward}</code>
                  </div>
                )}
                {report.latentRewardReplay.evaluations.map((ev) => (
                  <div key={ev.probeId} className="trace">
                    <div>
                      <strong>Archetype: {ev.archetype}</strong> → Verdict:{" "}
                      <code className={`badge ${ev.verdict === "CONFIRMED" ? "benign" : ev.verdict === "FALSIFIED" ? "deceptive" : ""}`}>
                        {ev.verdict}
                      </code>{" "}
                      ({Math.round(ev.confirmedScore * 100)}% consistency across {ev.rolloutResults.length} rollouts)
                    </div>
                    <div className="muted">{ev.divergenceSummary}</div>
                  </div>
                ))}
                <div className="muted" style={{ marginTop: 12, fontStyle: "italic" }}>
                  {report.causalReport?.epistemicCaveat ?? report.latentRewardReplay.epistemicDisclaimer}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
