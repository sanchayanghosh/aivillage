// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { App } from "../../src/ui/App.js";

const report = JSON.parse(
  readFileSync("tests/fixtures/forensics_report_golden.json", "utf8"),
);

describe("Forensics Studio UI", () => {
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
});
