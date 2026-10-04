import type { StudioState } from "../studio/store";
import { leads, questions, judgments, unmappedEventTypes } from "../graph/mock/data";

/** Everything the agent can see about the studio, as plain JSON. */
export function snapshot(s: StudioState, opts: { full?: boolean } = {}) {
  const sel = s.nodes.find((n) => n.id === s.selected) ?? null;
  const claims = s.nodes.filter((n) => n.nodeType === "CLAIM").map((c) => ({
    id: c.id, text: c.label, agent: c.agent, time: c.time,
    verdict: s.overrides[c.id] ?? c.verdict, overridden: Boolean(s.overrides[c.id]),
    basis: c.modelAssisted && !s.confirmed.includes(c.id) ? "MODEL_ASSISTED" : "RULE_ONLY_OR_CONFIRMED",
  }));
  const forensics = s.forensics;
  return {
    view: s.view,
    dataset: s.dataset,
    selected: sel && { id: sel.id, type: sel.nodeType, label: sel.label, verdict: sel.verdict, preview: sel.previewText },
    graph: {
      entities: s.nodes.length, links: s.edges.length,
      byType: Object.fromEntries([...new Set(s.nodes.map((n) => n.nodeType))].map((t) => [t, s.nodes.filter((n) => n.nodeType === t).length])),
      hiddenTypes: s.hiddenTypes, layout: s.layout, showSemanticLinks: s.showSemantic, showLaterEvidence: s.showLater, clustersExpanded: s.expanded,
    },
    claims,
    ...(opts.full ? { entities: s.nodes.map((n) => ({ id: n.id, type: n.nodeType, label: n.label })) } : {}),
    panels: { open: s.bottomOpen, tab: s.bottomTab, leadThreshold: s.leadThreshold },
    leads: s.dataset === "mock" ? leads.map((l) => ({ id: l.id, route: l.routeName, score: l.score, emits: l.score >= s.leadThreshold, episode: l.episode, summary: l.summary, control: Boolean(l.control) })) : "Lead Finder runs on the mock case only for now.",
    semanticQuestions: s.dataset === "mock" ? questions.map((q) => ({ id: `${q.questionId}@${q.version}`, precision: q.precision, recall: q.recall, evalRows: q.evalRows })) : undefined,
    judgmentsLogged: s.dataset === "mock" ? judgments.length : 0,
    unmappedEventTypes: s.dataset === "mock" ? unmappedEventTypes.filter((u) => !u.mapped).map((u) => u.eventType) : [],
    forensics: {
      fixtures: forensics.fixtures, episodeId: forensics.episodeId, running: forensics.running, error: forensics.error,
      hasReport: Boolean(forensics.report),
    },
    server: s.status,
    reportWritten: Boolean(s.report),
    recentUserAndAgentActions: s.events.slice(-12),
  };
}
