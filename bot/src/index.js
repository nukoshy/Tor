// Вебхук WAHA + логика «сначала человек, потом бот»:
// клиентское сообщение ждёт REPLY_DELAY_MS; если менеджер уже ответил с телефона — бот молчит.
const express = require("express");
const cfg = require("./config");
const store = require("./store");
const waha = require("./waha");
const { respond } = require("./brain");
const { transcribe } = require("./stt");

const app = express();
app.use(express.json({ limit: "25mb" }));

const timers = new Map(); // chatId → таймер отложенного ответа
const seenIds = new Set(); // дедуп: одно сообщение приходит и как `message`, и как `message.any`

const alert = (text) =>
  waha.sendText(`${cfg.alertPhone}@c.us`, text).catch((e) => console.error("alert failed:", e.message));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/webhook", (req, res) => {
  // Токен в query (?token=…) — чтобы посторонний, узнавший URL, не мог слать фальшивые события
  if (cfg.webhookToken && req.query.token !== cfg.webhookToken) return res.status(401).json({ ok: false });
  res.json({ ok: true }); // отвечаем WAHA сразу, обрабатываем асинхронно
  handleEvent(req.body).catch((e) => console.error("webhook error:", e));
});

async function handleEvent(ev) {
  if (!ev || !ev.payload || !["message", "message.any"].includes(ev.event)) return;
  const p = ev.payload;
  const chatId = p.fromMe ? p.to : p.from;
  // Личные чаты приходят и как @c.us, и как @lid (новая адресация WhatsApp для давних контактов)
  const isDirect = chatId && (chatId.endsWith("@c.us") || chatId.endsWith("@lid"));
  if (!isDirect) {
    if (chatId && !chatId.endsWith("@g.us") && chatId !== "status@broadcast")
      console.log("пропущен чат неизвестного типа:", chatId);
    return;
  }
  const msgId = p.id?._serialized || (typeof p.id === "string" ? p.id : null);
  if (msgId) {
    if (seenIds.has(msgId)) return;
    seenIds.add(msgId);
    if (seenIds.size > 2000) {
      const it = seenIds.values();
      for (let i = 0; i < 500; i++) seenIds.delete(it.next().value);
    }
  }
  if (p.fromMe) return onOutgoing(chatId, p);
  return onClient(chatId, p);
}

// Исходящее с нашего номера: либо эхо бота, либо живой менеджер пишет с телефона
function onOutgoing(chatId, p) {
  const id = p.id?._serialized || p.id;
  if (store.isBotEcho(id, p.body, chatId)) return;
  // При подключении движок «доигрывает» старые исходящие по всем чатам — это не живой менеджер
  if (p.timestamp && Date.now() / 1000 - p.timestamp > 120) return;
  const c = store.chat(chatId);
  c.humanUntil = Date.now() + cfg.humanCooldownMin * 60000;
  store.pushMsg(chatId, "assistant", `[менеджер]: ${p.body || "(медиа)"}`);
  const t = timers.get(chatId);
  if (t) {
    clearTimeout(t);
    timers.delete(chatId);
  }
  console.log(`[${chatId}] менеджер в чате — бот молчит ${cfg.humanCooldownMin} мин`);
}

async function onClient(chatId, p) {
  let text = p.body || "";
  const mimetype = p.media?.mimetype || "";
  const isVoice = p.hasMedia && (/audio|ogg/.test(mimetype) || p.type === "ptt" || p.type === "audio");

  if (isVoice) {
    if (!p.media?.url) {
      // WAHA Core не отдаёт файлы медиа (нужен Plus) — вежливо просим текст
      text = "[голосовое сообщение — файл недоступен, вежливо попроси написать текстом]";
    } else {
      try {
        const buf = await waha.downloadMedia(p.media.url);
        const tr = await transcribe(buf);
        text = tr ? `[голосовое сообщение]: ${tr}` : "[голосовое сообщение — распознать не удалось, вежливо попроси написать текстом]";
      } catch (e) {
        console.error("stt failed:", e.message);
        text = "[голосовое сообщение — распознать не удалось, вежливо попроси написать текстом]";
      }
    }
  } else if (p.hasMedia) {
    text = `[клиент прислал файл: ${mimetype || "медиа"}] ${text}`.trim();
  }

  if (!text) return;
  store.pushMsg(chatId, "user", text);

  const c = store.chat(chatId);
  if (Date.now() < c.humanUntil) return; // в этом чате сейчас работает человек

  scheduleReply(chatId);
}

function scheduleReply(chatId) {
  const old = timers.get(chatId);
  if (old) clearTimeout(old); // новые сообщения сдвигают таймер — ответим один раз на всё
  timers.set(
    chatId,
    setTimeout(() => {
      timers.delete(chatId);
      reply(chatId).catch((e) => console.error(`reply ${chatId}:`, e.message));
    }, cfg.replyDelayMs)
  );
}

async function reply(chatId) {
  const c = store.chat(chatId);
  if (Date.now() < c.humanUntil) return; // менеджер успел вмешаться
  await waha.sendSeen(chatId);
  await waha.startTyping(chatId);
  try {
    const text = await respond(chatId, c.history, { alert });
    if (!text) return;
    if (Date.now() < c.humanUntil) return; // менеджер вмешался, пока LLM думала
    const sent = await waha.sendText(chatId, text);
    const sentId = sent?.id?._serialized || sent?.key?.id || sent?.id;
    store.rememberSent(sentId, text, chatId);
    store.pushMsg(chatId, "assistant", text);
    console.log(`[${chatId}] → ${text.slice(0, 80)}`);
  } catch (e) {
    // Клиент не должен потеряться молча: раз в час на чат зовём менеджера
    console.error(`reply ${chatId}:`, e.message);
    if (!cfg.llm.mock && Date.now() - (c.lastFailAlert || 0) > 3600000) {
      c.lastFailAlert = Date.now();
      store.save();
      await alert(`⚠️ Бот не смог ответить клиенту +${chatId.replace(/@.*$/, "")} (${String(e.message).slice(0, 120)}). Ответьте вручную.`);
    }
  } finally {
    await waha.stopTyping(chatId);
  }
}

// После рестарта (деплой, сбой) не бросаем клиентов, ждавших ответа
for (const [chatId, c] of store.allChats()) {
  const last = c.history[c.history.length - 1];
  if (last && last.role === "user" && Date.now() - last.ts < 24 * 3600 * 1000 && Date.now() >= c.humanUntil) {
    scheduleReply(chatId);
  }
}

app.listen(cfg.port, () =>
  console.log(
    `TÖR bot запущен на :${cfg.port} · задержка ${Math.round(cfg.replyDelayMs / 1000)}с · пауза после менеджера ${cfg.humanCooldownMin} мин · LLM ${cfg.llm.mock ? "MOCK" : cfg.llm.model}`
  )
);
