export type NodeType = "AGENT" | "CLAIM" | "ATTEMPT" | "OBSERVATION" | "ARTIFACT" | "CORRECTION" | "CLUSTER";
export type Verdict = "SUPPORTED" | "CONTRADICTED" | "UNRESOLVED";
export type EdgeType = "REPORTED_BY" | "RELIED_ON_BY" | "CONTRADICTED_BY" | "CORRECTED_BY" | "PRODUCED" | "SUPPORTED_BY";
/** How a link was established (Semantic-Judgments §4, §5) */
export type LinkBasis = "EXPLICIT_LINK" | "IDENTIFIER_MATCH" | "SEMANTIC_LINK";

export interface Judgment {
  id: string;
  questionId: string;
  questionVersion: number;
  model: string;
  inputRecordIds: string[];
  inputHash: string;
  answer: string;
  probability: number;
  cached: boolean;
  createdAt: string;
}
export interface GNode {
  id: string;
  label: string;
  nodeType: NodeType;
  verdict?: Verdict;
  modelAssisted?: boolean;
  confirmed?: boolean;
  sourceRecordId: string;
  previewText: string;
  time?: string;
  agent?: string;
  members?: string[];
  judgments?: Judgment[];
  props?: Record<string, string>;
  laterEvidence?: boolean;
}
export interface GEdge {
  id: string; source: string; target: string;
  edgeType: EdgeType; basis: LinkBasis; judgmentId?: string; isEndorsement?: boolean;
}
export interface Lead {
  id: string; route: number; routeName: string; score: number; episode: string; summary: string;
  sql: string; questions: string[]; passed: boolean; control?: boolean;
}
export interface Question {
  questionId: string; version: number; text: string; answerType: "BOOLEAN" | "CHOICE" | "SCORE";
  labels?: string[]; usedBy: string; threshold: number; precision: number; recall: number; evalRows: number; storedPrecision: number; storedRecall: number;
}

/** Payload of GET /api/graph/:fixture. */
export interface GraphPayload {
  episodeId: string;
  source: "fixture" | "mock";
  nodes: GNode[];
  edges: GEdge[];
}

export interface CoverageRow { eventType: string; count: number; role: string }
/** Payload of POST /api/leads. */
export interface LeadsPayload {
  leads: Lead[];
  judgments: Array<Judgment & { recordText: string }>;
  questions: Array<{ questionId: string; version: number; text: string; answerType: string }>;
  coverage: CoverageRow[];
  model: string;
  judge: { asked: number; cacheHits: number; parseErrors: number; modelErrors: number };
  notBuilt: string[];
}
