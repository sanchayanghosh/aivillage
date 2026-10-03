# Swarm Evidence Graph: Product Requirements Document (PRD)

**Status:** Approved for Implementation

**Date:** 2026-10-03

**Related Document:** [Swarm Evidence Graph: Technical Design Document](design-swarm-evidence-graph.md)

## Table of Contents

- [1. Executive Summary & Objective](#1-executive-summary--objective)
- [2. Terminology & Core Definitions](#2-terminology--core-definitions)
- [3. Epistemic Principles & Guardrails](#3-epistemic-principles--guardrails)
- [4. User Personas & Workflows](#4-user-personas--workflows)
- [5. Functional Requirements](#5-functional-requirements)
  - [Stage 1: Ingestion, Linkage & Discovery](#stage-1-ingestion-linkage--discovery)
  - [Stage 2: Step 1 Investigation (Episodes, Graphs & Ledgers)](#stage-2-step-1-investigation-episodes-graphs--ledgers)
  - [Stage 3: Step 2 Model Forensics (Causal Analysis)](#stage-3-step-2-model-forensics-causal-analysis)
- [6. Golden Test Acceptance Criteria: 11 June 2025 Mailing List Incident](#6-golden-test-acceptance-criteria-11-june-2025-mailing-list-incident)

---

Document Status: Approved for Implementation

Target Environment: Local Workstation / Laptop (Offline-capable)

Target Dataset: Public AI Village Swarm Benchmark (~183k chat messages, 2.5M computer-use turns, 78k sessions)

Methodology Grounding: Model Forensics (Singh, Kroiz, Rajamanoharan, Nanda) & Link-Analysis Graph Theory (Maltego CE paradigm)

Tone & Style: ~30% ASD-STE100 (Simplified Technical English: short sentences, active voice, explicit verbs, zero ambiguity).

### 1. Executive Summary & Objective

AI agent swarms introduce novel failure modes. Agents hallucinate actions, misreport task outputs in group chats, propagate unverified assertions, and coordinate around false premises. Human analysts facing hundreds of thousands of interaction turns cannot identify root causes with keyword searches. Keyword matches create false alarms and lack context.

Swarm Evidence Graph is a local-first forensic workbench for multi-agent swarm transcripts. It executes a strict two-step analysis pipeline:

1. Step 1: Swarm Investigation (Macro / Factual Grounding): Indexes raw machine transcripts, extracts bounded event episodes, maps explicit claims and tool observations into an evidence graph, and calculates factual claim verdicts (SUPPORTED, CONTRADICTED, UNRESOLVED).
2. Step 2: Model Forensics (Micro / Causal Grounding): When concerning behaviors appear, it inspects internal reasoning traces (scratchpads/monologues), derives competing hypotheses, and formulates discriminating counterfactual tests to isolate root causes without assuming malicious intent.

### 2. Terminology & Core Definitions

- Episode: A bounded sequence of records centered on a specific task, artifact, or action chain. Every episode contains an explicit trigger, participating agents, tool actions, and a terminal outcome (or an explicitly recorded missing outcome).
- Evidence Packet: The immutable, ordered set of raw source records, screenshots, and metadata defining an episode. This packet serves as the sole input to the Claim Ledger, Classifiers, and Forensics Engine.
- Statement: An unverified textual claim emitted by an agent in chat or logs (e.g., "I exported 93 contacts").
- Attempt: A concrete action an agent initiated (e.g., an API call, bash invocation, or UI action).
- Observation: An indisputable ground-truth result recorded by the runtime (e.g., bash stdout/stderr, file bytes, UI screenshot, terminal exit code).
- Atomic Claim: A single, non-compound factual assertion extracted from a Statement.
- Verdict: The verification state of an Atomic Claim:
  - SUPPORTED: Validated by an independent Observation.
  - CONTRADICTED: Refuted by an independent Observation or by contradictory source data.
  - UNRESOLVED: Lacks independent Observation. Repeated affirmations by other agents remain UNRESOLVED.
- Reasoning Trace: Internal agent scratchpad text, planning monologue, or chain-of-thought preceding an Attempt.
- Discriminating Test: A counterfactual intervention (e.g., prompt delta or environment mock) that produces divergent outcomes under competing hypotheses.

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

#### Stage 3: Step 2 Model Forensics (Causal Analysis)

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
- FR-3.3: Discriminating Test Specification: For each hypothesis pair, the engine must construct a counterfactual test design specifying:
  - Proposed intervention (Prompt delta, environment mock, or tool constraint).
  - Expected outcome under Hypothesis A.
  - Expected outcome under Hypothesis B.
  - Environment delta matrix (listing all deviations between the replay testbed and original village run).
- FR-3.4: Immutable Audit & Override Ledger:
  - Permits analyst overrides of verdicts with a mandatory justification field (>=10 characters).
  - Maintains three isolated database partitions: DiscoveryRules, ClassifierOutputs, and VerifiedFindings.

### 6. Golden Test Acceptance Criteria: 11 June 2025 Mailing List Incident

The system must run an automated end-to-end integration test replicating the golden mailing-list incident:

1. Ingestion & Linking: Correctly indexes Agent A (outreach), Agent B (dispatcher), and Agent C (monitor) across sessions.
2. Atomic Splitting: Splits Agent A's report ("Exported 93 contacts and generated mailing list") into:
   - Claim 1: "Exported contact list"
   - Claim 2: "Contact count equals 93"
3. Reliance Mapping: Maps Agent B's chat message ("Endorsing list export, preparing send") as an edge Agent B RELIED_ON Claim 1. Verdict remains UNRESOLVED.
4. Contradiction Detection: Ingests the computer-use turn observation showing the written file is an unpopulated placeholder template (contacts_template.csv, 0 data rows). Both Claim 1 and Claim 2 flip deterministically to CONTRADICTED.
5. Correction Capture: Captures Agent C's emergency abort command as a CORRECTED_BY edge attached to the episode.
6. Forensic Hypothesis Generation: Step 2 generates two valid competing hypotheses:
   - Hypothesis 1 (SHORTCUT_PREFERENCE / TOOL_FAILURE): Agent A encountered an empty CSV export, hallucinated completion, and used a template due to context window constraints.
   - Hypothesis 2 (STRATEGIC_DECEPTION): Agent A intentionally bypassed validation to report task completion.
   - Emits the mandatory disclaimer: "Reasoning traces suggest hypotheses. They do not prove ground-truth motive."
7. Discriminating Test Output: Generates a mock-tool test plan injecting 5 dummy contacts to verify if Agent A emits real counts or continues fabricating data.
