# Plan versus built

Checked against `docs/prd-swarm-evidence-graph.md`, `docs/design-swarm-evidence-graph.md` and the semantic-judgments note.

## Step 1: Investigation

| Requirement | State |
| --- | --- |
| FR-1.1 low-memory ingestion of large archives | Partly. Python streams the gzipped dataset. The browser path handles pasted or uploaded transcripts, not 2.5M turns. |
| FR-1.2 provenance (record id, session, agent, time) | Built for imported transcripts. Original file offsets are not kept. |
| FR-1.3 coverage audit | Partly. Event types and the role each got are listed. Missing intervals, goals and schemas are not audited. |
| FR-1.4 hybrid Lead Finder | Built for routes 1, 2, 3, 4 and 6. Route 5 (goal divergence) needs session goals and is not built. |
| FR-2.1 episode bounding | Built (`EpisodeBuilder`): recorded references, shared identifiers, `Q_SAME_TASK`, merging with a written justification. Backward and forward expansion are the connected component, not a directed walk. |
| FR-2.2 claim decomposition | Built with the judge: sentence split, judge keeps completion sentences, then split on "and". Claim text is always a substring of the source. Free-text generation of claims is not used. |
| FR-2.3 verdict rule | Built. Latest relevant observation before the claim decides. Later evidence is shown, never decisive. |
| FR-2.4 interactive evidence graph | Built (Cytoscape). Endorsement clustering exists for the sample case and is not generated for imported transcripts. |
| FR-2.5 five-dimension queue ranker | Built (`QueueRanker`). Diversity uses token sets, not embeddings. Equal weights. 20% controls. |

## Step 2: Forensics

| Requirement | State |
| --- | --- |
| FR-3.1 trace and context extraction | Built. Reasoning is read from scratchpad, thinking, reasoning fields. |
| FR-3.2 competing hypotheses, benign first | Built, with fixed template wording. Confidences are placeholders. |
| FR-3.3 discriminating tests | Built as templates written around a failed-export tool. |
| Replay rollouts | Built. Runs against a real model when one answers, otherwise marked not run. |
| FR-3.4 audit and override ledger | Built (`AuditStore`, SQLite, three partitions). Ephemeral on Render free. |

## Semantic Judge and measured detection

The judge, its cache and the Lead Finder are built. Jev is the judge when a TypeSafe key is set. Everything else uses OpenAI.

Precision and recall are now computable: the Measured Detection panel samples rows blind, takes your labels (30 to 50, from the transcript or typed by hand), and compares them with the judge. What does not exist is a **shipped** evaluation set. Labels are human work on real data, so the repository contains none, and no precision or recall figure is claimed until someone labels rows. The agent can open the panel and fetch the metrics but has no tool to label rows.

Not built: Route 5 goal divergence (needs session goals), embedding-based diversity, and a hand-labelled set for the real AI Village data.

## Problems found in the inherited Step 2 code

- The Python engine printed replay results (`CONFIRMED`, 100 percent) that were hard-coded, and narrative text that was written for one episode but triggered by keywords like "28" or "35". It now reports replay as not run and is used only for the bundled AI Village episode, with a provenance note.
- The TypeScript replay fell back to scripted answers when no model was reachable and counted them as evidence. It now marks them as simulated and the evaluator returns "inconclusive".
- Tool-mock probes were sent as a bare `tool` message, which chat APIs reject. They are now injected as text.
