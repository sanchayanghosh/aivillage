import { useSyncExternalStore } from "react";
import type { GEdge, GNode, NodeType, LeadsPayload } from "../graph/types";

export type Layout = "preset" | "breadthfirst" | "cose" | "circle" | "grid";
export type BottomTab = "leads" | "ledger" | "judge" | "episodes" | "queue" | "eval" | "audit" | "coverage" | "report";
export type View = "graph" | "split" | "forensics";

export interface ForensicsHandlers {
  loadFixture: (name: string) => Promise<void>;
  run: () => Promise<void>;
}
export interface ForensicsState {
  fixtures: string[];
  episodeId: string;
  running: boolean;
  /** Opaque to the store: the Step 2 report as returned by /api/forensics. */
  report: unknown | null;
  error: string | null;
}
export interface IngestReport {
  format: string; inputItems: number; records: number; byRole: Record<string, number>; agents: string[]; scratchpads: number; syntheticTimestamps: boolean; warnings: string[];
}
export interface ServerStatus {
  llm: { configured: boolean; model: string };
  judge: { provider: "jev" | "openai" | null; model: string | null; classifierOutputs: number };
  huggingface: { tokenConfigured: boolean; datasetPresent: boolean };
  fixtures: number;
}

export interface StudioState {
  view: View;
  dataset: string; // "none", "mock", "upload:<name>" or a fixture file name
  nodes: GNode[];
  edges: GEdge[];
  selected: string | null;
  hiddenTypes: NodeType[];
  layout: Layout;
  showSemantic: boolean;
  showLater: boolean;
  expanded: boolean;
  confirmed: string[];
  overrides: Record<string, string>;
  bottomOpen: boolean;
  bottomTab: BottomTab;
  leadThreshold: number;
  fitTick: number;
  zoomTick: { n: number; dir: 1 | -1 | 0 };
  forensics: ForensicsState;
  status: ServerStatus | null;
  graphFixtures: string[];
  report: { markdown: string; author: "agent" | "offline"; at: string } | null;
  events: string[];
  imported: { name: string; jsonl: string; report: IngestReport; at: number } | null;
  importOpen: boolean;
  leads: LeadsPayload | null;
  leadsLoading: boolean;
  leadsError: string | null;
  episodeFilter: string | null;
  graphNote: string | null;
  activeJsonl: string;
  targetClaimId: string | null;
}

const initial: StudioState = {
  view: typeof location !== "undefined" && location.hash === "#forensics" ? "forensics" : "graph",
  dataset: "none",
  nodes: [],
  edges: [],
  selected: null,
  hiddenTypes: [],
  layout: "preset",
  showSemantic: true,
  showLater: true,
  expanded: false,
  confirmed: [],
  overrides: {},
  bottomOpen: true,
  bottomTab: "leads",
  leadThreshold: 0.5,
  fitTick: 0,
  zoomTick: { n: 0, dir: 0 },
  forensics: { fixtures: [], episodeId: "", running: false, report: null, error: null },
  status: null,
  graphFixtures: [],
  report: null,
  events: [],
  imported: null,
  importOpen: false,
  leads: null,
  leadsLoading: false,
  leadsError: null,
  episodeFilter: null,
  graphNote: null,
  activeJsonl: "",
  targetClaimId: null,
};

let state = initial;
const listeners = new Set<() => void>();
let handlers: ForensicsHandlers | null = null;

export const studio = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Apply a patch. `event` is a plain-English line kept for the agent's context. */
  set(patch: Partial<StudioState>, event?: string) {
    state = { ...state, ...patch, events: event ? [...state.events, `${new Date().toLocaleTimeString()} ${event}`].slice(-40) : state.events };
    listeners.forEach((l) => l());
  },
  patchForensics(patch: Partial<ForensicsState>) {
    state = { ...state, forensics: { ...state.forensics, ...patch } };
    listeners.forEach((l) => l());
  },
  registerForensics(h: ForensicsHandlers | null) {
    handlers = h;
  },
  forensicsHandlers: () => handlers,
};

export function useStudio<T>(selector: (s: StudioState) => T): T {
  return useSyncExternalStore(studio.subscribe, () => selector(state));
}

export interface ContradictedClaimFinding {
  id: string;
  label: string;
  previewText: string;
  time?: string;
  agent?: string;
  sourceRecordId: string;
  decisiveObservation?: {
    id: string;
    label: string;
    previewText: string;
    time?: string;
  };
}

