import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AuditStore } from "../core/audit/AuditStore.js";
import { SemanticJudge } from "../core/semantic/SemanticJudge.js";
import { judgeFromEnv, type UserKeys } from "../core/semantic/provider.js";
import type { IncomingMessage } from "node:http";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
let store: AuditStore | null = null;

/** One audit store per process: classifier cache, findings and evaluation labels. */
export function auditStore(): AuditStore {
  return (store ??= new AuditStore(process.env.AUDIT_DB ?? join(ROOT, ".cache/audit.sqlite")));
}

/** Keys the user typed into the browser settings arrive as headers. */
export function userKeys(req?: IncomingMessage): UserKeys {
  const h = (n: string) => { const v = req?.headers[n]; return (Array.isArray(v) ? v[0] : v)?.trim() || undefined; };
  return { openai: h("x-openai-key"), typesafe: h("x-typesafe-key") };
}

export function judgeSetup(req?: IncomingMessage) {
  const s = judgeFromEnv(process.env, userKeys(req));
  return s ? { provider: s.provider, judge: new SemanticJudge(s.model, auditStore()) } : null;
}
