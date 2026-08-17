// Простое JSON-хранилище: история чатов, режим «менеджер в чате», id/тексты отправленных ботом сообщений.
const fs = require("fs");
const path = require("path");
const cfg = require("./config");

const FILE = path.join(cfg.dataDir, "state.json");
let state = { chats: {}, sentIds: [], sentTexts: [] };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
} catch {}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(cfg.dataDir, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(state));
    } catch (e) {
      console.error("store save failed:", e.message);
    }
  }, 300);
}

function chat(id) {
  return (state.chats[id] ||= { history: [], humanUntil: 0 });
}

function pushMsg(id, role, content) {
  const c = chat(id);
  c.history.push({ role, content, ts: Date.now() });
  if (c.history.length > 40) c.history.splice(0, c.history.length - 40);
  save();
}

function rememberSent(msgId, text, chatId) {
  if (msgId) {
    state.sentIds.push(String(msgId));
    if (state.sentIds.length > 500) state.sentIds.splice(0, 100);
  }
  if (text) {
    state.sentTexts.push({ chatId, text, ts: Date.now() });
    if (state.sentTexts.length > 100) state.sentTexts.splice(0, 20);
  }
  save();
}

// Отличаем «эхо» собственных сообщений бота от сообщений живого менеджера с телефона:
// по id, а если движок отдал другой формат id — по совпадению текста за последние 3 минуты.
// ВАЖНО: текст сверяем по всем чатам сразу — WhatsApp может прислать эхо под другим
// идентификатором того же чата (@lid ↔ @c.us), и сверка «только в этом чате» его пропускала.
function isBotEcho(msgId, text) {
  if (msgId && state.sentIds.includes(String(msgId))) return true;
  if (text) {
    const cutoff = Date.now() - 3 * 60 * 1000;
    return state.sentTexts.some((s) => s.ts > cutoff && s.text === text);
  }
  return false;
}

function allChats() {
  return Object.entries(state.chats);
}

module.exports = { chat, pushMsg, rememberSent, isBotEcho, allChats, save };
