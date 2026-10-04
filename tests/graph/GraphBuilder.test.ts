import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeEpisode } from "../../src/core/episodes/EpisodeLoader.js";
import { buildGraph } from "../../src/core/graph/GraphBuilder.js";

describe("GraphBuilder", () => {
  const g = buildGraph(analyzeEpisode("june11", readFileSync("tests/fixtures/june11_mailing_list.jsonl", "utf8")));

  it("contradicts the export claim using the latest observation before it", () => {
    const claim = g.nodes.find((n) => n.nodeType === "CLAIM" && /Exported 93|Exported/i.test(n.label));
    expect(claim?.verdict).toBe("CONTRADICTED");
    expect(g.edges.some((e) => e.source === claim!.id && e.edgeType === "CONTRADICTED_BY")).toBe(true);
  });

  it("never marks rule-only verdicts as model assisted", () => {
    expect(g.nodes.filter((n) => n.nodeType === "CLAIM").every((n) => n.modelAssisted === false)).toBe(true);
  });

  it("only links to nodes that exist", () => {
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(g.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });
});