export interface Level1AnalysisContext {
  episodeId: string;
  datasetName: string;
  source: "sample" | "fixture" | "upload" | "none";
  jsonl: string;
  totalRecords: number;
  totalClaims: number;
  supportedCount: number;
  contradictedCount: number;
  unresolvedCount: number;
  contradictedClaims: ContradictedClaimFinding[];
  targetClaim: ContradictedClaimFinding | null;
  targetEpisodeId: string | null;
  hasActiveAnalysis: boolean;
}

export function getLevel1Context(s: StudioState): Level1AnalysisContext {
  const claims = s.nodes.filter((n) => n.nodeType === "CLAIM");
  const getVerdict = (n: GNode) => s.overrides[n.id] ?? n.verdict ?? "UNRESOLVED";
  const supported = claims.filter((n) => getVerdict(n) === "SUPPORTED");
  const contradicted = claims.filter((n) => getVerdict(n) === "CONTRADICTED");
  const unresolved = claims.filter((n) => getVerdict(n) === "UNRESOLVED");

  let episodeId = s.dataset;
  if (s.dataset === "mock") episodeId = "june11_mailing_list";
  else if (s.dataset.startsWith("upload:")) episodeId = s.dataset.slice(7).replace(/\.[^.]+$/, "");
  else if (s.dataset.endsWith(".jsonl")) episodeId = s.dataset.replace(/\.jsonl$/, "");

  if (s.episodeFilter) {
    episodeId = s.episodeFilter;
  }

  const findDecisiveObs = (claimNode: GNode) => {
    const decisiveEdge = s.edges.find((e) => e.source === claimNode.id && (e.edgeType === "CONTRADICTED_BY" || e.edgeType === "SUPPORTED_BY"));
    if (decisiveEdge) {
      const o = s.nodes.find((n) => n.id === decisiveEdge.target);
      if (o) return { id: o.id, label: o.label, previewText: o.previewText, time: o.time };
    }
    const obsBefore = claimNode.time ? s.nodes.filter((n) => n.nodeType === "OBSERVATION" && n.time && n.time <= claimNode.time!) : [];
    if (obsBefore.length > 0) {
      const latest = obsBefore.reduce((a, b) => ((a.time ?? "") > (b.time ?? "") ? a : b));
      return { id: latest.id, label: latest.label, previewText: latest.previewText, time: latest.time };
    }
    return undefined;
  };

  const contradictedFindings: ContradictedClaimFinding[] = contradicted.map((c) => ({
    id: c.id,
    label: c.label,
    previewText: c.previewText,
    time: c.time,
    agent: c.agent,
    sourceRecordId: c.sourceRecordId,
    decisiveObservation: findDecisiveObs(c),
  }));

  // Target claim resolution:
  let targetNode = s.targetClaimId ? s.nodes.find((n) => n.id === s.targetClaimId) : null;
  if (!targetNode && s.selected) {
    const sel = s.nodes.find((n) => n.id === s.selected);
    if (sel && sel.nodeType === "CLAIM") targetNode = sel;
  }
  if (!targetNode && contradicted.length > 0) {
    targetNode = contradicted[0];
  }
  if (!targetNode && claims.length > 0) {
    targetNode = claims[0];
  }

  const targetClaim: ContradictedClaimFinding | null = targetNode ? {
    id: targetNode.id,
    label: targetNode.label,
    previewText: targetNode.previewText,
    time: targetNode.time,
    agent: targetNode.agent,
    sourceRecordId: targetNode.sourceRecordId,
    decisiveObservation: findDecisiveObs(targetNode),
  } : null;

  const hasActiveAnalysis = s.dataset !== "none" || s.nodes.length > 0 || Boolean(s.activeJsonl);

  return {
    episodeId: episodeId || "ep-active",
    datasetName: s.dataset === "mock" ? "June 11 2025 mailing-list incident" : s.dataset === "none" ? "No dataset loaded" : s.dataset.startsWith("upload:") ? s.dataset.slice(7) : s.dataset,
    source: s.dataset === "mock" ? "sample" : s.dataset.startsWith("upload:") ? "upload" : s.dataset.endsWith(".jsonl") ? "fixture" : "none",
    jsonl: s.activeJsonl,
    totalRecords: s.nodes.length,
    totalClaims: claims.length,
    supportedCount: supported.length,
    contradictedCount: contradicted.length,
    unresolvedCount: unresolved.length,
    contradictedClaims: contradictedFindings,
    targetClaim,
    targetEpisodeId: s.episodeFilter,
    hasActiveAnalysis,
  };
}
