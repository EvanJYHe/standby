import { spawn } from "node:child_process";

const publicBaseUrl = process.env.PUBLIC_BASE_URL;
if (!publicBaseUrl) throw new Error("PUBLIC_BASE_URL is required to start the local tunnel.");

const publicUrl = new URL(publicBaseUrl);
if (publicUrl.protocol !== "https:" || publicUrl.hostname === "localhost" || publicUrl.hostname === "127.0.0.1") {
  throw new Error("PUBLIC_BASE_URL must be the public HTTPS ngrok URL.");
}

const port = process.env.PORT ?? "3100";
const tunnel = spawn("ngrok", ["http", "--url", publicUrl.hostname, port], {
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => tunnel.kill(signal));
}

tunnel.on("error", (error) => {
  console.error(`Could not start ngrok: ${error.message}`);
  process.exitCode = 1;
});

tunnel.on("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
