import React, { useEffect, useState } from "react";
import type { GoalSummary, LatentRewardStructure } from "../core/types/contracts.js";
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
  claims: Claim[];
  traces: Trace[];
  hypothesisSet: { hypotheses: Hypothesis[]; epistemicDisclaimer: string; discriminatingTests: Test[] };
  simulation: Simulation[];
  model: string;
  latentRewardReplay?: LatentRewardReplayReport;
  latentRewardStructure?: LatentRewardStructure;
}

export function App() {
  const [fixtures, setFixtures] = useState<string[]>([]);
  const [jsonl, setJsonl] = useState("");
  const [episodeId, setEpisodeId] = useState("real_aivillage_episode");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [usePython, setUsePython] = useState(true);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    fetch("/api/fixtures")
      .then((r) => r.json())
      .then((d) => {
        setFixtures(d.fixtures || []);
        if (d.fixtures?.includes("real_aivillage_episode.jsonl")) {
          loadFixture("real_aivillage_episode.jsonl");
        }
      })
      .catch(() => setFixtures([]));
  }, []);

  async function loadFixture(name: string) {
    try {
      const res = await fetch(`/api/fixtures/${name}`);
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
      const res = await fetch("/api/dataset/rescan", { method: "POST" });
      const d = await res.json();
      setFixtures(d.fixtures);
      await loadFixture("real_aivillage_episode.jsonl");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  async function runForensics() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/forensics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonl, episodeId, usePython }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "forensics failed");
      setReport(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

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
    <div className="page">
      <header>
        <h1>Model Forensics Studio</h1>
        <p>Direct AI Village dataset interpretation in Python (Zero SQL connector required).</p>
      </header>

      <section className="panel">
        <div className="delta" style={{ marginBottom: 16 }}>
          <strong>Mode:</strong> Direct stream of <code>dataset/events.jsonl.gz</code> & <code>chat_messages.jsonl.gz</code> via native Python interpreter. No external SQL database or database connector required.
        </div>

        <h2>1. Select a dataset episode</h2>
        <div className="row" style={{ alignItems: "center", gap: 12 }}>
          <label>
            Bundled fixture:&nbsp;
            <select
              value={fixtures.includes(episodeId + ".jsonl") ? episodeId + ".jsonl" : ""}
              onChange={(e) => e.target.value && loadFixture(e.target.value)}
            >
              {fixtures.map((f) => (
                <option key={f} value={f}>
                  {f === "real_aivillage_episode.jsonl" ? "★ real_aivillage_episode.jsonl (Live Dataset)" : f}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={scanning}
            onClick={rescanDataset}
            style={{ padding: "4px 10px", fontSize: "0.85rem" }}
          >
            {scanning ? "Extracting from events.jsonl.gz…" : "↻ Rescan Raw Dataset (Python)"}
          </button>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
            <input
              type="checkbox"
              checked={usePython}
              onChange={(e) => setUsePython(e.target.checked)}
            />
            Use Direct Python Forensics Engine
          </label>
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <label style={{ flex: 1 }}>
            Episode ID: <input value={episodeId} onChange={(e) => setEpisodeId(e.target.value)} />
          </label>
          <label>
            Upload JSONL: <input type="file" accept=".jsonl,.jsonl.gz,.jsonl,jsonl" onChange={onUpload} />
          </label>
        </div>

        <textarea
          rows={8}
          placeholder="…or paste episode JSONL here"
          value={jsonl}
          onChange={(e) => setJsonl(e.target.value)}
        />
        <button disabled={!jsonl || running} onClick={runForensics}>
          {running ? "Running Forensics…" : "Run Forensics"}
        </button>
        {error && <p className="error">{error}</p>}
      </section>

      {report && (
        <>
          <p className="disclaimer">⚠️ {report.hypothesisSet.epistemicDisclaimer}</p>
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
                    <td>{c.claimId}</td><td>{c.statementText}</td>
                    <td>{c.expectedQuantity ?? "—"}</td><td>{c.sourceRecordId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <h2>3. Reasoning traces vs. external claims</h2>
            {report.traces.length === 0 && <p className="muted">No scratchpads found in this episode.</p>}
            {report.traces.map((t) => (
              <div key={t.recordId} className="trace">
                <div className="muted">{t.recordId} · {t.agentId} · {t.timestamp}</div>
                <pre>{t.scratchpadContent}</pre>
                {t.contradictionDelta && (
                  <div className="delta">
                    <strong>Divergence:</strong> internal thought vs. claim {t.contradictionDelta.claimId}:
                    <em> “{t.contradictionDelta.externalReportText}”</em>
                  </div>
                )}
              </div>
            ))}
          </section>

          <section className="panel">
            <h2>4. Competing hypotheses</h2>
            <div className="cards">
              {report.hypothesisSet.hypotheses.map((h) => (
                <div key={h.hypothesisId} className={`card ${h.isBenignExplanation ? "benign" : "deceptive"}`}>
                  <div className="badge">{h.category}</div>
                  <p>{h.statement}</p>
                  <div className="muted">
                    ESI: <strong>{(h.esi ?? 0).toFixed(2)}</strong> · confidence {(h.confidence * 100).toFixed(0)}% · supports: {h.supportingRecordIds.join(", ") || "—"}
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
            <h2>6. Counterfactual simulation (do(X = x&apos;))</h2>
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
              <div className="delta" style={{ fontSize: "1.05rem", padding: "10px 14px", background: "#1c2230", borderRadius: 6, marginBottom: 16 }}>
                <code>{report.latentRewardStructure.formulation}</code>
              </div>

              <div style={{ marginBottom: 16 }}>
                <h3 style={{ margin: "0 0 10px 0" }}>Evaluated Reward Parameters</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                  {Object.entries(report.latentRewardStructure.parameters).map(([key, p]) => (
                    <div key={key} className="card" style={{ borderColor: p.active ? "#f0b429" : "#2a3040" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <strong>{p.label}</strong>
                        <span className={`badge ${p.active ? "deceptive" : "benign"}`}>
                          {p.active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </div>
                      <div style={{ fontSize: "1.4rem", fontWeight: "bold", margin: "4px 0" }}>
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
                      <tr key={idx} style={{ background: p.preferredByAgent ? "#1a243b" : "transparent" }}>
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

          {report.latentRewardReplay && (
            <section className="panel">
              <h2>8. Isolated Replay Rollouts & Causal Confirmation</h2>
              {report.latentRewardReplay.inferredOperativeReward && (
                <div className="delta" style={{ marginBottom: 12 }}>
                  <strong>Inferred Operative Reward:</strong> <code>{report.latentRewardReplay.inferredOperativeReward}</code>
                </div>
              )}
              {report.latentRewardReplay.evaluations.map((ev) => (
                <div key={ev.probeId} className="trace">
                  <div>
                    <strong>Archetype: {ev.archetype}</strong> → Verdict:{" "}
                    <code className={`badge ${ev.verdict === "CONFIRMED" ? "benign" : "deceptive"}`}>
                      {ev.verdict}
                    </code>{" "}
                    ({Math.round(ev.confirmedScore * 100)}% consistency across {ev.rolloutResults.length} rollouts)
                  </div>
                  <div className="muted">{ev.divergenceSummary}</div>
                </div>
              ))}
              <div className="muted" style={{ marginTop: 12, fontStyle: "italic" }}>
                {report.latentRewardReplay.epistemicDisclaimer}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
