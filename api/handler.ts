import type { IncomingMessage, ServerResponse } from "node:http";

import { loadConfig } from "../src/server/config.js";
import { createRuntime, type StandbyRuntime } from "../src/server/runtime.js";

let runtimePromise: Promise<StandbyRuntime> | undefined;

function getRuntime(): Promise<StandbyRuntime> {
  runtimePromise ??= createRuntime(loadConfig({
    ...process.env,
    NODE_ENV: "production",
  })).then(async (runtime) => {
    await runtime.app.ready();
    return runtime;
  });
  return runtimePromise;
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const runtime = await getRuntime();
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  const rewrittenPath = requestUrl.searchParams.get("__path");
  if (rewrittenPath !== null) {
    requestUrl.searchParams.delete("__path");
    const query = requestUrl.searchParams.toString();
    request.url = `/api/v1/${rewrittenPath}${query === "" ? "" : `?${query}`}`;
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      response.off("finish", complete);
      response.off("close", complete);
      response.off("error", fail);
    };
    const complete = () => {
      cleanup();
      resolve();
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };

    response.once("finish", complete);
    response.once("close", complete);
    response.once("error", fail);
    runtime.app.server.emit("request", request, response);
  });
}
