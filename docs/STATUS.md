# Plan versus built

Checked against `docs/prd-swarm-evidence-graph.md`, `docs/design-swarm-evidence-graph.md` and the semantic-judgments note.

## Step 1: Investigation

| Requirement | State |
| --- | --- |
| FR-1.1 low-memory ingestion of large archives | Partly. Python streams the gzipped dataset. The browser path handles pasted or uploaded transcripts, not 2.5M turns. |
| FR-1.2 provenance (record id, session, agent, time) | Built for imported transcripts. Original file offsets are not kept. |
| FR-1.3 coverage audit | Partly. Event types and the role each got are listed. Missing intervals, goals and schemas are not audited. |
| FR-1.4 hybrid Lead Finder | Built for routes 1, 2, 3, 4 and 6. Route 5 (goal divergence) needs session goals and is not built. |
| FR-2.1 episode bounding | Not built. One transcript is one episode. No backward or forward expansion, no `Q_SAME_TASK` linking. |
| FR-2.2 claim decomposition | Rule-based splitting on "and". Model extraction (`Q_EXTRACT_CLAIMS`) is not built. |
| FR-2.3 verdict rule | Built. Latest relevant observation before the claim decides. Later evidence is shown, never decisive. |
| FR-2.4 interactive evidence graph | Built (Cytoscape). Endorsement clustering exists for the sample case and is not generated for imported transcripts. |
| FR-2.5 five-dimension queue ranker | Not built. |

## Step 2: Forensics

| Requirement | State |
| --- | --- |
| FR-3.1 trace and context extraction | Built. Reasoning is read from scratchpad, thinking, reasoning fields. |
| FR-3.2 competing hypotheses, benign first | Built, with fixed template wording. Confidences are placeholders. |
| FR-3.3 discriminating tests | Built as templates written around a failed-export tool. |
| Replay rollouts | Built. Runs against a real model when one answers, otherwise marked not run. |
| FR-3.4 audit and override ledger | Overrides need a ≥10 character reason and live in the session. The three-partition SQLite store is not built. |

## Why the Semantic Judge was not built at first

It was a scoping call, not a blocker. The first pass was UI only. The judge needs a model endpoint and a place to cache answers, and both exist now. It is built (`src/core/semantic`, `src/core/discovery/LeadFinder.ts`).

What is still missing is the part that makes a detector trustworthy: **measured precision and recall**. The design asks for 30 to 50 real rows per question, labelled by hand before anyone sees the model's answers. That labelling is human work on real data. Writing labels myself, or having the model label its own output, would produce numbers that mean nothing. So the Measured Detection tab says "unmeasured" and shows no figures.

The second limit is extraction quality. `dataset:extract` currently builds one episode fixture from the real tables. Graph quality on real data depends on how well that extraction chooses and links episodes, which is the `Q_SAME_TASK` work above.

## Problems found in the inherited Step 2 code

- The Python engine printed replay results (`CONFIRMED`, 100 percent) that were hard-coded, and narrative text that was written for one episode but triggered by keywords like "28" or "35". It now reports replay as not run and is used only for the bundled AI Village episode, with a provenance note.
- The TypeScript replay fell back to scripted answers when no model was reachable and counted them as evidence. It now marks them as simulated and the evaluator returns "inconclusive".
- Tool-mock probes were sent as a bare `tool` message, which chat APIs reject. They are now injected as text.
