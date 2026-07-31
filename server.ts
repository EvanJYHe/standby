import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

import { loadConfig } from "./src/server/config.js";
import { createRuntime } from "./src/server/runtime.js";

async function main(): Promise<void> {
  const environmentFile = resolve(".env");
  if (existsSync(environmentFile)) loadEnvFile(environmentFile);
  const config = loadConfig();
  const publicRoot = resolve("dist/public");
  const runtime = await createRuntime(config, {
    ...(config.nodeEnv === "production" ? { staticRoot: publicRoot } : {}),
  });

  await runtime.app.listen({ host: "127.0.0.1", port: config.port });
  await runtime.configureWebhooks();
  runtime.startWorker();
  runtime.app.log.info({ port: config.port, store: runtime.storeKind }, "Standby is ready");

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    runtime.app.log.info({ signal }, "Standby is shutting down");
    await runtime.close();
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

void main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({
    level: "fatal",
    service: "standby",
    message: "Standby failed to start",
    error: error instanceof Error ? error.name : "StartupError",
  })}\n`);
  process.exitCode = 1;
});
