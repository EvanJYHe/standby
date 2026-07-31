import { Agent } from "undici";

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;
const publicBaseUrl = process.env.PUBLIC_BASE_URL;
const apiIp = process.env.TELEGRAM_API_IP;

if (!botToken || !secretToken || !publicBaseUrl) {
  throw new Error("TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and PUBLIC_BASE_URL are required.");
}

const webhookUrl = new URL("/webhooks/telegram", publicBaseUrl).toString();
const dispatcher = apiIp === undefined
  ? undefined
  : new Agent({
      connect: {
        lookup: (_hostname, options, callback) => {
          if (options.all) {
            callback(null, [{ address: apiIp, family: 4 }]);
            return;
          }
          callback(null, apiIp, 4);
        },
      },
    });
const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secretToken,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  }),
  ...(dispatcher === undefined ? {} : { dispatcher }),
  signal: AbortSignal.timeout(15_000),
});
const result = await response.json().catch(() => ({}));
if (!response.ok || result.ok !== true) {
  throw new Error(`Telegram webhook registration failed (${response.status}).`);
}

const verify = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`, {
  ...(dispatcher === undefined ? {} : { dispatcher }),
  signal: AbortSignal.timeout(15_000),
});
const info = await verify.json().catch(() => ({}));
if (!verify.ok || info.ok !== true) {
  throw new Error(`Telegram webhook verification failed (${verify.status}).`);
}

console.log(JSON.stringify({
  status: "registered",
  url: info.result?.url,
  pending_updates: info.result?.pending_update_count ?? 0,
  last_error: info.result?.last_error_message ?? null,
}));
await dispatcher?.close();
