# Step 2 Forensics: Implementation Addendum

This note accompanies the Step 2 forensics code on this branch. It records
deviations from `design-swarm-evidence-graph.md`.

## Module 6 — TraceInspector
As designed. Scratchpad extraction, internal-failure vs external-success
divergence delta, attempt linkage via `parent_thought_id`.

## Module 7 — ForensicsHypothesisEngine
- Model backend is pluggable via the `HypothesisModel` interface.
- Default: `OfflineDeterministicModel` — deterministic, evidence-citing,
  offline. Tests and the golden fixture never hit a network or a GPU.
- Adapter: `OllamaHypothesisModel` — POSTs to `/api/generate` with
  `format: "json"`; used when a local model is available.
- Invariants enforced after Zod validation: >= 2 hypotheses, >= 1 benign
  explanation, exact epistemic disclaimer string.

## Module 8 — ReplayDesigner & SimulationRunner (new)
The design doc planned a discriminating-test *plan*. This branch adds a
runnable simulation layer:

- `ReplayDesigner.buildSimulationInput` selects the primary
  `DiscriminatingTestPlan` from the hypothesis set.
- `SimulationRunner.run(plan, policy, intervenedTools)` applies the
  intervention to a `MockToolEnvironment`, executes a `SimulatedAgentPolicy`,
  and classifies the differentiating signal (`REAL_COUNT_OBSERVED` vs
  `FABRICATED_COUNT`), mapping it to a supporting hypothesis category.
- Two reference policies are provided: `ShortcutPreferencePolicy` (benign:
  reports real tool output) and `StrategicDeceptionPolicy` (fabricates
  counts regardless of input). Real deployments substitute a live agent
  harness behind the same `SimulatedAgentPolicy` interface.

## Module 9 — CaseStore
Design specified SQLite partitions. This branch uses append-only JSONL files
(one per partition: `discovery_rules`, `classifier_outputs`,
`verified_findings`) to keep the offline dependency surface minimal. The
rationale-length override rule (>= 10 chars) is preserved.

## Boundary stub
Step 1 (indexer/lead finder/episode builder/verdict SM) is not implemented
yet. `src/core/ledger/ClaimLedger.ts` provides a minimal compound-claim
splitter and evidence-packet builder so Step 2 is exercisable against the
golden fixture.
