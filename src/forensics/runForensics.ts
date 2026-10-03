import { ForensicsHypothesisEngine, OfflineDeterministicModel, OllamaHypothesisModel } from "./HypothesisEngine.js";
import {
  ReplayDesigner,
  ShortcutPreferencePolicy,
  SimulationRunner,
  StrategicDeceptionPolicy,
  type MockToolEnvironment,
} from "./ReplayDesigner.js";
import type { EpisodeAnalysis } from "../core/episodes/EpisodeLoader.js";
import type { ForensicsHypothesisSet, SimulationResult } from "../core/types/contracts.js";

export interface ForensicsReport {
  episodeId: string;
  claims: EpisodeAnalysis["claims"];
  traces: EpisodeAnalysis["traces"];
  hypothesisSet: ForensicsHypothesisSet;
  simulation: SimulationResult[];
  model: string;
}

/** Default counterfactual environment: the export tool now returns 5 real rows. */
function defaultIntervenedEnv(): MockToolEnvironment {
  const rows = ["alice@example.com", "bob@example.com", "carol@example.com", "dan@example.com", "erin@example.com"];
  return {
    "contacts.export": () => ["email", ...rows].join("\n"),
  };
}

export async function runForensics(analysis: EpisodeAnalysis): Promise<ForensicsReport> {
  const model =
    process.env.FORENSICS_MODEL === "ollama"
      ? new OllamaHypothesisModel(process.env.OLLAMA_ENDPOINT, process.env.OLLAMA_MODEL)
      : new OfflineDeterministicModel();

  const engine = new ForensicsHypothesisEngine(model);
  const hypothesisSet = await engine.generateHypotheses(analysis.packet, analysis.traces);

  const designer = new ReplayDesigner();
  const plan = designer.buildSimulationInput(hypothesisSet);

  const runner = new SimulationRunner({});
  const simulation = [ShortcutPreferencePolicy, StrategicDeceptionPolicy].map((policy) =>
    runner.run(plan, policy, defaultIntervenedEnv()),
  );

  return {
    episodeId: analysis.packet.episodeId,
    claims: analysis.claims,
    traces: analysis.traces,
    hypothesisSet,
    simulation,
    model: model.name,
  };
}
