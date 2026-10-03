import { spawn } from "node:child_process";

const api = spawn("npx", ["tsx", "src/server/forensicsServer.ts"], { stdio: "inherit" });
const ui = spawn("npx", ["vite"], { stdio: "inherit" });
const shutdown = () => { api.kill(); ui.kill(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
api.on("exit", (c) => c && ui.kill());
ui.on("exit", (c) => c && api.kill());
