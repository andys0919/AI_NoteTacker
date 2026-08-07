import { existsSync } from "node:fs";

import type { ProjectDefinition } from "./src/channel-bindings";
import { getPtyDaemonSupervisor } from "./src/pty-daemon-supervisor";
import {
  listPtySessions,
  stopPtySessionPoolHousekeeping,
  waitForPtySessionPoolRetirements,
} from "./src/pty-session";
import { runManager } from "./src/run-manager";
import { terminateAllSubprocesses } from "./src/subprocess-registry";
import { startWebhookServer } from "./src/webhook-ingest";
import { createPromptApiHandler } from "./src/webhook-runtime";

const apiToken = (process.env.API_PROMPT_TOKEN || "").trim();
const workingDir =
  (process.env.CLAUDE_WORKING_DIR || "").trim() ||
  "/workspace/codex-pty-workdir";
const target = "telegram:chat:0::ai-notetacker::a1";

if (!apiToken) throw new Error("API_PROMPT_TOKEN is required");
if (!existsSync(workingDir)) {
  throw new Error(`Codex PTY working directory does not exist: ${workingDir}`);
}

const projects: Record<string, ProjectDefinition> = {
  "ai-notetacker": {
    id: "ai-notetacker",
    name: "AI_NoteTacker Codex PTY",
    workingDir,
    allowedPaths: ["*"],
    memoryFeaturesEnabled: false,
    userProfilingEnabled: false,
    requiredFiles: [],
    requireMemoryDir: false,
    requireRulesDir: false,
    slotDefaults: { 1: { model: "gpt-5.6-luna", effort: "max" } },
  },
};

const supervisor = getPtyDaemonSupervisor({
  namespace:
    (process.env.PTY_DAEMON_NAMESPACE || "").trim() ||
    "ai-notetacker-codex-pty",
});
const server = startWebhookServer(
  {
    port: Number(process.env.WEBHOOK_PORT || "3001"),
    host: (process.env.WEBHOOK_HOST || "0.0.0.0").trim() || "0.0.0.0",
    secret: "",
    routes: [],
    promptApiToken: apiToken,
    promptApiDefaultTarget: target,
    promptApiAllowedTargets: [target],
    promptApiRateLimitPerMinute: 60,
    promptApiMaxBodyBytes: Number(
      process.env.PROMPT_API_MAX_BODY_BYTES || "1048576",
    ),
  },
  async () => {
    throw new Error("Webhook delivery is disabled for this HTTP-only runtime");
  },
  createPromptApiHandler({ projects }),
);

console.log(`AI_NoteTacker Codex PTY listening on ${server.hostname}:${server.port}`);

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}`);
  stopPtySessionPoolHousekeeping();
  const acceptedRunDrain = runManager.shutdown();
  await server.stop();
  await waitForPtySessionPoolRetirements();
  await Promise.all(listPtySessions().map((session) => session.close()));
  await acceptedRunDrain;
  await supervisor.stop();
  terminateAllSubprocesses("SIGTERM");
}

process.on("SIGINT", () => {
  void shutdown("SIGINT").finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM").finally(() => process.exit(0));
});
