import type { StudioState } from "../studio/store";

/** Deterministic verbose report. Used when no LLM key is configured. */
export function buildOfflineReport(s: StudioState): string {
  const L: string[] = [];
  const claims = s.nodes.filter((n) => n.nodeType === "CLAIM");
  const obs = s.nodes.filter((n) => n.nodeType === "OBSERVATION").sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  const verdict = (id: string, v?: string) => s.overrides[id] ?? v ?? "UNRESOLVED";
  const r = s.forensics.report as any;

  L.push(`# Forensic report: ${s.dataset === "mock" ? "June 11 mailing-list incident (mock case)" : s.dataset}`, "");
  L.push("This report was assembled from the data currently loaded in the studio without a language model. Every statement below comes from a record, a rule result or a Step 2 output. Connect an OpenAI key to have the studio agent write a fuller narrative.", "");

  L.push("## Entities in scope", "");
  const byType: Record<string, number> = {};
  s.nodes.forEach((n) => (byType[n.nodeType] = (byType[n.nodeType] ?? 0) + 1));
  L.push(`The graph holds ${s.nodes.length} entities and ${s.edges.length} links: ${Object.entries(byType).map(([t, c]) => `${c} ${t.toLowerCase()}`).join(", ")}.`, "");

  L.push("## Timeline", "");
  [...s.nodes].filter((n) => n.time).sort((a, b) => a.time!.localeCompare(b.time!)).forEach((n) => L.push(`- ${n.time} ${n.nodeType.toLowerCase()}${n.agent ? ` by ${n.agent}` : ""}: ${n.previewText}`));
  L.push("");

  L.push("## Claims and how each verdict was reached", "");
  if (!claims.length) L.push("No claims were extracted from this episode.", "");
  for (const c of claims) {
    const v = verdict(c.id, c.verdict);
    L.push(`### ${c.label}`, "");
    L.push(`Made by ${c.agent ?? "an agent"} at ${c.time ?? "an unrecorded time"}. Verdict: ${v}${s.overrides[c.id] ? " (analyst override)" : ""}.`, "");
    const decisive = s.edges.find((e) => e.source === c.id && (e.edgeType === "CONTRADICTED_BY" || e.edgeType === "SUPPORTED_BY"));
    const o = decisive && s.nodes.find((n) => n.id === decisive.target);
    L.push(o ? `The deciding observation is "${o.label}" at ${o.time}, linked by ${decisive!.basis.replace("_", " ").toLowerCase()}. ${o.previewText}` : "No observation recorded before the claim speaks to it, so the verdict stays unresolved.", "");
    const earlier = obs.filter((x) => x.time && c.time && x.time < c.time && x.id !== o?.id);
    if (earlier.length) L.push(`Earlier observations, shown as context only: ${earlier.map((x) => `${x.time} ${x.label}`).join("; ")}.`, "");
    if (c.modelAssisted && !s.confirmed.includes(c.id)) L.push("Some inputs to this verdict came from a model and are still marked MODEL_ASSISTED until an analyst confirms them.", "");
  }

  if (r) {
    L.push("## Reasoning traces against what was reported", "");
    (r.traces ?? []).forEach((t: any) => {
      L.push(`### ${t.agentId} at ${t.timestamp}`, "", `Scratchpad (${t.recordId}): ${String(t.scratchpadContent).slice(0, 700)}`, "");
      if (t.contradictionDelta) L.push(`The public report for claim ${t.contradictionDelta.claimId} read: "${t.contradictionDelta.externalReportText}". The reasoning and the report point different ways, which makes this a lead for further work and not a finding.`, "");
    });
    L.push("## Competing hypotheses", "");
    (r.hypothesisSet?.hypotheses ?? []).forEach((h: any) => {
      L.push(`### ${h.category}${h.isBenignExplanation ? " (benign)" : ""}`, "", h.statement, "", `Confidence ${(h.confidence * 100).toFixed(0)}%${h.esi !== undefined ? `, evidentiary support index ${h.esi.toFixed(2)}` : ""}. Supporting records: ${h.supportingRecordIds.join(", ") || "none"}. Refuting records: ${h.refutingRecordIds.join(", ") || "none"}.`, "");
    });
    L.push("## Tests that would tell the hypotheses apart", "");
    (r.hypothesisSet?.discriminatingTests ?? []).forEach((t: any) => {
      L.push(`### ${t.testId}`, "", `Intervention (${t.intervention.targetType} on ${t.intervention.targetComponent}): ${t.intervention.deltaContent}`, "", `If ${t.targetHypothesisId} holds: ${t.expectedOutcomeUnderTarget}`, "", `If ${t.competingHypothesisId} holds: ${t.expectedOutcomeUnderCompeting}`, "", `Differences from the original run: ${t.environmentDelta.join("; ")}.`, "");
    });
    if (r.hypothesisSet?.epistemicDisclaimer) L.push(`> ${r.hypothesisSet.epistemicDisclaimer}`, "");
  } else {
    L.push("## Step 2", "", "Forensics has not been run for this episode, so there are no reasoning-trace comparisons or hypotheses yet. Run Step 2 from the Forensics Studio tab.", "");
  }

  L.push("## Open questions and next steps", "");
  const open = claims.filter((c) => verdict(c.id, c.verdict) === "UNRESOLVED");
  L.push(open.length ? `- ${open.length} claim(s) have no observation: ${open.map((c) => c.label).join("; ")}. Look for a tool output or file state that could settle them.` : "- Every extracted claim has a verdict.");
  L.push("- Confirm or override model-assisted verdicts after reading the underlying records.", "- Run the discriminating tests before drawing any conclusion about why an agent reported what it did.");
  return L.join("\n");
}
