#!/usr/bin/env node
// Извлекает RAW_PACKAGES из ../app.js (сайт-меню) и генерирует knowledge/menu.md.
// Запускать после каждого изменения меню на сайте:  npm run sync-menu
const fs = require("fs");
const path = require("path");

const appJsPath = path.join(__dirname, "..", "..", "app.js");
const outPath = path.join(__dirname, "..", "knowledge", "menu.md");

const appJs = fs.readFileSync(appJsPath, "utf8");
const m = appJs.match(/var RAW_PACKAGES = (\[[\s\S]*?\n {2}\]);/);
if (!m) {
  console.error("RAW_PACKAGES не найден в app.js — проверь scripts/sync-menu.js");
  process.exit(1);
}
const packages = new Function("return " + m[1])();

let out = "# Меню банкетных пакетов TÖR (цена за одного гостя)\n";
for (const pkg of packages) {
  out += `\n## Пакет ${pkg.priceNum} ₸ на гостя\n`;
  for (const sec of pkg.sections) {
    out += `\n### ${sec.title}\n`;
    for (const d of sec.dishes) {
      out += `- ${d.name}`;
      if (d.note) out += ` (${d.note})`;
      if (d.set && d.items) out += `: ${d.items.join(", ")}`;
      out += "\n";
    }
  }
}
out += "\nИтого за банкет = цена пакета × число гостей. Цены финальные, доплат нет.\n";

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out);
console.log(`knowledge/menu.md обновлён из app.js (${packages.length} пакета)`);
