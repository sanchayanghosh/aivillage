// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { App } from "../../src/ui/App.js";
import { studio } from "../../src/ui/studio/store.js";
import { actions } from "../../src/ui/studio/actions.js";
import Detail from "../../src/ui/graph/Detail.js";
import { nodes as mockNodes, edges as mockEdges } from "../../src/ui/graph/mock/data.js";

const report = JSON.parse(
  readFileSync("tests/fixtures/forensics_report_golden.json", "utf8"),
);

describe("Level 1 to Level 2 Analysis Cohesion & Handoff", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/status") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                llm: { configured: true, model: "gpt-5" },
                judge: { provider: null, model: null, classifierOutputs: 0 },
                huggingface: { tokenConfigured: false, datasetPresent: false },
                fixtures: 1,
              }),
          } as Response);
        }
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
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as Response);
      }),
    );
  });

  it("Level 2 Forensics starts directly from active Level 1 investigation", async () => {
    // 1. Level 1 loads the sample incident
    await actions.loadDataset("mock");

    // 2. Render Level 2 Forensics Studio (App component)
    render(<App />);

    // 3. Verify Level 2 displays Level 1 Analysis Grounding
    expect(screen.getByText(/Level 1 Analysis Grounding/i)).toBeTruthy();
    expect(screen.getAllByText(/June 11 2025 mailing-list incident/i).length).toBeGreaterThan(0);

    // 4. Verify Level 1 findings are summarized in Level 2
    expect(screen.getByText("Entities")).toBeTruthy();
    expect(screen.getByText("Claims")).toBeTruthy();
    expect(screen.getAllByText(/Contradicted/i).length).toBeGreaterThan(0);

    // 5. Verify targeted anomaly from Level 1 is highlighted
    expect(screen.getByText(/Targeted Anomaly from Level 1:/i)).toBeTruthy();
    expect(screen.getAllByText(/Exported contact list/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/contacts_template\.csv/i).length).toBeGreaterThan(0);

    // 6. Verify back-to-L1 navigation exists
    const backBtn = screen.getByRole("button", { name: /back to step 1/i });
    expect(backBtn).toBeTruthy();

    // 7. Verify Run Forensics on Level 1 Episode button is present and runs
    const runBtn = screen.getByRole("button", { name: /run forensics/i });
    expect(runBtn).toBeTruthy();
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText(/4\. Competing hypotheses/i)).toBeTruthy();
    });
  });

  it("switching targeted anomaly in Level 1 updates Level 2 focus", async () => {
    await actions.loadDataset("mock");

    // Explicitly target claim_2 in Level 1
    actions.setTargetClaim("claim_2");

    render(<App />);

    expect(screen.getByText(/Targeted Anomaly from Level 1:/i)).toBeTruthy();
    expect(screen.getAllByText(/Contact count equals 93/i).length).toBeGreaterThan(0);
  });

  it("Detail view 'Investigate claim in Forensics Studio' transitions directly to Step 2 with targeted claim", async () => {
    await actions.loadDataset("mock");
    actions.switchView("graph");

    const claim1 = mockNodes.find((n) => n.id === "claim_1")!;

    render(
      <Detail
        onForensics={() => actions.investigateInForensics(claim1.id)}
        node={claim1}
        nodes={mockNodes}
        edges={mockEdges}
        confirmed={new Set()}
        overrides={{}}
        onSelect={() => {}}
        onConfirm={() => {}}
        onOverride={() => {}}
      />
    );

    // Find the Step 2 action button in Detail view
    const detailBtn = screen.getByRole("button", { name: /investigate claim in forensics studio/i });
    expect(detailBtn).toBeTruthy();

    // Click to transition into Step 2
    fireEvent.click(detailBtn);

    expect(studio.get().view).toBe("forensics");
    expect(studio.get().targetClaimId).toBe("claim_1");
  });

  it("Detail view split button transitions directly to Split View with both Graph and Forensics", async () => {
    await actions.loadDataset("mock");
    actions.switchView("graph");

    const claim1 = mockNodes.find((n) => n.id === "claim_1")!;

    render(
      <Detail
        onForensics={() => actions.investigateInForensics(claim1.id, false)}
        onSplitForensics={() => actions.investigateInForensics(claim1.id, true)}
        node={claim1}
        nodes={mockNodes}
        edges={mockEdges}
        confirmed={new Set()}
        overrides={{}}
        onSelect={() => {}}
        onConfirm={() => {}}
        onOverride={() => {}}
      />
    );

    const splitBtn = screen.getByRole("button", { name: /investigate claim in forensics studio \(split view\)/i });
    expect(splitBtn).toBeTruthy();

    fireEvent.click(splitBtn);

    expect(studio.get().view).toBe("split");
    expect(studio.get().targetClaimId).toBe("claim_1");
  });

  it("clicking cross-link in Forensics selects the corresponding node in Level 1 graph", async () => {
    await actions.loadDataset("mock");
    actions.setTargetClaim("claim_1");

    render(<App />);

    const linkBtn = screen.getByRole("button", { name: /highlight claim in graph/i });
    expect(linkBtn).toBeTruthy();

    fireEvent.click(linkBtn);

    expect(studio.get().selected).toBe("claim_1");
  });
});

