// Распознавание голосовых (Whisper-совместимый endpoint; понимает казахский и русский)
const cfg = require("./config");

async function transcribe(buf, filename = "voice.ogg") {
  if (!cfg.stt.apiKey) return null; // STT не настроен — вызывающий код вежливо попросит написать текстом
  const fd = new FormData();
  fd.append("file", new Blob([buf]), filename);
  fd.append("model", cfg.stt.model);
  const res = await fetch(`${cfg.stt.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.stt.apiKey}` },
    body: fd,
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.text || "").trim() || null;
}

module.exports = { transcribe };
