#!/usr/bin/env node
// Сравнение моделей на реальных вопросах клиентов (казахский + русский):  npm run bakeoff
// 1) скопируй bakeoff-models.example.json → bakeoff-models.json (какие модели сравниваем)
// 2) положи ключи в bot/.env (DEEPSEEK_API_KEY=…, QWEN_API_KEY=…)
// 3) результат — bot/bakeoff-results.md: читаешь и выбираешь модель по качеству казахского.
const fs = require("fs");
const path = require("path");
require("../src/config"); // подхватывает .env
const { chatComplete } = require("../src/llm");
const { systemPrompt } = require("../src/brain");

const modelsPath = path.join(__dirname, "bakeoff-models.json");
if (!fs.existsSync(modelsPath)) {
  console.error("Нет scripts/bakeoff-models.json — скопируй bakeoff-models.example.json и заполни.");
  process.exit(1);
}
const models = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
const questions = fs
  .readFileSync(path.join(__dirname, "bakeoff-questions.txt"), "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

(async () => {
  const sys = systemPrompt();
  let out = `# Бейкофф моделей для TÖR-бота\n\nДата: ${new Date().toISOString().slice(0, 10)}. Оцени сам: естественность казахского, точность фактов (фрукты нельзя! скидок нет!), тон.\n`;
  for (const q of questions) {
    out += `\n---\n\n## ❓ ${q}\n`;
    for (const m of models) {
      const apiKey = process.env[m.apiKeyEnv];
      if (!apiKey) {
        out += `\n### ${m.name}\n_пропущено: нет ключа в ${m.apiKeyEnv}_\n`;
        continue;
      }
      process.stdout.write(`${m.name} ← «${q.slice(0, 40)}…» `);
      try {
        const r = await chatComplete({
          messages: [
            { role: "system", content: sys },
            { role: "user", content: q },
          ],
          baseUrl: m.baseUrl,
          model: m.model,
          apiKey,
        });
        out += `\n### ${m.name}\n${r.content.trim()}\n`;
        console.log("✓");
      } catch (e) {
        out += `\n### ${m.name}\n_ошибка: ${e.message.slice(0, 200)}_\n`;
        console.log("✗", e.message.slice(0, 80));
      }
    }
  }
  const resPath = path.join(__dirname, "..", "bakeoff-results.md");
  fs.writeFileSync(resPath, out);
  console.log("\nГотово → bot/bakeoff-results.md");
})();
