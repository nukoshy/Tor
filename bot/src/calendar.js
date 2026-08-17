// Google Calendar через сервисный аккаунт (без зависимостей — JWT подписывается node:crypto).
// Не настроен — бот честно говорит, что занятость уточнит менеджер.
const crypto = require("crypto");
const cfg = require("./config");

let sa = null;
try {
  if (cfg.google.saB64) sa = JSON.parse(Buffer.from(cfg.google.saB64, "base64").toString("utf8"));
} catch (e) {
  console.error("GOOGLE_SA_JSON_B64 не парсится:", e.message);
}

const configured = () => Boolean(sa && cfg.google.calendarId);

let tok = { value: null, exp: 0 };
async function token() {
  if (tok.value && Date.now() < tok.exp - 60000) return tok.value;
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned =
    enc({ alg: "RS256", typ: "JWT" }) +
    "." +
    enc({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/calendar",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${sig}`,
    }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${await res.text()}`);
  const d = await res.json();
  tok = { value: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return tok.value;
}

async function gapi(pathPart, opts = {}) {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.google.calendarId)}${pathPart}`,
    { ...opts, headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" } }
  );
  if (!res.ok) throw new Error(`Calendar ${res.status}: ${await res.text()}`);
  return res.json();
}

// Все события на дату (Казахстан = UTC+5 круглый год)
async function eventsOn(dateISO) {
  const q = new URLSearchParams({
    timeMin: `${dateISO}T00:00:00+05:00`,
    timeMax: `${dateISO}T23:59:59+05:00`,
    singleEvents: "true",
    orderBy: "startTime",
  });
  const d = await gapi(`/events?${q}`, { method: "GET" });
  return (d.items || []).map((e) => ({
    summary: e.summary || "",
    start: e.start?.dateTime || e.start?.date || "",
  }));
}

const HALLS = { kabinka: "Кабинка", neke_sarayi: "Неке сарайы", banket_zal: "Банкетный зал", karaoke: "Караоке" };
const hallName = (k) => HALLS[k] || k || "Зал";

async function createHold(h) {
  const ev = {
    summary: `HOLD${h.n ? ` #${h.n}` : ""} · ${hallName(h.hall)} · ${h.client_name} · ${h.guests} гостей${
      h.package && h.package !== "не выбран" ? ` · ${h.package} ₸` : ""
    }`,
    description:
      `Заявка из WhatsApp-бота (менеджер должен подтвердить).\n` +
      `Тип события: ${h.event_type || "—"}\n` +
      `Телефон клиента: +${h.phone || "—"}\n` +
      `Комментарий: ${h.comment || "—"}`,
    start: { dateTime: `${h.date}T${h.time_start || "16:00"}:00`, timeZone: cfg.tz },
    end: { dateTime: `${h.date}T23:59:00`, timeZone: cfg.tz },
  };
  return gapi("/events", { method: "POST", body: JSON.stringify(ev) });
}

module.exports = { configured, eventsOn, createHold, HALLS, hallName };
