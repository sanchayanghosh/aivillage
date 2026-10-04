import { studio } from "../studio/store";
import { actions, resolveNode } from "../studio/actions";
import { snapshot } from "./snapshot";
import type { NodeType } from "../graph/types";

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, any>) => Promise<string> | string;
}

const NODE_TYPES = ["AGENT", "CLAIM", "ATTEMPT", "OBSERVATION", "ARTIFACT", "CORRECTION", "CLUSTER"];
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const json = (v: unknown) => JSON.stringify(v, null, 1);
const need = (id: string) => {
  const n = resolveNode(id);
  if (!n) throw new Error(`No entity matches "${id}". Call get_studio_state with full=true to list entities.`);
  return n;
};

/** Trim the Step 2 report to what a model needs, keeping record ids. */
function trimReport(r: any) {
  if (!r) return null;
  return {
    episodeId: r.episodeId, model: r.model, provenance: r.provenance, goalSummary: r.goalSummary, traceNarrative: r.traceNarrative, causalReport: r.causalReport,
    claims: r.claims, traces: r.traces?.map((t: any) => ({ recordId: t.recordId, agentId: t.agentId, timestamp: t.timestamp, scratchpad: String(t.scratchpadContent).slice(0, 1200), contradictionDelta: t.contradictionDelta })),
    hypotheses: r.hypothesisSet?.hypotheses, tests: r.hypothesisSet?.discriminatingTests, disclaimer: r.hypothesisSet?.epistemicDisclaimer,
    simulation: r.simulation, latentRewardStructure: r.latentRewardStructure,
    latentRewardReplay: r.latentRewardReplay && { inferredOperativeReward: r.latentRewardReplay.inferredOperativeReward, evaluations: r.latentRewardReplay.evaluations?.map((e: any) => ({ archetype: e.archetype, verdict: e.verdict, confirmedScore: e.confirmedScore, divergenceSummary: e.divergenceSummary })) },
  };
}

