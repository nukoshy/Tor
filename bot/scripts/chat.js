#!/usr/bin/env node
// Локальный чат с «мозгом» бота без WhatsApp:  npm run chat
// Нужен LLM_API_KEY в bot/.env (или MOCK_LLM=1 для проверки каркаса).
const readline = require("readline");
const { respond } = require("../src/brain");

const history = [];
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const alert = async (t) => console.log("\n📨 [уведомление менеджеру]\n" + t + "\n");

console.log("Чат с AI-администратором TÖR. Пишите по-казахски или по-русски. Ctrl+C — выход.\n");

(function loop() {
  rl.question("Вы: ", async (q) => {
    if (!q.trim()) return loop();
    history.push({ role: "user", content: q });
    try {
      const a = await respond("77000000000@c.us", history, { alert });
      history.push({ role: "assistant", content: a });
      console.log("\nTÖR: " + a + "\n");
    } catch (e) {
      console.error("Ошибка:", e.message);
    }
    loop();
  });
})();
