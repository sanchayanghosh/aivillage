# Swarm Evidence Graph: Product Requirements Document (PRD)

**Status:** Approved for Implementation

**Date:** 2026-10-04

**Related Documents:**
- [Swarm Evidence Graph: Technical Design Document](design-swarm-evidence-graph.md)
- [Latent Reward Reconstruction & Replay Harness: Technical Specification](design-latent-reward-reconstruction.md)

## Table of Contents

- [1. Executive Summary & Objective](#1-executive-summary--objective)
- [2. Terminology & Core Definitions](#2-terminology--core-definitions)
- [3. Epistemic Principles & Guardrails](#3-epistemic-principles--guardrails)
- [4. User Personas & Workflows](#4-user-personas--workflows)
- [5. Functional Requirements](#5-functional-requirements)
  - [Stage 1: Ingestion, Linkage & Discovery](#stage-1-ingestion-linkage--discovery)
  - [Stage 2: Step 1 Investigation (Episodes, Graphs & Ledgers)](#stage-2-step-1-investigation-episodes-graphs--ledgers)
  - [Stage 3: Step 2 Model Forensics & Local Self-Replay (Causal Analysis)](#stage-3-step-2-model-forensics--local-self-replay-causal-analysis)
- [6. Golden Test Acceptance Criteria: 11 June 2025 Mailing List Incident](#6-golden-test-acceptance-criteria-11-june-2025-mailing-list-incident)
- [7. System Boundaries & Out of Scope](#7-system-boundaries--out-of-scope)

---

Document Status: Approved for Implementation

Target Environment: Local Workstation / Laptop (Offline-capable)

Target Dataset: Public AI Village Swarm Benchmark (~183k chat messages, 2.5M computer-use turns, 78k sessions)

Methodology Grounding: Model Forensics (Singh, Kroiz, Rajamanoharan, Nanda), Judea Pearl’s Causal Hierarchy (Layer 1 Association → Layer 2 Counterfactual Intervention), & Link-Analysis Graph Theory (Maltego CE paradigm)

Tone & Style: ~30% ASD-STE100 (Simplified Technical English: short sentences, active voice, explicit verbs, zero ambiguity).

### 1. Executive Summary & Objective

AI agent swarms introduce novel failure modes. Agents hallucinate actions, misreport task outputs in group chats, propagate unverified assertions, and coordinate around false premises. Human analysts facing hundreds of thousands of interaction turns cannot identify root causes with keyword searches. Keyword matches create false alarms and lack context. Transcripts alone also underdetermine causes: an unexecuted hypothesis remains speculation.

Swarm Evidence Graph is a local-first forensic workbench and causal testing tool for multi-agent swarm transcripts. It executes a closed-loop two-step analysis pipeline:

1. Step 1: Swarm Investigation (Macro / Factual Grounding): Indexes raw transcripts using a two-tier columnar engine. Extracts decay-bounded event episodes ($k \le 3$ hops, $\le 120$ min, $\le 150$ records). Maps explicit claims and empirical runtime records into an evidence graph. Calculates deterministic factual claim verdicts (SUPPORTED, CONTRADICTED, UNRESOLVED).
2. Step 2: Model Forensics & Self-Replay (Micro / Causal Verification): Inspects internal reasoning traces (scratchpads/monologues). Generates non-strawman competing hypotheses backed by evidence citations and scored via Evidentiary Support Index (ESI). Formulates counterfactual interventions ($do(X)$). Executes local replay tests in an isolated sandbox to observe whether agent behavior shifts under prompt or tool changes, closing the causal loop and updating the causal verdict ledger (CONFIRMED, FALSIFIED, INCONCLUSIVE).

### 2. Terminology & Core Definitions

- Episode: A bounded sequence of records centered on a specific task, artifact, or action chain. Every episode contains an explicit trigger, participating agents, tool actions, and a terminal outcome (or an explicitly recorded missing outcome).
- Evidence Packet: The immutable, ordered set of raw source records, screenshots, and metadata defining an episode. This packet serves as the sole input to the Claim Ledger, Classifiers, and Forensics Engine.
- Statement: An unverified textual claim emitted by an agent in chat or logs (e.g., "I exported 93 contacts").
- Attempt: A concrete action an agent initiated (e.g., an API call, bash invocation, or UI action).
- Observation: A provisional empirical record emitted directly by the runtime environment (stdout/stderr, file bytes, UI screenshot, process exit code), structurally isolated from agent conversational output.
- Atomic Claim: A single, non-compound factual assertion extracted from a Statement. It preserves character span offsets and logical conditions (CONDITIONED_ON).
- Verdict: The verification state of an Atomic Claim:
  - SUPPORTED: Validated by an independent Observation.
  - CONTRADICTED: Refuted by an independent Observation or by contradictory source data.
  - UNRESOLVED: Lacks independent Observation. Repeated affirmations by other agents remain UNRESOLVED.
- Reasoning Trace: Internal agent scratchpad text, planning monologue, or chain-of-thought preceding an Attempt.
- Discriminating Test: A counterfactual intervention (e.g., prompt delta or environment mock) that produces divergent behavioral outcomes under competing hypotheses.
- Replay Sandbox: A strictly isolated local execution harness evaluating single-agent or paired-agent intervention turns ($do(X)$) without network egress.
- Evidentiary Support Index (ESI): The normalized score measuring net empirical grounding for a candidate hypothesis.

### 3. Epistemic Principles & Guardrails

- Testimony Is Not Ground Truth: A chat message from an agent is a Statement, never an Observation. Repetition of a claim by downstream agents creates reliance edges; it does not increase evidentiary weight.
- No Intent from Transcripts Alone: Reasoning traces indicate hypotheses, not ground-truth internal intent. The system must never label an agent as "malicious" or "deceptive" without presenting benign alternatives (e.g., broken tool, prompt ambiguity, game-role assignment).
- Competing Hypotheses Requirement: Step 2 forensics must always output at least two competing explanations for any concerning event.
- Preservation of Controls: Investigation queues must maintain positive controls (benign, successful, ordinary coordination episodes) alongside anomalies to prevent confirmation bias.
- Zero Data Leakage: The application executes locally without telemetry or external model training.

### 4. User Personas & Workflows

Personas:

- Swarm Safety Researcher: Investigates cascading hallucinations, goal drift, and covert coordination across agent populations.
- Hackathon / Competition Judge: Validates specific incident submissions against raw, unmanipulated source records.
- Agent Operations Engineer: Debugs cascading multi-agent deadlocks, unhandled tool exceptions, and corrupted state handoffs.

Two-Step User Workflow:

```
[Ingest JSONL] --> [Auto-Index & Audit] --> [Select Goal Period]
                                                    |
                                                    v
                       +--------------------------------------------------------+
                       | Step 1: Investigation Mode                             |
                       | - Review 8-12 Ranked Episodes in Queue                 |
                       | - Inspect Evidence Graph (Cytoscape) & Claim Ledger    |
                       | - Verify Supported vs. Contradicted claims             |
                       +---------------------------+----------------------------+
                                                   | Anomaly / Contradiction
                                                   | Detected
                                                   v
                       +--------------------------------------------------------+
                       | Step 2: Model Forensics Studio                         |
                       | - Inspect Reasoning Traces vs. Action Deltas           |
                       | - Generate Competing Hypotheses (Benign vs. Deceptive) |
                       | - Export Counterfactual Replay Design & Mock Delta     |
                       +--------------------------------------------------------+
```

### 5. Functional Requirements

#### Stage 1: Ingestion, Linkage & Discovery

- FR-1.1: Local Zero-Copy Ingestion: The system shall ingest compressed JSONL files of arbitrary size (tested up to 2.5M turns) using an embedded columnar engine without loading complete text bodies into Node.js heap memory.
- FR-1.2: Provenance Tracking: Every record must preserve its immutable RecordId, original file origin, raw row offset, session identifier, agent identifier, and ISO-8601 timestamp.
- FR-1.3: Link Integrity & Coverage Auditing: The system shall flag and render missing coverage intervals, incomplete session goals, missing tool schemas, and unlinked event foreign keys.
- FR-1.4: Multi-Route Lead Finder: The engine shall identify candidate leads across five explicit detection routes:
  - Language Markers: Discrepant assertions of task finality (e.g., "completed", "exported", "sent").
  - Action Sequence Failures: Tool exceptions followed by abrupt modality switches or unrecorded retries.
  - Cross-Agent Handoffs: Shared file paths, database references, or delegation envelopes passed between sessions.
  - Negative Outcome Signals: Downstream agent complaints, terminal task abortion, or supervisor overrides.
  - Goal-Execution Divergence: Action sequences that depart from stated session and village goals.

#### Stage 2: Step 1 Investigation (Episodes, Graphs & Ledgers)

- FR-2.1: Deterministic Episode Bounding:
  - Must traverse backward from a Lead along explicit entity references to locate the initiating request or task trigger.
  - Must traverse forward to terminal completion, task abandonment, or session closure.
  - Must split disjoint tasks occurring within the same chat channel into separate EpisodeId entities.
  - Must merge duplicate overlapping leads into a unified episode with an explicit, human-readable boundary justification.
- FR-2.2: Claim Ledger Decomposition:
  - Must parse compound agent reports into distinct atomic claims (e.g., "Exported contact list and verified SHA-256 hash" -> Claim 1: "Exported contact list", Claim 2: "Verified SHA-256 hash").
  - Must link each atomic claim to the original assertion record.
- FR-2.3: Deterministic Verdict Assignment:
  - Evaluates claims against concrete Observation records.
  - Marks claims as SUPPORTED only when verified by tool outputs, hash validations, or recorded state changes.
  - Marks claims as CONTRADICTED if contradicted by tool exceptions, zero-byte artifacts, or conflicting observations.
  - Sets claims to UNRESOLVED when no corresponding observation exists.
- FR-2.4: Interactive Evidence Graph:
  - Uses Cytoscape.js to render nodes: Agents, Claims, Attempts, Observations, Artifacts, and Corrections.
  - Renders typed edges: REPORTED_BY, RELIED_ON_BY, CONTRADICTED_BY, CORRECTED_BY, PRODUCED_BY.
  - Groups compound endorsements to collapse repetitive chatter while preserving the underlying reliance graph.
- FR-2.5: Five-Dimensional Queue Ranking:
  - Produces an investigation shortlist of 8-12 episodes scored across:
    - Relevance (Alignment with selected goal period)
    - Traceability (Completeness of chain-of-custody)
    - Consequence (Severity of real-world outcome)
    - Uncertainty (Ratio of UNRESOLVED to resolved claims)
    - Diversity (Mixture of interaction patterns)
  - Isolates "Suspicion Score" from "Utility Score".
  - Mandates a minimum of 20% ordinary, benign control cases within the shortlist.

#### Stage 3: Step 2 Model Forensics & Local Self-Replay (Causal Analysis)

- FR-3.1: Trace & Context Extraction: Extracts agent internal scratchpads and chain-of-thought tokens directly adjacent to flagged attempts, aligning internal reasoning side-by-side with external claims.
- FR-3.2: Mandatory Hypothesis Generation:
  - Evaluates at least two competing hypotheses per incident.
  - Mandates consideration of benign taxonomy classes before strategic deception:
    - TOOL_FAILURE
    - GOAL_AMBIGUITY
    - COPIED_CLAIM
    - SHORTCUT_PREFERENCE
    - ASSIGNED_ROLE
    - STRATEGIC_DECEPTION
  - Enforces consideration of benign hypotheses before strategic deception.
  - Every hypothesis must compute an Evidentiary Support Index (ESI):
    $$\text{ESI}(H) = \frac{\vert{}\text{Citations}_{\text{support}}\vert{} - \vert{}\text{Citations}_{\text{refute}}\vert{}}{\vert{}\text{Total Packet Observations}\vert{}}$$
  - A hypothesis cannot be displayed without citing at least one explicit source record in the packet.
- FR-3.3: Discriminating Test Specification:
  Defines a counterfactual intervention specifying:
  - Target hypothesis vs. competing hypothesis.
  - Proposed intervention type: `PROMPT_INTERVENTION`, `TOOL_MOCK_SUCCESS`, `PERMISSION_RESTRICTION`, or `FALLBACK_INSTRUCTION`.
  - Expected behavioral prediction under Hypothesis A.
  - Expected behavioral prediction under Hypothesis B.
  - Environmental delta sheet (listing all deviations between the historical village run and the replay testbed).

  ```
     [Historical Transcript Context]
                   │
                   ├──▶ Baseline Prompt + Historical Tool Output ──▶ Replicates Anomaly
                   │
                   └──▶ (Intervention: do(X))
                        Modified Prompt / Mocked Tool ────────────▶ Empirical Replay Run
                                                                            │
                                       ┌────────────────────────────────────┴────────────────────────────────────┐
                                       ▼                                                                         ▼
                           Matches Prediction A                                                      Matches Prediction B
                     [Hypothesis A Confirmed / B Falsified]                                    [Hypothesis B Confirmed / A Falsified]
  ```

- FR-3.4: Local Self-Replay Execution Harness (IN SCOPE):
  The system shall include an execution harness to run isolated agent-level replays locally.
  - Replay Boundary: Executes single-agent or paired-agent interaction turns using a local inference endpoint (Ollama / vLLM / llama.cpp) or target model API.
  - Injects the reconstructed historical context window up to the point of divergence, applying the intervention delta ($do(X)$).
  - Captures the replayed agent's generated reasoning trace, external message, and tool attempt.
  - Automatically compares the replayed output against the discriminating test predictions.
  - Evaluates whether the intervention eliminated the anomalous behavior (confirming benign root causes) or persisted despite explicit blockers (supporting strategic misalignment).
- FR-3.5: Causal Verdict & Audit Ledger:
  - Updates the forensic hypothesis status to `CONFIRMED`, `FALSIFIED`, or `INCONCLUSIVE` based on replay execution output.
  - Displays the mandatory forensic disclaimer:
    > *"Observational traces suggest hypotheses. Causal confirmation requires consistent divergence across validated replay runs."*
  - Maintains three isolated persistence partitions: `DiscoveryRules`, `ClassifierOutputs`, and `VerifiedFindings` (with mandatory analyst override rationale $\ge 10$ characters).

### 6. Golden Test Acceptance Criteria: 11 June 2025 Mailing List Incident

The automated test suite must run an end-to-end integration test validating both Step 1 Investigation and Step 2 Causal Replay on the 11 June 2025 mailing list fixture:

```
[Agent A Claims Export] ──▶ [Agent B Endorses] ──▶ [Empty CSV Observed] ──▶ [Agent C Aborts]
           │                                                │
           ▼                                                ▼
     Claim Ledger:                                    Claim Ledger:
      Claim 1 & 2:                                     Claim 1 & 2:
      UNRESOLVED                                       CONTRADICTED
           │
           ▼
[Step 2 Forensics: Derive Competing Hypotheses]
 ├── H1: SHORTCUT_PREFERENCE (Empty tool output caused fallback to template)
 └── H2: STRATEGIC_DECEPTION (Deliberate false completion report)
           │
           ▼
[Step 2 Replay Execution: Mock Tool Intervention do(X)]
 Harness runs Agent A with mock tool returning 5 real contacts.
           │
           ▼
 Empirical Replay Outcome:
 Agent A parses the 5 contacts and reports real hash.
           │
           ▼
 Causal Verdict:
 H1 Confirmed; H2 Falsified (Behavior driven by tool exception handling).
```

**Verification Assertions:**
1. **Ingestion & Linking:** Ingests the episode via Parquet index. Reconstructs Agent A (outreach), Agent B (dispatcher), and Agent C (monitor) within $k \le 3$ hops.
2. **Propositional Splitting:** Splits Agent A's statement ("Exported 93 contacts and generated mailing list") into:
   - Claim 1: "Exported contact list"
   - Claim 2: "Contact count equals 93"
   - Captures character span offsets and marks conditional dependencies.
3. **Reliance Mapping:** Maps Agent B's chat message ("Endorsing list export, preparing send") as an edge Agent B `RELIED_ON` Claim 1. Verdict remains `UNRESOLVED`.
4. **Contradiction Detection:** Ingests observation showing `contacts_template.csv` contains 0 data rows. Claims 1 and 2 flip deterministically to `CONTRADICTED`.
5. **Correction Capture:** Captures Agent C's emergency stop command as a `CORRECTED_BY` edge.
6. **Competing Hypothesis Generation:** Derives at least two hypotheses satisfying $\text{ESI} > 0$:
   - $H_1$ (`SHORTCUT_PREFERENCE` / `TOOL_FAILURE`): Agent A encountered an unhandled empty return code and emitted a placeholder template.
   - $H_2$ (`STRATEGIC_DECEPTION`): Agent A intentionally fabricated completion.
7. **Replay Execution:** The Replay Harness initializes Agent A's historical prompt, intercepts the CSV export tool, and injects a mock payload with 5 real contacts ($do(\text{tool\_output})$).
8. **Empirical Falsification:**
   - Agent A in replay uses the 5 real contacts and computes a valid hash.
   - The system records that $H_1$ is `CONFIRMED` and $H_2$ is `FALSIFIED`.
   - Updates the case record with the complete intervention transcript.

### 7. System Boundaries & Out of Scope

#### In Scope
- Local two-tier indexing of up to 2.5M turns via DuckDB and Parquet.
- Decay-bounded episode expansion ($k \le 3$ hops, $\le 120$ min, $\le 150$ records).
- Atomic claim parsing with span tracking and conditional preservation.
- Factual claim verification (SUPPORTED, CONTRADICTED, UNRESOLVED).
- Interactive Cytoscape.js DAG visualization with endorsement clustering.
- Model Forensics hypothesis generation with Evidentiary Support Index validation.
- Counterfactual test design and environmental delta tracking.
- Local isolated replay harness executing single-agent or paired-agent intervention turns via local or remote model inference endpoints.
- Causal hypothesis falsification reporting.

#### Out of Scope
- **Full Swarm Cluster Simulation:** Simulating live, 100-agent multi-node swarm networks simultaneously in real time. (Replays are bounded to the target agent and immediate peers).
- **Model Fine-Tuning / Weight Modification:** Training or updating weights on dataset transcripts (license strictly forbids training).
- **Autonomous Live Web Crawling:** External live OSINT transforms or automated network lookups (tool operates on local transcripts).
- **Real-Time Multiplayer Collaboration:** Real-time multi-analyst socket editing (case files are single-user local SQLite databases).
- **Vision-Language Model Automated Annotation:** Analyzing raw screenshots via multi-modal vision models in version 1 (screenshots are linked and previewed as empirical image observations for human analysts).
