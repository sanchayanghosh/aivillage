import { apiFetch } from "./keys";
import { studio, type BottomTab, type Layout, type View } from "./store";
import type { NodeType, Verdict } from "../graph/types";
import { edges as mockEdges, nodes as mockNodes } from "../graph/mock/data";
import type { GraphPayload } from "../graph/types";
import { buildOfflineReport } from "../agent/offlineReport";

const label = (id: string) => studio.get().nodes.find((n) => n.id === id)?.label ?? id;

export function resolveNode(query: string) {
  const { nodes } = studio.get();
  const q = query.trim().toLowerCase();
  return nodes.find((n) => n.id.toLowerCase() === q) ?? nodes.find((n) => n.label.toLowerCase().includes(q)) ?? null;
}

export const actions = {
  selectNode(id: string | null, by: "user" | "agent" = "user") {
    studio.set({ selected: id }, id ? `${by} selected "${label(id)}"` : `${by} cleared the selection`);
  },
  switchView(view: View) {
    studio.set({ view }, `switched to ${view === "graph" ? "Step 1 Investigation" : "Step 2 Forensics Studio"}`);
  },
  toggleType(t: NodeType, visible?: boolean) {
    const hidden = new Set(studio.get().hiddenTypes);
    const show = visible ?? hidden.has(t);
    if (show) hidden.delete(t);
    else hidden.add(t);
    studio.set({ hiddenTypes: [...hidden] }, `${show ? "showed" : "hid"} ${t} entities`);
  },
  setLayout(layout: Layout) {
    studio.set({ layout }, `layout set to ${layout}`);
  },
  setOption(name: "showSemantic" | "showLater" | "expanded", value: boolean) {
    studio.set({ [name]: value } as never, `${name} = ${value}`);
  },
  fit() {
    studio.set({ fitTick: studio.get().fitTick + 1 }, "zoomed to fit");
  },
  zoom(dir: 1 | -1) {
    studio.set({ zoomTick: { n: studio.get().zoomTick.n + 1, dir } });
  },
  openPanel(tab: BottomTab, open = true) {
    studio.set({ bottomTab: tab, bottomOpen: open }, `${open ? "opened" : "closed"} the ${tab} panel`);
  },
  setLeadThreshold(v: number) {
    studio.set({ leadThreshold: Math.min(1, Math.max(0, v)) }, `lead threshold ${v.toFixed(2)}`);
  },
  confirm(id: string) {
    studio.set({ confirmed: [...new Set([...studio.get().confirmed, id])] }, `analyst confirmed model-assisted inputs for "${label(id)}"`);
  },
  override(id: string, verdict: Verdict, why: string) {
    if (why.trim().length < 10) throw new Error("Override needs a justification of at least 10 characters.");
    const node = studio.get().nodes.find((n) => n.id === id);
    // Persist in the audit store (verified_findings). The local override still applies if the server is unreachable.
    void apiFetch("/api/audit/finding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claimId: id, claimText: node?.label ?? id, originalVerdict: node?.verdict ?? "", overrideVerdict: verdict, justification: why }) }).catch(() => undefined);
    studio.set({ overrides: { ...studio.get().overrides, [id]: verdict } }, `verdict of "${label(id)}" overridden to ${verdict} (${why.trim()})`);
  },

  async loadDataset(name: string) {
    if (name === "none") {
      studio.set({ dataset: "none", nodes: [], edges: [], selected: null, leads: null, leadsError: null, report: null, imported: null }, "cleared the workspace");
      return;
    }
    if (name === "mock") {
      studio.set({ dataset: "mock", nodes: mockNodes, edges: mockEdges, selected: "claim_1", layout: "preset", hiddenTypes: [], leads: null, leadsError: null, report: null }, "loaded the built-in sample case");
      return;
    }
    const res = await apiFetch(`/api/graph/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Could not build a graph for ${name}: ${(await res.json().catch(() => ({}))).error ?? res.status}`);
    const g = (await res.json()) as GraphPayload;
    studio.set({ dataset: name, nodes: g.nodes, edges: g.edges, selected: null, leads: null, leadsError: null, report: null, layout: "breadthfirst", hiddenTypes: [], expanded: false, fitTick: studio.get().fitTick + 1 }, `loaded dataset ${name} (${g.nodes.length} entities)`);
  },

  async refreshServer() {
    try {
      const [status, fx] = await Promise.all([apiFetch("/api/status").then((r) => r.json()), apiFetch("/api/fixtures").then((r) => r.json())]);
      studio.set({ status, graphFixtures: fx.fixtures ?? [] });
    } catch {
      studio.set({ status: null, graphFixtures: [] });
    }
  },

  async runForensics() {
    const h = studio.forensicsHandlers();
    if (!h) throw new Error("Open the Forensics Studio tab once so it can register. Then retry.");
    await h.run();
  },
  async loadForensicsFixture(name: string) {
    const h = studio.forensicsHandlers();
    if (!h) throw new Error("Open the Forensics Studio tab once so it can register. Then retry.");
    await h.loadFixture(name);
  },

  /** Normalize any transcript on the server, then load it into both Step 1 and Step 2. */
  async importTranscript(name: string, raw: string) {
    const res = await apiFetch("/api/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript: raw, episodeId: name.replace(/\.[^.]+$/, "") }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `Import failed (${res.status})`);
    const g = body.graph as GraphPayload;
    studio.set({
      dataset: `upload:${name}`, nodes: g.nodes, edges: g.edges, graphNote: g.note ?? null, selected: null, leads: null, leadsError: null, layout: "breadthfirst", hiddenTypes: [], expanded: false, report: null,
      imported: { name, jsonl: body.jsonl, report: body.report, at: Date.now() }, fitTick: studio.get().fitTick + 1,
    }, `imported transcript "${name}" (${body.report.format}, ${body.report.records} records, ${body.claims} claims)`);
    return body.report as import("./store").IngestReport;
  },
  /** Run the Semantic Judge Lead Finder on whatever is loaded (needs the server LLM key). */
  async runLeadFinder() {
    const s = studio.get();
    if (s.dataset === "mock" || s.dataset === "none") { actions.openPanel("leads"); return; }
    const body = s.dataset.startsWith("upload:") ? { transcript: s.imported?.jsonl } : { fixture: s.dataset };
    studio.set({ leadsLoading: true, leadsError: null, bottomTab: "leads", bottomOpen: true });
    try {
      const res = await apiFetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `Lead Finder failed (${res.status})`);
      const g = d.graph as GraphPayload | undefined;
      studio.set({ leads: d, leadsLoading: false, episodeFilter: null, ...(g ? { nodes: g.nodes, edges: g.edges } : {}) }, `Lead Finder ran: ${d.leads.length} leads, ${d.judge.asked} model questions (${d.judge.cacheHits} cached)`);
    } catch (e) {
      studio.set({ leadsLoading: false, leadsError: e instanceof Error ? e.message : String(e) });
    }
  },
  setEpisodeFilter(id: string | null) {
    studio.set({ episodeFilter: id, selected: null, fitTick: studio.get().fitTick + 1 }, id ? `filtered the graph to episode ${id}` : "cleared the episode filter");
  },
  openImport(open: boolean) { studio.set({ importOpen: open }); },

  saveReport(markdown: string, author: "agent" | "offline") {
    studio.set({ report: { markdown, author, at: new Date().toISOString() }, view: "graph", bottomTab: "report", bottomOpen: true }, `a ${author} report was written (${markdown.length} chars)`);
  },
  writeOfflineReport() {
    actions.saveReport(buildOfflineReport(studio.get()), "offline");
  },
};
