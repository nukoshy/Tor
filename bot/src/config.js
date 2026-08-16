const fs = require("fs");
const path = require("path");

// Мини-загрузчик .env без зависимостей (значения из окружения имеют приоритет)
try {
  const envFile = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {}

module.exports = {
  port: +(process.env.PORT || 3000),
  wahaUrl: (process.env.WAHA_URL || "http://localhost:3001").replace(/\/$/, ""),
  wahaKey: process.env.WAHA_API_KEY || "",
  session: process.env.WAHA_SESSION || "default",
  replyDelayMs: +(process.env.REPLY_DELAY_MS || 150000),
  humanCooldownMin: +(process.env.HUMAN_COOLDOWN_MIN ?? 60),
  alertPhone: process.env.ALERT_PHONE || "77773539587",
  webhookToken: process.env.WEBHOOK_TOKEN || "",
  // "greeting" — бот включается в чате только после формального приветствия (пилот на личном номере);
  // "off" — отвечает на любое входящее (боевой режим на номере ресторана)
  triggerMode: process.env.TRIGGER_MODE || "off",
  llm: {
    baseUrl: (process.env.LLM_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, ""),
    apiKey: process.env.LLM_API_KEY || "",
    model: process.env.LLM_MODEL || "deepseek-chat",
    mock: process.env.MOCK_LLM === "1",
  },
  stt: {
    baseUrl: (process.env.STT_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
    apiKey: process.env.STT_API_KEY || "",
    model: process.env.STT_MODEL || "whisper-large-v3",
  },
  google: {
    saB64: process.env.GOOGLE_SA_JSON_B64 || "",
    calendarId: process.env.CALENDAR_ID || "",
  },
  dataDir: process.env.DATA_DIR || path.join(__dirname, "..", "data"),
  tz: "Asia/Almaty", // весь Казахстан с 2024 года живёт в UTC+5
  maxAdvanceDays: +(process.env.MAX_ADVANCE_DAYS ?? 31),
};
