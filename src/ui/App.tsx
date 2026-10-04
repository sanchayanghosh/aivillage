import React, { useEffect, useState } from "react";
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
  claims: Claim[];
  traces: Trace[];
  hypothesisSet: { hypotheses: Hypothesis[]; epistemicDisclaimer: string; discriminatingTests: Test[] };
  simulation: Simulation[];
  model: string;
  latentRewardReplay?: LatentRewardReplayReport;
}

export function App() {
  const [fixtures, setFixtures] = useState<string[]>([]);
  const [jsonl, setJsonl] = useState("");
  const [episodeId, setEpisodeId] = useState("ep-demo");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetch("/api/fixtures")
      .then((r) => r.json())
      .then((d) => setFixtures(d.fixtures))
      .catch(() => setFixtures([]));
  }, []);

  async function loadFixture(name: string) {
    const res = await fetch(`/api/fixtures/${name}`);
    const d = await res.json();
    setJsonl(d.content);
    setEpisodeId(name.replace(/\.jsonl$/, ""));
    setReport(null);
    setError(null);
  }

  async function runForensics() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/forensics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonl, episodeId }),
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
        <p>Step 2 deep dive: reasoning traces, competing hypotheses, discriminating counterfactual tests.</p>
      </header>

      <section className="panel">
        <h2>1. Select a dataset episode</h2>
        <div className="row">
          <label>
            Bundled fixture:&nbsp;
            <select onChange={(e) => e.target.value && loadFixture(e.target.value)} defaultValue="">
              <option value="" disabled>choose…</option>
              {fixtures.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
          <label>
            Upload JSONL: <input type="file" accept=".jsonl,.jsonl.gz,.jsonl,jsonl" onChange={onUpload} />
          </label>
        </div>
        <label>
          Episode ID: <input value={episodeId} onChange={(e) => setEpisodeId(e.target.value)} />
        </label>
        <textarea
          rows={8}
          placeholder="…or paste episode JSONL here"
          value={jsonl}
          onChange={(e) => setJsonl(e.target.value)}
        />
        <button disabled={!jsonl || running} onClick={runForensics}>
          {running ? "Running…" : "Run Forensics"}
        </button>
        {error && <p className="error">{error}</p>}
      </section>

      {report && (
        <>
          <p className="disclaimer">⚠️ {report.hypothesisSet.epistemicDisclaimer}</p>
          <p className="muted">Model backend: {report.model} · Episode: {report.episodeId}</p>

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
            <h2>6. Counterfactual simulation</h2>
            {report.simulation.map((s) => (
              <div key={s.agentPolicy} className="trace">
                <div><strong>Policy: {s.agentPolicy}</strong> → signal: <code>{s.signal}</code> (supports {s.supportsHypothesisCategory})</div>
                <div className="muted">Emitted claims: {s.emittedClaims.join(" | ")} · observed count: {s.observedCount ?? "—"}</div>
              </div>
            ))}
          </section>

          {report.latentRewardReplay && (
            <section className="panel">
              <h2>7. Latent Reward Reconstruction & Replay Rollouts</h2>
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
