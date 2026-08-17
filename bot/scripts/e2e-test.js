#!/usr/bin/env node
// Сквозной тест каркаса без WhatsApp и без LLM-ключа:
// поднимает мок WAHA, запускает бота (MOCK_LLM=1, короткая задержка) и проверяет:
//  1) клиент пишет → бот отвечает после задержки (seen + typing + sendText)
//  2) несколько сообщений подряд → один ответ (склейка)
//  3) менеджер ответил с телефона → бот молчит
//  4) менеджер написал, пока бот ждал → отложенный ответ отменён
//  5) эхо собственного сообщения бота НЕ включает режим «менеджер в чате»
const http = require("http");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const MOCK_PORT = 3997;
const BOT_PORT = 3998;
const DELAY = 700;
const dataDir = path.join(__dirname, "..", ".test-data");
fs.rmSync(dataDir, { recursive: true, force: true });

// ---- мок WAHA: записывает все вызовы ----
const calls = [];
let msgN = 0;
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const payload = body ? JSON.parse(body) : {};
    calls.push({ path: req.url, payload });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/sendText") {
      res.end(JSON.stringify({ id: { _serialized: `true_${payload.chatId}_BOT${++msgN}` } }));
    } else {
      res.end(JSON.stringify({ ok: true }));
    }
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sendsTo = (chat) => calls.filter((c) => c.path === "/api/sendText" && c.payload.chatId === chat);

