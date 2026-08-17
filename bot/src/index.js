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
  if (store.isBotEcho(id, p.body)) return;
  // Служебная пометка истории в тексте исходящего = наш же артефакт, а не менеджер
  if (/\[менеджер\]:/i.test(p.body || "")) return;
  // При подключении движок «доигрывает» старые исходящие по всем чатам — это не живой менеджер
  if (p.timestamp && Date.now() / 1000 - p.timestamp > 120) return;
  const c = store.chat(chatId);

  // Команды владельца прямо из чата: «!бот» — вернуть бота сюда, «!стоп» — заглушить на 12 часов
  const cmd = (p.body || "").trim().toLowerCase();
  if (cmd === "!бот" || cmd === "!bot") {
    c.humanUntil = 0;
    c.mutedUntil = 0;
    c.engagedUntil = Date.now() + 24 * 3600 * 1000;
    store.save();
    const last = c.history[c.history.length - 1];
    if (last && last.role === "user") scheduleReply(chatId);
    console.log(`[${chatId}] команда !бот — бот снова в чате`);
    return;
  }
  if (cmd === "!стоп" || cmd === "!stop") {
    c.mutedUntil = Date.now() + 12 * 3600 * 1000; // владелец: пауза 12 часов (переживает рестарты)
    store.save();
    const t = timers.get(chatId);
    if (t) {
      clearTimeout(t);
      timers.delete(chatId);
    }
    console.log(`[${chatId}] команда !стоп — бот молчит 12 часов`);
    return;
  }
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
  const c = store.chat(chatId);

  // Команды клиента: «!стоп» — выключить бота в этом чате, «!бот» — включить обратно
  const clientCmd = text.trim().toLowerCase();
  if (clientCmd === "!бот" || clientCmd === "!bot") {
    c.mutedUntil = 0;
    c.humanUntil = 0;
    if (cfg.triggerMode === "greeting") c.engagedUntil = Date.now() + 24 * 3600 * 1000;
    store.save();
    console.log(`[${chatId}] клиент включил бота (!бот)`);
    return sendDirect(chatId, "Бот снова включён ✅ / Бот қайта қосылды ✅");
  }
  if (clientCmd === "!стоп" || clientCmd === "!stop") {
    if (cfg.triggerMode === "greeting" && Date.now() >= (c.engagedUntil || 0)) return; // личный чат — молчим
    c.mutedUntil = Date.now() + 365 * 24 * 3600 * 1000; // пауза до команды !бот
    store.save();
    const t = timers.get(chatId);
    if (t) {
      clearTimeout(t);
      timers.delete(chatId);
    }
    console.log(`[${chatId}] клиент выключил бота (!стоп)`);
    return sendDirect(
      chatId,
      "Хорошо, бот выключен в этом чате — менеджер ответит лично. Включить обратно: !бот\nБот осы чатта өшірілді — менеджер өзі жауап береді. Қайта қосу: !бот"
    );
  }
  if (Date.now() < (c.mutedUntil || 0)) {
    store.pushMsg(chatId, "user", text); // бот на паузе: копим контекст, не отвечаем
    return;
  }

  // Пилот на личном номере: включаемся только после формального приветствия,
  // дальше ведём этот чат 24 часа (продлевается каждым сообщением клиента)
  if (cfg.triggerMode === "greeting") {
    const engaged = Date.now() < (c.engagedUntil || 0);
    if (!engaged && !GREETING_RE.test(text)) {
      store.pushMsg(chatId, "user", text); // копим контекст, но молчим — это личный чат
      return;
    }
    c.engagedUntil = Date.now() + 24 * 3600 * 1000;
  }

  store.pushMsg(chatId, "user", text);
  if (Date.now() < c.humanUntil) return; // в этом чате сейчас работает человек

  scheduleReply(chatId);
}

const GREETING_RE =
  /здравствуй|добр(ый|ое|ой)\s*(день|вечер|утро|ночи)|с[аә]леметс[иі]з|ассалау|ассалам|салам\s*[аә]лейкум|қайырлы\s*(таң|күн|кеш)/i;

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

// Мгновенная отправка без LLM (подтверждения команд)
async function sendDirect(chatId, text) {
  try {
    const sent = await waha.sendText(chatId, text);
    store.rememberSent(sent?.id?._serialized || sent?.key?.id || sent?.id, text, chatId);
    store.pushMsg(chatId, "assistant", text);
  } catch (e) {
    console.error("sendDirect:", e.message);
  }
}

async function reply(chatId) {
  const c = store.chat(chatId);
  if (Date.now() < c.humanUntil || Date.now() < (c.mutedUntil || 0)) return; // менеджер или пауза
  await waha.sendSeen(chatId);
  await waha.startTyping(chatId);
  try {
    const text = await respond(chatId, c.history, { alert });
    if (!text) return;
    if (Date.now() < c.humanUntil || Date.now() < (c.mutedUntil || 0)) return; // вмешались, пока LLM думала
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

// Разовая чистка последствий петли эха: убираем из историй мусор вида «[менеджер]: [менеджер]: …»
let purged = 0;
for (const [, c] of store.allChats()) {
  const before = c.history.length;
  c.history = c.history.filter((h) => !/(\[менеджер\]:\s*){2,}/i.test(h.content || ""));
  purged += before - c.history.length;
}
if (purged) {
  store.save();
  console.log(`чистка историй: удалено ${purged} заражённых записей`);
}

// После рестарта (деплой, сбой) не бросаем клиентов, ждавших ответа
for (const [chatId, c] of store.allChats()) {
  if (cfg.humanCooldownMin === 0 && c.humanUntil) c.humanUntil = 0; // пауза выключена — сбрасываем и накопленные
  if (Date.now() < (c.mutedUntil || 0)) continue; // чат на явной паузе (!стоп)
  const last = c.history[c.history.length - 1];
  if (cfg.triggerMode === "greeting" && Date.now() >= (c.engagedUntil || 0)) continue;
  if (last && last.role === "user" && Date.now() - last.ts < 24 * 3600 * 1000 && Date.now() >= c.humanUntil) {
    scheduleReply(chatId);
  }
}

app.listen(cfg.port, () =>
  console.log(
    `TÖR bot запущен на :${cfg.port} · задержка ${Math.round(cfg.replyDelayMs / 1000)}с · пауза после менеджера ${cfg.humanCooldownMin} мин · триггер: ${cfg.triggerMode} · LLM ${cfg.llm.mock ? "MOCK" : cfg.llm.model}`
  )
);
