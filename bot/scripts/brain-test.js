#!/usr/bin/env node
// Тесты логики бронирования (без LLM и календаря): даты, заявки, эскалация, сводка занятости.
process.env.DATA_DIR = require("path").join(__dirname, "..", ".test-data-brain");
const fs = require("fs");
const { _internals } = require("../src/brain");
const { runTool, daysFromToday, summarizeAvailability, sanitizeWhatsApp, detectLang } = _internals;

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}${cond ? "" : "  " + extra}`);
  if (!cond) failures++;
}
const tc = (name, args) => ({ id: "t1", function: { name, arguments: JSON.stringify(args) } });
// Даты считаем в часовом поясе ресторана (Asia/Almaty), как и сам бот, — иначе тест флакует по вечерам UTC
const iso = (daysAhead) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() + daysAhead * 86400000)
  );
const CHAT = "77009990000@c.us";

(async () => {
  console.log("Даты");
  check("сегодня = 0 дней", daysFromToday(iso(0)) === 0);
  check("кривая дата → null", daysFromToday("не дата") === null);

  let alerts = [];
  const deps = { alert: async (t) => alerts.push(t) };

  console.log("check_availability");
  let r = await runTool(tc("check_availability", { date: iso(40) }), CHAT, deps);
  check("дальше месяца → date_too_far", r.error === "date_too_far", JSON.stringify(r));
  r = await runTool(tc("check_availability", { date: iso(-2) }), CHAT, deps);
  check("прошлое → date_in_past", r.error === "date_in_past");
  r = await runTool(tc("check_availability", { date: "ерунда" }), CHAT, deps);
  check("мусор → bad_date", r.error === "bad_date");
  r = await runTool(tc("check_availability", { date: iso(5) }), CHAT, deps);
  check("календарь не настроен → status unknown", r.status === "unknown");

  console.log("create_hold (календарь не подключён)");
  alerts = [];
  r = await runTool(
    tc("create_hold", { date: iso(7), hall: "neke_sarayi", guests: 45, client_name: "Айгерим", event_type: "той", package: "20000" }),
    CHAT,
    deps
  );
  check("ok", r.ok === true, JSON.stringify(r));
  check("флаг: в календарь не записано", r.saved_to_calendar === false);
  check("менеджер уведомлён", alerts.length === 1);
  check("в уведомлении: зал", (alerts[0] || "").includes("Неке сарайы"));
  check("в уведомлении: имя и гости", /Айгерим/.test(alerts[0]) && /45 гостей/.test(alerts[0]));
  check("в уведомлении: телефон клиента", alerts[0].includes("+77009990000"));
  check("в уведомлении: пакет", alerts[0].includes("20000 ₸"));

  r = await runTool(tc("create_hold", { date: iso(40), hall: "kabinka", guests: 10, client_name: "Тест" }), CHAT, deps);
  check("hold дальше месяца → отказ", r.error === "date_too_far");

  alerts = [];
  r = await runTool(
    tc("create_hold", { date: iso(3), time_start: "вечером", hall: "kabinka", guests: 12, client_name: "Динара" }),
    CHAT,
    deps
  );
  check("кривое время старта → откат на 16:00", r.ok === true && alerts[0].includes("с 16:00"), alerts[0]);

  alerts = [];
  r = await runTool(
    tc("create_hold", { date: iso(2), time_start: "20:00", hall: "karaoke", guests: 6, client_name: "Диана", event_type: "караоке" }),
    CHAT,
    deps
  );
  check("караоке-заявка: зал и время в алерте", r.ok === true && alerts[0].includes("Караоке") && alerts[0].includes("с 20:00"), alerts[0]);

  console.log("notify_manager");
  alerts = [];
  r = await runTool(tc("notify_manager", { summary: "Клиент просит поминальный обед днём" }), CHAT, deps);
  check("ok", r.ok === true);
  check("сводка и телефон в уведомлении", alerts[0].includes("поминальный") && alerts[0].includes("+77009990000"));

  console.log("Сводка занятости (приватность)");
  let a = summarizeAvailability([{ summary: "HOLD · Кабинка · Айбек · 12 гостей" }]);
  check("1 кабинка занята → свободна 1 из 2", a.kabinka === "свободна 1 из 2", JSON.stringify(a));
  a = summarizeAvailability([{ summary: "Кабинка · X" }, { summary: "HOLD · Кабинка · Y" }, { summary: "Неке сарайы · той" }]);
  check("обе кабинки заняты", a.kabinka === "заняты обе");
  check("Неке сарайы занят", a.neke_sarayi === "занят");
  check("банкетный зал свободен", a.banket_zal === "свободен");
  a = summarizeAvailability([{ summary: "HOLD · Караоке · Диана · 6 гостей" }]);
  check("караоке-бронь не считается залом и не даёт предупреждения", !a.warning && a.kabinka === "свободны обе" && Boolean(a.karaoke), JSON.stringify(a));
  a = summarizeAvailability([{ summary: "День рождения Азамата" }]);
  check("непонятное событие → предупреждение", Boolean(a.warning));
  check("имена не просачиваются в сводку", !JSON.stringify(a).includes("Азамат"));
  a = summarizeAvailability([]);
  check("пусто → всё свободно", a.kabinka === "свободны обе" && a.neke_sarayi === "свободен" && a.banket_zal === "свободен");

  console.log("Определение языка клиента");
  check("«Здравствуйте» → ru", detectLang("Здравствуйте") === "ru");
  check("«На 20 число» → ru", detectLang("На 20 число") === "ru");
  check("«Хотела бронь» → ru", detectLang("Хотела бронь") === "ru");
  check("«Сәлеметсіз бе» → kk", detectLang("Сәлеметсіз бе") === "kk");
  check("«20 тамызға бронь керек» → kk", detectLang("20 тамызға бронь керек") === "kk");
  check("«Ассалаумагалейкум» → kk", detectLang("Ассалаумагалейкум") === "kk");
  check("латиница/цифры → null", detectLang("ok 123") === null);

  console.log("Санитайзер WhatsApp");
  check("**жирный** → *жирный*", sanitizeWhatsApp("У нас **Неке сарайы** свободен") === "У нас *Неке сарайы* свободен");
  check("заголовки убраны", sanitizeWhatsApp("## Меню\n- Чай") === "Меню\n- Чай");
  check("__курсив__ → _курсив_", sanitizeWhatsApp("__важно__") === "_важно_");
  check("обычный текст не тронут", sanitizeWhatsApp("Итого 800 000 ₸ за 40 гостей") === "Итого 800 000 ₸ за 40 гостей");

  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} провал(ов)` : "\nЛогика бронирования в порядке ✅");
  process.exit(failures ? 1 : 0);
})();
