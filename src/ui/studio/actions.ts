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
    studio.set({ overrides: { ...studio.get().overrides, [id]: verdict } }, `verdict of "${label(id)}" overridden to ${verdict} (${why.trim()})`);
  },

  async loadDataset(name: string) {
    if (name === "mock") {
      studio.set({ dataset: "mock", nodes: mockNodes, edges: mockEdges, selected: "claim_1", layout: "preset", hiddenTypes: [] }, "loaded the built-in mock case");
      return;
    }
    const res = await fetch(`/api/graph/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Could not build a graph for ${name}: ${(await res.json().catch(() => ({}))).error ?? res.status}`);
    const g = (await res.json()) as GraphPayload;
    studio.set({ dataset: name, nodes: g.nodes, edges: g.edges, selected: null, layout: "breadthfirst", hiddenTypes: [], expanded: false, fitTick: studio.get().fitTick + 1 }, `loaded dataset ${name} (${g.nodes.length} entities)`);
  },

  async refreshServer() {
    try {
      const [status, fx] = await Promise.all([fetch("/api/status").then((r) => r.json()), fetch("/api/fixtures").then((r) => r.json())]);
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
    const res = await fetch("/api/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript: raw, episodeId: name.replace(/\.[^.]+$/, "") }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `Import failed (${res.status})`);
    const g = body.graph as GraphPayload;
    studio.set({
      dataset: `upload:${name}`, nodes: g.nodes, edges: g.edges, selected: null, layout: "breadthfirst", hiddenTypes: [], expanded: false, report: null,
      imported: { name, jsonl: body.jsonl, report: body.report, at: Date.now() }, fitTick: studio.get().fitTick + 1,
    }, `imported transcript "${name}" (${body.report.format}, ${body.report.records} records, ${body.claims} claims)`);
    return body.report as import("./store").IngestReport;
  },
  openImport(open: boolean) { studio.set({ importOpen: open }); },

  saveReport(markdown: string, author: "agent" | "offline") {
    studio.set({ report: { markdown, author, at: new Date().toISOString() }, bottomTab: "report", bottomOpen: true }, `a ${author} report was written (${markdown.length} chars)`);
  },
  writeOfflineReport() {
    actions.saveReport(buildOfflineReport(studio.get()), "offline");
  },
};
