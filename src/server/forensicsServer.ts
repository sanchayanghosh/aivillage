import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeEpisode } from "../core/episodes/EpisodeLoader.js";
import { runForensics } from "../forensics/runForensics.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures");
const PORT = Number(process.env.FORENSICS_API_PORT ?? 3210);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
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
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

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
      };
      if (!body.jsonl || typeof body.jsonl !== "string") {
        return sendJson(res, 400, { error: "jsonl is required" });
      }
      const episodeId = body.episodeId ?? "ep-uploaded";
      const analysis = analyzeEpisode(episodeId, body.jsonl);
      const report = await runForensics(analysis);
      return sendJson(res, 200, report);
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}).listen(PORT, () => {
  console.log(`forensics api listening on http://localhost:${PORT}`);
});
