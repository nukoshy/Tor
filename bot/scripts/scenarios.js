#!/usr/bin/env node
// Батарея юз-кейсов на живой модели: node scripts/scenarios.js [номера сценариев]
// Прогоняет реальные диалоги и печатает транскрипты — читаешь глазами и тюнишь промпт.
require("../src/config");
const { respond } = require("../src/brain");

const iso = (d) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() + d * 86400000)
  );

const SCENARIOS = [
  { n: 1, title: "Только «Здравствуйте» → русский, коротко, без прайса", turns: ["Здравствуйте!"] },
  { n: 2, title: "Только «Сәлеметсіз бе» → казахский", turns: ["Сәлеметсіз бе!"] },
  {
    n: 3,
    title: "Караоке: запись без банкетного прайса",
    turns: ["Здравствуйте, хотим записаться на караоке завтра на 20:00, нас будет 6 человек", "Диана"],
  },
  { n: 4, title: "Банкет на казахском: тут прайс уместен", turns: ["Сәлеметсіз бе! 60 адамға той жасаймыз, бағасы қанша болады?"] },
  { n: 5, title: "Адрес по-русски", turns: ["Добрый день! Подскажите адрес, как к вам доехать?"] },
  { n: 6, title: "Скидка на казахском: отказ без эскалации с первого раза", turns: ["Сәлеметсіз бе, жеңілдік бар ма?"] },
  {
    n: 7,
    title: "Смена языка посреди диалога",
    turns: ["Сәлеметсіз бе! Той жасағымыз келеді", "А можно по-русски? Сколько стоит на 40 человек?"],
  },
  { n: 8, title: "Поминальный обед днём → менеджер", turns: [`Здравствуйте. Нужен поминальный обед на ${iso(4)} днём, человек 40. Я Марат.`] },
  { n: 9, title: "Свои фрукты и торт", turns: ["Здравствуйте! А свой торт и фрукты можно принести?"] },
  { n: 10, title: "Просто поужинать впятером", turns: ["Здравствуйте, нас 5 человек, хотим просто поужинать сегодня вечером, можно?"] },
  {
    n: 11,
    title: "Караоке на казахском",
    turns: [`Сәлеметсіз бе! Караокеге жазылғым келеді, ${iso(2)} күні кешке, 4 адамбыз. Мен Айгерим`],
  },
  { n: 12, title: "Голосовое не распозналось", turns: ["[голосовое сообщение — распознать не удалось, вежливо попроси написать текстом]"] },
  {
    n: 13,
    title: "«Здравствуйте» после казахского диалога → строго русский",
    turns: ["Сәлеметсіз бе! Той жасаймыз, 50 адам", "Здравствуйте"],
  },
];

(async () => {
  const pick = process.argv.slice(2).map(Number);
  const list = pick.length ? SCENARIOS.filter((s) => pick.includes(s.n)) : SCENARIOS;
  for (const sc of list) {
    console.log(`\n${"=".repeat(72)}\n### ${sc.n}. ${sc.title}\n`);
    const history = [];
    const alerts = [];
    const deps = { alert: async (t) => alerts.push(t) };
    for (const t of sc.turns) {
      history.push({ role: "user", content: t });
      console.log(`КЛИЕНТ: ${t}`);
      try {
        const a = await respond("77012345678@c.us", history, deps);
        history.push({ role: "assistant", content: a });
        console.log(`БОТ:    ${a.replace(/\n/g, "\n        ")}\n`);
      } catch (e) {
        console.log(`ОШИБКА: ${e.message}\n`);
      }
    }
    for (const al of alerts) console.log(`📨 АЛЕРТ:\n${al}\n`);
  }
})();
