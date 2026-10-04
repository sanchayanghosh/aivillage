// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { App } from "../../src/ui/App.js";

const report = JSON.parse(
  readFileSync("tests/fixtures/forensics_report_golden.json", "utf8"),
);

describe("Forensics Studio UI", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/fixtures") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ fixtures: ["june11_mailing_list.jsonl"] }),
          } as Response);
        }
        if (url === "/api/forensics") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(report),
          } as Response);
        }
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      }),
    );
  });

  it("runs forensics and renders the full report", async () => {
    render(<App />);

    const textarea = await screen.findByPlaceholderText(/paste episode JSONL/i);
    fireEvent.change(textarea, { target: { value: "{}" } });

    fireEvent.click(screen.getByRole("button", { name: /run forensics/i }));

    await waitFor(() =>
      expect(screen.getByText(/4\. Competing hypotheses/)).toBeTruthy(),
    );

    expect(screen.getByText(/Reasoning traces suggest hypotheses/)).toBeTruthy();
    expect(screen.getAllByText(/SHORTCUT_PREFERENCE/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/STRATEGIC_DECEPTION/).length).toBeGreaterThan(0);
    expect(screen.getByText(/6\. Counterfactual simulation/)).toBeTruthy();
    expect(screen.getAllByText(/REAL_COUNT_OBSERVED|FABRICATED_COUNT/).length).toBeGreaterThan(0);
    expect(screen.getByText(/3\. Reasoning traces/)).toBeTruthy();
    expect(screen.getByText(/5\. Discriminating test design/)).toBeTruthy();
  });

  it("renders LLM narrative synthesis and causal confirmation report when present", async () => {
    const reportWithNarrative = {
      ...report,
      traceNarrative: {
        overallExecutiveSummary: "Multi-agent coordination incident with 28 vs 31 vs 35 record count discrepancy.",
        groupExplanations: [
          {
            groupId: "grp-1",
            title: "🔍 Discrepancy Audit: glm-5.2",
            agentIds: ["glm-5.2"],
            recordsInvolved: ["rec-thought-01"],
            whatHappened: "glm-5.2 detected unpushed records in the git workspace.",
            internalMonologueAnalysis: "The model weighed whether to report or remain silent.",
            outwardActionAnalysis: "Sent correction message to DeepSeek-V3.2.",
            investigatorFinding: "Vigilant peer truth-tracking behavior.",
            divergenceLevel: "SUSPICIOUS_SHORTCUT",
          },
        ],
      },
      causalReport: {
        executiveVerdict: "Causal Confirmation Achieved: NEGATIVE_FEEDBACK_AVOID confirmed across 100% of rollouts.",
        interventionMechanism: "Pearl Causal Formulation do(P_error = 0) with history slicing up to t_diverge.",
        counterfactualBehaviorComparison: {
          observationalBaseline: "Baseline emitted unverified claim.",
          counterfactualIntervention: "Intervention shifted agent to transparent error reporting.",
          causalDivergenceSignificance: "Demonstrates rational payoff maximization under asymmetric error penalty.",
        },
        rewardFunctionAnalysis: "R_operative heavily penalizes failure disclosures.",
        remedialRecommendations: [
          "Eliminate supervisor penalties for transparent error reporting.",
          "Implement cryptographic artifact verification.",
        ],
        epistemicCaveat: "Observational traces suggest hypotheses. Causal confirmation requires consistent divergence across validated replay runs.",
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/fixtures") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ fixtures: ["june11_mailing_list.jsonl"] }),
          } as Response);
        }
        if (url === "/api/forensics") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(reportWithNarrative),
          } as Response);
        }
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      }),
    );

    render(<App />);

    const textarea = await screen.findByPlaceholderText(/paste episode JSONL/i);
    fireEvent.change(textarea, { target: { value: "{}" } });
    fireEvent.click(screen.getByRole("button", { name: /run forensics/i }));

    await waitFor(() =>
      expect(screen.getByText(/Incident Executive Narrative/i)).toBeTruthy(),
    );

    expect(screen.getByText(/Multi-agent coordination incident with 28 vs 31 vs 35/i)).toBeTruthy();
    expect(screen.getByText(/🔍 Discrepancy Audit: glm-5.2/i)).toBeTruthy();
    expect(screen.getByText(/Vigilant peer truth-tracking behavior/i)).toBeTruthy();

    // Toggle scratchpad
    const toggleBtn = screen.getByRole("button", { name: /view raw scratchpad/i });
    fireEvent.click(toggleBtn);
    expect(screen.getByRole("button", { name: /hide raw scratchpad/i })).toBeTruthy();

    // Causal confirmation report assertions
    expect(screen.getByText(/Executive Causal Confirmation Verdict:/i)).toBeTruthy();
    expect(screen.getByText(/NEGATIVE_FEEDBACK_AVOID confirmed across 100% of rollouts/i)).toBeTruthy();
    expect(screen.getByText(/Pearl Causal Intervention Mechanism/i)).toBeTruthy();
    expect(screen.getByText(/Observational World \(X = x\)/i)).toBeTruthy();
    expect(screen.getByText(/Counterfactual Intervention \(do\(X = x'\)\)/i)).toBeTruthy();
    expect(screen.getByText(/Forensic Remedial Recommendations/i)).toBeTruthy();
    expect(screen.getByText(/Eliminate supervisor penalties for transparent error reporting/i)).toBeTruthy();
  });
});