export const STUDIO_TOOLS: AgentTool[] = [
  { name: "get_studio_state", description: "Read everything on screen: view, dataset, selection, graph filters, claims with verdicts, leads, forensics status, recent actions. Set full=true to also list every entity id.", inputSchema: obj({ full: { type: "boolean" } }), execute: (i) => json(snapshot(studio.get(), { full: Boolean(i.full) })) },
  {
    name: "inspect_entity", description: "Details for one entity (id or part of its label): preview text, properties, semantic judgments, and every link with its basis (EXPLICIT_LINK, IDENTIFIER_MATCH, SEMANTIC_LINK).",
    inputSchema: obj({ entity: { type: "string" } }, ["entity"]),
    execute: (i) => {
      const n = need(i.entity); const s = studio.get();
      const links = s.edges.filter((e) => e.source === n.id || e.target === n.id).map((e) => ({ type: e.edgeType, basis: e.basis, direction: e.source === n.id ? "out" : "in", other: s.nodes.find((x) => x.id === (e.source === n.id ? e.target : e.source))?.label }));
      return json({ ...n, verdictNow: s.overrides[n.id] ?? n.verdict, confirmed: s.confirmed.includes(n.id), links });
    },
  },
  { name: "select_entity", description: "Select an entity on the graph and show it in the Detail View.", inputSchema: obj({ entity: { type: "string" } }, ["entity"]), execute: (i) => { const n = need(i.entity); actions.selectNode(n.id, "agent"); return `Selected ${n.label}.`; } },
  { name: "clear_selection", description: "Clear the graph selection.", inputSchema: obj({}), execute: () => { actions.selectNode(null, "agent"); return "Selection cleared."; } },
  { name: "set_entity_visibility", description: "Show or hide all entities of one type on the graph.", inputSchema: obj({ type: { type: "string", enum: NODE_TYPES }, visible: { type: "boolean" } }, ["type", "visible"]), execute: (i) => { actions.toggleType(i.type as NodeType, i.visible); return `${i.type} is now ${i.visible ? "visible" : "hidden"}.`; } },
  { name: "set_layout", description: "Change graph layout: preset (episode), breadthfirst (hierarchical), cose (organic), circle, grid (block).", inputSchema: obj({ layout: { type: "string", enum: ["preset", "breadthfirst", "cose", "circle", "grid"] } }, ["layout"]), execute: (i) => { actions.setLayout(i.layout); return `Layout ${i.layout}.`; } },
  { name: "set_graph_option", description: "Toggle show_semantic_links (inferred links), show_later_evidence, or expand_clusters (endorsement clusters).", inputSchema: obj({ option: { type: "string", enum: ["show_semantic_links", "show_later_evidence", "expand_clusters"] }, value: { type: "boolean" } }, ["option", "value"]), execute: (i) => { const key = ({ show_semantic_links: "showSemantic", show_later_evidence: "showLater", expand_clusters: "expanded" } as const)[i.option as "show_semantic_links"]; actions.setOption(key, i.value); return `${i.option} = ${i.value}.`; } },
  { name: "zoom", description: "Zoom the graph: fit, in or out.", inputSchema: obj({ action: { type: "string", enum: ["fit", "in", "out"] } }, ["action"]), execute: (i) => { if (i.action === "fit") actions.fit(); else actions.zoom(i.action === "in" ? 1 : -1); return `Zoom ${i.action}.`; } },
  { name: "switch_view", description: "Switch between Step 1 Investigation (graph) and Step 2 Forensics Studio.", inputSchema: obj({ view: { type: "string", enum: ["investigation", "forensics"] } }, ["view"]), execute: (i) => { actions.switchView(i.view === "forensics" ? "forensics" : "graph"); return `Now showing ${i.view}.`; } },
  { name: "open_panel", description: "Open or close a bottom panel tab: leads, ledger, judge (semantic judge log), eval (measured detection), coverage, report.", inputSchema: obj({ tab: { type: "string", enum: ["leads", "ledger", "judge", "eval", "coverage", "report"] }, open: { type: "boolean" } }, ["tab"]), execute: (i) => { actions.openPanel(i.tab, i.open ?? true); return `Panel ${i.tab} ${i.open === false ? "closed" : "open"}.`; } },
  { name: "set_lead_threshold", description: "Set the Lead Finder score threshold between 0 and 1.", inputSchema: obj({ value: { type: "number" } }, ["value"]), execute: (i) => { actions.setLeadThreshold(Number(i.value)); return `Threshold ${Number(i.value).toFixed(2)}.`; } },
  { name: "confirm_claim", description: "Record analyst confirmation of the model-assisted inputs behind a claim verdict. Only when the analyst asked for it.", inputSchema: obj({ claim: { type: "string" } }, ["claim"]), execute: (i) => { const n = need(i.claim); actions.confirm(n.id); return `Confirmed ${n.label}.`; } },
  { name: "override_verdict", description: "Override a claim verdict. justification must be the analyst's reason, at least 10 characters.", inputSchema: obj({ claim: { type: "string" }, verdict: { type: "string", enum: ["SUPPORTED", "CONTRADICTED", "UNRESOLVED"] }, justification: { type: "string" } }, ["claim", "verdict", "justification"]), execute: (i) => { const n = need(i.claim); actions.override(n.id, i.verdict, i.justification); return `Verdict of ${n.label} is now ${i.verdict}.`; } },
  { name: "list_datasets", description: "List episode fixtures the backend can load (plus the built-in mock case).", inputSchema: obj({}), execute: () => json({ current: studio.get().dataset, available: ["mock", ...studio.get().graphFixtures] }) },
  { name: "load_dataset", description: "Load an episode fixture (for example real_aivillage_episode.jsonl) into the Step 1 graph, or 'mock'.", inputSchema: obj({ name: { type: "string" } }, ["name"]), execute: async (i) => { await actions.loadDataset(i.name); return `Loaded ${i.name}: ${studio.get().nodes.length} entities.`; } },
  { name: "import_transcript", description: "Import any agent transcript the analyst pasted (JSONL, JSON, OpenAI or Anthropic message formats, or plain text like 'agent-a: message'). Normalizes it, loads it into the graph, and returns the ingest report with warnings to relay to the analyst.", inputSchema: obj({ name: { type: "string" }, transcript: { type: "string" } }, ["transcript"]), execute: async (i) => json(await actions.importTranscript(i.name || "pasted-transcript", String(i.transcript))) },
  { name: "run_lead_finder", description: "Run the Semantic Judge Lead Finder (SQL-style pre-filter then fixed model questions) on the loaded transcript, then return the leads.", inputSchema: obj({}), execute: async () => { await actions.runLeadFinder(); const st = studio.get(); if (st.leadsError) throw new Error(st.leadsError); return json(st.leads?.leads ?? "The sample case uses built-in sample leads."); } },
  { name: "run_forensics", description: "Run Step 2 (traces, hypotheses, tests, replay) on the loaded transcript, or on a named bundled fixture. Takes up to a minute.", inputSchema: obj({ fixture: { type: "string" } }), execute: async (i) => {
    const st = studio.get();
    actions.switchView("forensics");
    await new Promise((r) => setTimeout(r, 200));
    const imported = st.dataset.startsWith("upload:");
    const name: string | undefined = i.fixture ?? (imported ? undefined : st.dataset === "mock" ? st.graphFixtures.find((f) => f.startsWith("june11")) : st.dataset !== "none" ? st.dataset : st.graphFixtures[0]);
    if (name) await actions.loadForensicsFixture(name);
    else if (!imported) throw new Error("Nothing is loaded. Import a transcript or name a fixture.");
    await actions.runForensics();
    const f = studio.get().forensics;
    if (f.error) throw new Error(f.error);
    return `Forensics finished for ${name ?? st.dataset.slice(7)}. Call get_forensics_report for the data.`;
  } },
  { name: "get_forensics_report", description: "Return the latest Step 2 report: claims, reasoning traces with divergences, narrative cards, hypotheses, discriminating tests, simulation, latent reward replay.", inputSchema: obj({}), execute: () => { const r = studio.get().forensics.report; return r ? json(trimReport(r)) : "No Step 2 report yet. Call run_forensics."; } },
  { name: "write_report", description: "Publish the final verbose report (markdown) into the Report panel. Call once, after gathering evidence.", inputSchema: obj({ markdown: { type: "string" } }, ["markdown"]), execute: (i) => { actions.saveReport(String(i.markdown), "agent"); return "Report published in the Report panel."; } },
];
