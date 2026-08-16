// Клиент WAHA (WhatsApp HTTP API, https://waha.devlike.pro)
const cfg = require("./config");

async function api(p, body, method = "POST") {
  const res = await fetch(cfg.wahaUrl + p, {
    method,
    headers: { "Content-Type": "application/json", "X-Api-Key": cfg.wahaKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`WAHA ${p} → ${res.status}: ${await res.text()}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const S = () => cfg.session;

module.exports = {
  sendText: (chatId, text) => api("/api/sendText", { session: S(), chatId, text }),
  sendSeen: (chatId) => api("/api/sendSeen", { session: S(), chatId }).catch(() => {}),
  startTyping: (chatId) => api("/api/startTyping", { session: S(), chatId }).catch(() => {}),
  stopTyping: (chatId) => api("/api/stopTyping", { session: S(), chatId }).catch(() => {}),
  async downloadMedia(url) {
    const res = await fetch(url, { headers: { "X-Api-Key": cfg.wahaKey } });
    if (!res.ok) throw new Error(`media download → ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  },
};
