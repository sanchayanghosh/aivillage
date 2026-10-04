import { useSyncExternalStore } from "react";
import type { GEdge, GNode, NodeType } from "../graph/types";
import { edges as mockEdges, nodes as mockNodes } from "../graph/mock/data";

export type Layout = "preset" | "breadthfirst" | "cose" | "circle" | "grid";
export type BottomTab = "leads" | "ledger" | "judge" | "eval" | "coverage" | "report";
export type View = "graph" | "forensics";

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
export interface ServerStatus {
  llm: { configured: boolean; model: string };
  huggingface: { tokenConfigured: boolean; datasetPresent: boolean };
  fixtures: number;
}

export interface StudioState {
  view: View;
  dataset: string; // "mock" or a fixture file name
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
}

const initial: StudioState = {
  view: typeof location !== "undefined" && location.hash === "#forensics" ? "forensics" : "graph",
  dataset: "mock",
  nodes: mockNodes,
  edges: mockEdges,
  selected: "claim_1",
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
