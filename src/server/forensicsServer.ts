import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeEpisode } from "../core/episodes/EpisodeLoader.js";
import { runForensics } from "../forensics/runForensics.js";
import { llmConfigFromEnv, runLlmTurn } from "./llm/openaiProvider.js";
import { existsSync } from "node:fs";
import { studioRoutes } from "./routes/studio.js";
import { judgeSetup, auditStore, userKeys } from "./context.js";
import { normalizeTranscript } from "../core/ingest/TranscriptNormalizer.js";

try {
  process.loadEnvFile?.();
} catch {
  // ignore if .env is missing
}

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures");
const PORT = Number(process.env.PORT ?? process.env.FORENSICS_API_PORT ?? 3210);
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN ?? "*";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type,x-openai-key,x-typesafe-key" });
    return void res.end();
  }
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/healthz") return sendJson(res, 200, { ok: true });

    if (req.method === "GET" && url.pathname === "/api/status") {
      const keys = userKeys(req);
      const llm = llmConfigFromEnv(process.env, keys.openai);
      const datasetDir = join(FIXTURE_DIR, "../../dataset");
      return sendJson(res, 200, {
        llm: { configured: Boolean(llm.apiKey), model: llm.model },
        judge: { provider: judgeSetup(req)?.provider ?? null, model: judgeSetup(req)?.judge.modelName ?? null, classifierOutputs: auditStore().countOutputs() },
        huggingface: { tokenConfigured: Boolean(process.env.HF_TOKEN), datasetPresent: existsSync(join(datasetDir, "events.jsonl.gz")) },
        fixtures: readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".jsonl") && !f.startsWith("_tmp_")).length,
      });
    }

    if (await studioRoutes(req, res, url, readBody, sendJson, FIXTURE_DIR)) return;

    if (req.method === "POST" && url.pathname === "/api/provider") {
      const result = await runLlmTurn(await readBody(req), llmConfigFromEnv(process.env, userKeys(req).openai));
      if (!result.ok) return sendJson(res, result.status, { error: result.message, code: result.code });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": ALLOWED_ORIGIN });
      return void res.end(result.sse);
    }

    if (req.method === "GET" && url.pathname === "/api/fixtures") {
      const fixtures = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".jsonl"));
      return sendJson(res, 200, { fixtures });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/fixtures/")) {
      const name = url.pathname.slice("/api/fixtures/".length);
      if (name.includes("/") || name.includes("..")) return sendJson(res, 400, { error: "bad name" });
      const content = readFileSync(join(FIXTURE_DIR, name), "utf8");
      return sendJson(res, 200, { name, content });
    }

    if (req.method === "POST" && url.pathname === "/api/forensics") {
      const body = JSON.parse(await readBody(req)) as {
        jsonl: string;
        episodeId?: string;
        usePython?: boolean;
      };
      if (!body.jsonl || typeof body.jsonl !== "string") {
        return sendJson(res, 400, { error: "jsonl is required" });
      }
      const episodeId = body.episodeId ?? "ep-uploaded";
      body.jsonl = normalizeTranscript(body.jsonl).jsonl;

      if (body.usePython && /^real_aivillage/.test(episodeId)) {
        // Run direct Python forensics engine
        const tempFixture = join(FIXTURE_DIR, `_tmp_${Date.now()}.jsonl`);
        const { writeFileSync, unlinkSync } = await import("node:fs");
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);
        try {
          writeFileSync(tempFixture, body.jsonl, "utf8");
          const { stdout } = await execFileAsync("python3", [
            join(dirname(fileURLToPath(import.meta.url)), "../../scripts/aivillage_forensics.py"),
            "--fixture",
            tempFixture,
            "--json",
          ]);
          return sendJson(res, 200, JSON.parse(stdout));
        } finally {
          try { unlinkSync(tempFixture); } catch {}
        }
      }

      const analysis = analyzeEpisode(episodeId, body.jsonl);
      const report = await runForensics(analysis, { openaiKey: userKeys(req).openai });
      return sendJson(res, 200, report);
    }

    if (req.method === "POST" && url.pathname === "/api/dataset/rescan") {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/interpret_aivillage_dataset.py");
      const { stdout } = await execFileAsync("python3", [scriptPath]);
      const fixtures = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".jsonl") && !f.startsWith("_tmp_"));
      return sendJson(res, 200, { message: "Rescan complete", output: stdout, fixtures });
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}).listen(PORT, () => {
  console.log(`forensics api listening on http://localhost:${PORT}`);
});
