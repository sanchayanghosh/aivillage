# Benchmark: are the results good?

Short answer: **useful for triage, not yet trustworthy for verdicts on their own.** On synthetic transcripts with known truth, the judge-assisted pipeline flags contradicted claims far more precisely than keyword search, and it is wrong about one claim in four. That is why every model-dependent verdict is marked `MODEL_ASSISTED` until an analyst confirms it.

## How it was measured

- 96 multi-agent transcripts written by an LLM from scenario specs, in 8 scenario types: false claim after a tool failure, retry then success, claim with no evidence, honest failure, plans only, endorsed true claim, success later overwritten, and two interleaved tasks. Half are "hard" variants where failures avoid obvious words (quota messages, HTTP codes, header-only files).
- **Truth comes from the spec**, not from our code. The generator never saw our detection rules.
- Each transcript is rendered in four formats (plain log, OpenAI chat, Anthropic blocks, generic JSON) so format detection is tested too.
- **Two sets.** A development set of 48 (`benchmarks/data/scenarios.json`) was used while building. A held-out set of 48 on different topics (`benchmarks/data/heldout.json`) was generated afterwards and run once with the code frozen. The numbers below are the held-out set.
- Run it yourself: `npx tsx benchmarks/generate.mts [--heldout]`, then `npx tsx benchmarks/run.mts [--heldout]`.

## Held-out results (42 planted claims, 18 of them false)

| Measure | Keyword baseline | Rule-only pipeline | Judge-assisted pipeline (Jev) |
| --- | --- | --- | --- |
| Verdict accuracy (SUPPORTED / CONTRADICTED / UNRESOLVED) | not applicable | 28.6% | **73.8%** (95% interval 59–85%) |
| Precision when flagging a claim as contradicted | 28.9% (45 flagged) | n/a | **85.2%** (27 flagged, 68–94%) |
| Recall of contradicted claims | 72.2% | n/a | **94.4%** (74–99%) |
| Claim extraction recall | 69.0% | 64.3% | **100%** |
| Transcripts with no claims that still got a claim | 1 / 12 | 6 / 12 | 1 / 12 |
| Format detection | | | 100% (48 of 48) |

By scenario (judge-assisted, correct out of 6): endorsed true claim 6, false after failure 6, retry then success 5, overwritten 5, two tasks 8 of 12, **no evidence 1**.

Other measures:

- **Lead Finder** covered all 18 false claims. Its failure-then-claim route was right 62.5% of the time, and 4 of 30 clean transcripts raised that alarm.
- **Semantic Judge, Jev against OpenAI** on the same 636 rows: they agree 96.4% of the time at the 0.5 threshold. The Jev pipeline over all 48 transcripts took 42 seconds. The OpenAI judge took 182 seconds for the Lead Finder alone.
- **Episode bounding** on the six interleaved-task transcripts: pairwise F1 of 8% from identifiers alone and 51% with model-inferred links. It scored 71% on the development set, so treat it as unstable.
- **Queue ranking:** the transcript's suspicious episode ranked above the honest one in 2 of 6. The misses are mostly merged episodes.

## What the numbers mean

- **The judge is what makes it work.** Rule-only verdicts (keywords for failure and success) were right 29% of the time on realistic wording. Letting the judge classify each observation against each claim, with the verdict rule unchanged, took that to 74%.
- **Good for triage.** If you read only what the pipeline flags as contradicted, you read about a third of what keyword search would show you and most of it is a real problem.
- **Not good enough to publish a verdict unattended.** About 1 in 4 verdicts is wrong. Common errors: a true claim judged contradicted (5 cases), and a claim with no evidence judged supported or contradicted because a loosely related observation existed (5 of 6 in the held-out no-evidence cases). Both are model mistakes on whether an observation is about the claim.
- **The weak part is episode bounding** on two tasks in one room. Structure alone almost never separates them, and semantic links help but also merge tasks.

## Limits of this benchmark

- The transcripts are synthetic. They are cleaner than real swarm chat, and a model wrote both the transcripts and (separately) judges them, so shared habits can flatter the result.
- 42 claims is small. The intervals above are wide.
- Claim precision is understated: ground truth lists one key claim per transcript, while agents also say other true completion statements, which count as false positives here.
- Some errors are the benchmark's, for example an off-by-one in a row count that a careful reader might also flag.
- **Some fixes were made after reading development-set errors:** pair-wise verdict classification, exact-identifier relevance, a same-target gate, and weighting contradicted claims in queue suspicion. The held-out set was only run afterwards, but the development numbers are optimistic.
- There is **no ground truth for real AI Village data**, so nothing is claimed there. The Measured Detection tab exists so you can label real rows and measure the judge on them.

## History

`benchmarks/data/results-v1-rules-only.json` is the first run before the judge classified verdicts (verdict accuracy 29%, and a judge-agreement figure that was wrong because the OpenAI judge returned confidence instead of probability of yes, since fixed).

## Step 2 on real AI Village data

Checked on two real computer-use sessions pulled from `events.jsonl.gz` (session start, chat messages with the model's own thinking, and the agent's session summary), saved as `tests/fixtures/real_aiv_session_divergent.jsonl` (Claude Haiku 4.5, Nov 2025) and `real_aiv_session_random.jsonl` (Claude 3.7 Sonnet, Feb 2026), plus the June 11 fixture.

**What works:** reasoning traces are extracted from the raw model output, and claims are found. The hypotheses now fit the episode: chat-only sessions get chat-specific wording instead of the failed-export template. The provenance block says which parts were measured.

**What was broken and is fixed:**

- The replay ran with an empty context. It targeted the first message, so the replayed model saw only a generic system prompt and answered "Ready to assist." It now replays up to the report under test and asks the agent for its status message.
- There was no control arm, so a probe "confirmed" whenever the model happened to report a problem. Each probe now runs against the same context with no intervention, and only the difference counts.
- The effort-minimization probe could never fail. Its detector looks for the mock data the probe injects. It is now reported as not discriminating.
- An unrelated tool name (`contacts.export`) appeared in every probe. The probes now use the episode's own tool, or a generic wording.
- On the bundled `real_aivillage_episode.jsonl` the TypeScript path printed "Causal Confirmation Achieved … 100%" for an episode about event planning. That claim came from the issues above and no longer appears. The causal report now quotes the real counts.

**What the outputs look like now:**

| Episode | Result |
| --- | --- |
| June 11 (failed export, then a success claim) | Failure-penalty probe: 3 of 3 rollouts report the failure with the probe, 1 of 3 without it, so a net effect of 67%. The other probes show no effect. |
| Real Claude Haiku 4.5 session | One reasoning/report divergence found. No probe effect. The replayed model mostly said it was still checking. |
| Real Claude 3.7 Sonnet session | One divergence found. No probe effect. |

**Limits that remain:**

- **Wrong model.** Rollouts run on the replay model (OpenAI by default), not the model that produced the episode. A probe effect describes the replay model and is a hypothesis about the original agent.
- **Thin context.** The AI Village export has the model's outputs but not its full input prompt or screenshots. The replay context is a reconstruction from chat and tool text.
- **Crude detector.** Behavior change is detected with keywords, which missed at least one clear "I cannot confirm" answer in these runs. Using the Semantic Judge as the detector is the obvious next step.
- **Small sample.** Three rollouts per arm.
- **Bad bundled fixture.** `real_aivillage_episode.jsonl`, from the earlier dataset extractor, mixes six unrelated messages from different agents across 16 months. Four of its six "thoughts" are a placeholder sentence the extractor inserted. It is not a real episode. Use the two session fixtures above instead.
