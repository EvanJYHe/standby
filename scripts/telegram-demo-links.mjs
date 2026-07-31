import { createHmac } from "node:crypto";

import { Agent } from "undici";

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const linkSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const apiIp = process.env.TELEGRAM_API_IP;
if (!botToken || !linkSecret) {
  throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are required.");
}

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
const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
  ...(dispatcher === undefined ? {} : { dispatcher }),
  signal: AbortSignal.timeout(15_000),
});
const result = await response.json().catch(() => ({}));
if (!response.ok || result.ok !== true || !result.result?.username) {
  throw new Error(`Telegram bot identity lookup failed (${response.status}).`);
}

function linkToken(customerId) {
  const signature = createHmac("sha256", linkSecret)
    .update(`telegram-link:${customerId}`)
    .digest("base64url")
    .slice(0, 16);
  return `standby_${customerId}_${signature}`;
}

const username = result.result.username;
console.log(JSON.stringify({
  warning: "Keep these customer-specific links private.",
  josh: `https://t.me/${username}?start=${linkToken("josh")}`,
  alex: `https://t.me/${username}?start=${linkToken("alex")}`,
}, null, 2));
await dispatcher?.close();