const TOKEN = "testsecret";
async function webhook(payload, token = TOKEN) {
  return fetch(`http://localhost:${BOT_PORT}/webhook${token ? `?token=${token}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "message.any", session: "default", payload }),
  });
}
const clientMsg = (chat, text, id) => ({ id: { _serialized: id }, from: chat, to: "77773539587@c.us", fromMe: false, body: text, hasMedia: false });
const outgoingMsg = (chat, text, id) => ({ id: { _serialized: id }, from: "77773539587@c.us", to: chat, fromMe: true, body: text, hasMedia: false });

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}${cond ? "" : "  " + extra}`);
  if (!cond) failures++;
}

(async () => {
  await new Promise((r) => mock.listen(MOCK_PORT, r));
  const bot = spawn(process.execPath, [path.join(__dirname, "..", "src", "index.js")], {
    env: {
      ...process.env,
      PORT: String(BOT_PORT),
      WAHA_URL: `http://localhost:${MOCK_PORT}`,
      MOCK_LLM: "1",
      REPLY_DELAY_MS: String(DELAY),
      HUMAN_COOLDOWN_MIN: "60",
      DATA_DIR: dataDir,
      LLM_API_KEY: "",
      STT_API_KEY: "",
      WEBHOOK_TOKEN: TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  bot.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write("[bot] " + d));
  bot.stderr.on("data", (d) => process.stdout.write("[bot err] " + d));
  await sleep(600);
  let bot2;

  try {
    console.log("1. Клиент пишет → бот отвечает после задержки");
    const A = "77011112233@c.us";
    await webhook(clientMsg(A, "Здравствуйте! Сколько стоит банкет на 50 человек?", "A1"));
    await sleep(DELAY / 2);
    check("до истечения задержки ответа нет", sendsTo(A).length === 0);
    await sleep(DELAY * 2);
    check("после задержки ровно один ответ", sendsTo(A).length === 1, JSON.stringify(sendsTo(A)));
    check("ответ от мок-LLM", (sendsTo(A)[0]?.payload.text || "").includes("[mock]"));
    check("отправлен sendSeen", calls.some((c) => c.path === "/api/sendSeen" && c.payload.chatId === A));
    check("отправлен startTyping", calls.some((c) => c.path === "/api/startTyping" && c.payload.chatId === A));

    console.log("2. Три сообщения подряд → один ответ");
    const B = "77022223344@c.us";
    await webhook(clientMsg(B, "Ассалаумағалейкум", "B1"));
    await sleep(150);
    await webhook(clientMsg(B, "Той жасаймыз", "B2"));
    await sleep(150);
    await webhook(clientMsg(B, "80 адам болады", "B3"));
    await sleep(DELAY * 2.5);
    check("ровно один ответ на пачку", sendsTo(B).length === 1, `got ${sendsTo(B).length}`);

    console.log("3. Менеджер уже в чате → бот молчит");
    const C = "77033334455@c.us";
    await webhook(outgoingMsg(C, "Добрый день, это менеджер, отвечаю вам", "H1"));
    await sleep(100);
    await webhook(clientMsg(C, "Сколько стоит кабинка?", "C1"));
    await sleep(DELAY * 2);
    check("бот не ответил", sendsTo(C).length === 0, `got ${sendsTo(C).length}`);

    console.log("4. Менеджер вмешался во время задержки → ответ отменён");
    const D = "77044445555@c.us";
    await webhook(clientMsg(D, "Здравствуйте, нужен зал", "D1"));
    await sleep(DELAY / 3);
    await webhook(outgoingMsg(D, "Здравствуйте! Уже отвечаю", "H2"));
    await sleep(DELAY * 2);
    check("бот не ответил", sendsTo(D).length === 0, `got ${sendsTo(D).length}`);

    console.log("5. Эхо сообщения бота не глушит бота");
    const botMsg = sendsTo(A)[0];
    await webhook(outgoingMsg(A, botMsg.payload.text, "true_" + A + "_BOT1"));
    await sleep(100);
    await webhook(clientMsg(A, "А меню какое?", "A2"));
    await sleep(DELAY * 2);
    check("бот ответил второй раз", sendsTo(A).length === 2, `got ${sendsTo(A).length}`);

    console.log("6. Вебхук без токена отвергается");
    const E = "77055556666@c.us";
    const res = await webhook(clientMsg(E, "Привет, я фальшивый вебхук", "E1"), null);
    check("HTTP 401", res.status === 401);
    await sleep(DELAY * 2);
    check("бот не отреагировал", sendsTo(E).length === 0, `got ${sendsTo(E).length}`);

    console.log("7. Чат с @lid-адресацией (давние контакты) обслуживается");
    const L = "135222851018965@lid";
    await webhook(clientMsg(L, "Здравствуйте, это старый контакт", "L1"));
    await sleep(DELAY * 2);
    check("бот ответил в @lid-чат", sendsTo(L).length === 1, `got ${sendsTo(L).length}`);

    console.log("8. Старое исходящее из синхронизации не глушит бота");
    const M = "77066667777@c.us";
    await webhook({ ...outgoingMsg(M, "давнее сообщение менеджера", "M1"), timestamp: Math.floor(Date.now() / 1000) - 3600 });
    await sleep(100);
    await webhook(clientMsg(M, "Сәлеметсіз бе!", "M2"));
    await sleep(DELAY * 2);
    check("бот ответил несмотря на старое исходящее", sendsTo(M).length === 1, `got ${sendsTo(M).length}`);

    console.log("8b. Команда «!бот» возвращает бота в заглушенный чат");
    const N = "77077778888@c.us";
    await webhook(outgoingMsg(N, "Я сам отвечу, подожди", "N1"));
    await sleep(100);
    await webhook(clientMsg(N, "Здравствуйте! Есть места на завтра?", "N2"));
    await sleep(DELAY * 1.5);
    check("после менеджера бот молчит", sendsTo(N).length === 0, `got ${sendsTo(N).length}`);
    await webhook(outgoingMsg(N, "!бот", "N3"));
    await sleep(DELAY * 2);
    check("после «!бот» бот ответил на ждавший вопрос", sendsTo(N).length === 1, `got ${sendsTo(N).length}`);

    console.log("8c. Эхо под другим id чата (lid↔c.us) не считается менеджером");
    const L2 = "135999000111@lid";
    await webhook(clientMsg(L2, "Здравствуйте! Караоке есть?", "L2a"));
    await sleep(DELAY * 2);
    check("бот ответил в lid-чат", sendsTo(L2).length === 1, `got ${sendsTo(L2).length}`);
    const aliasChat = "77099990000@c.us";
    await webhook(outgoingMsg(aliasChat, sendsTo(L2)[0].payload.text, "ECHO_ALIAS"));
    await sleep(100);
    await webhook(clientMsg(aliasChat, "Сколько стоит банкет на 20 гостей?", "AL1"));
    await sleep(DELAY * 2);
    check("алиас-эхо не заглушило чат", sendsTo(aliasChat).length === 1, `got ${sendsTo(aliasChat).length}`);

    console.log("8d. Исходящее с «[менеджер]:» в тексте — артефакт, не менеджер");
    const L3 = "77098765432@c.us";
    await webhook(outgoingMsg(L3, "[менеджер]: [менеджер]: 20 августа", "ART1"));
    await sleep(100);
    await webhook(clientMsg(L3, "Здравствуйте, есть места на завтра?", "L3a"));
    await sleep(DELAY * 2);
    check("артефакт не заглушил чат", sendsTo(L3).length === 1, `got ${sendsTo(L3).length}`);

    console.log("8e. Клиентские команды !стоп / !бот");
    const K1 = "77012340001@c.us";
    await webhook(clientMsg(K1, "Здравствуйте! Расскажите про залы", "K1a"));
    await sleep(DELAY * 2);
    check("бот ответил", sendsTo(K1).length === 1, `got ${sendsTo(K1).length}`);
    await webhook(clientMsg(K1, "!стоп", "K1b"));
    await sleep(400);
    check("подтверждение паузы отправлено сразу", sendsTo(K1).length === 2, `got ${sendsTo(K1).length}`);
    await webhook(clientMsg(K1, "Есть места на завтра?", "K1c"));
    await sleep(DELAY * 2);
    check("на паузе бот молчит", sendsTo(K1).length === 2, `got ${sendsTo(K1).length}`);
    await webhook(clientMsg(K1, "!бот", "K1d"));
    await sleep(400);
    check("подтверждение включения", sendsTo(K1).length === 3, `got ${sendsTo(K1).length}`);
    await webhook(clientMsg(K1, "Так есть места на завтра?", "K1e"));
    await sleep(DELAY * 2);
    check("после !бот бот снова отвечает", sendsTo(K1).length === 4, `got ${sendsTo(K1).length}`);

    console.log("9. Режим «по приветствию»: без приветствия — молчание");
    const dataDir2 = dataDir + "-trigger";
    fs.rmSync(dataDir2, { recursive: true, force: true });
    bot2 = spawn(process.execPath, [path.join(__dirname, "..", "src", "index.js")], {
      env: {
        ...process.env,
        PORT: "3996",
        WAHA_URL: `http://localhost:${MOCK_PORT}`,
        MOCK_LLM: "1",
        REPLY_DELAY_MS: String(DELAY),
        HUMAN_COOLDOWN_MIN: "60",
        DATA_DIR: dataDir2,
        LLM_API_KEY: "",
        STT_API_KEY: "",
        WEBHOOK_TOKEN: TOKEN,
        TRIGGER_MODE: "greeting",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    bot2.stderr.on("data", (d) => process.stdout.write("[bot2 err] " + d));
    await sleep(600);
    const webhook2 = (payload) =>
      fetch(`http://localhost:3996/webhook?token=${TOKEN}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "message.any", session: "default", payload }),
      });
    const P = "77088880001@c.us";
    await webhook2(clientMsg(P, "Скинь фотки со вчерашнего", "P1"));
    await sleep(DELAY * 2);
    check("личный чат без приветствия игнорируется", sendsTo(P).length === 0, `got ${sendsTo(P).length}`);

    console.log("10. Режим «по приветствию»: приветствие включает чат на сутки");
    const Q = "77088880002@c.us";
    await webhook2(clientMsg(Q, "Здравствуйте!", "Q1"));
    await sleep(DELAY * 2);
    check("после «Здравствуйте» бот ответил", sendsTo(Q).length === 1, `got ${sendsTo(Q).length}`);
    await webhook2(clientMsg(Q, "Сколько стоит банкет на 30 человек?", "Q2"));
    await sleep(DELAY * 2);
    check("следующее сообщение без приветствия тоже обслужено", sendsTo(Q).length === 2, `got ${sendsTo(Q).length}`);
    fs.rmSync(dataDir2, { recursive: true, force: true });
  } finally {
    bot.kill();
    if (bot2) bot2.kill();
    mock.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  console.log(failures ? `\n${failures} провал(ов)` : "\nВсе сценарии прошли ✅");
  process.exit(failures ? 1 : 0);
})();
