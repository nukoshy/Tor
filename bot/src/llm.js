// Вызов LLM через любой OpenAI-совместимый API (DeepSeek, Qwen, Groq, Anthropic compat, …)
const cfg = require("./config");

async function chatComplete({ messages, tools, model, baseUrl, apiKey }) {
  if (cfg.llm.mock) {
    return { content: "[mock] Здравствуйте! Это тестовый ответ AI-администратора TÖR.", toolCalls: [], raw: null };
  }
  const body = { model: model || cfg.llm.model, messages, temperature: 0.4 };
  if (tools && tools.length) body.tools = tools;
  const res = await fetch(`${(baseUrl || cfg.llm.baseUrl).replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey || cfg.llm.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const msg = data.choices[0].message;
  return { content: msg.content || "", toolCalls: msg.tool_calls || [], raw: msg };
}

module.exports = { chatComplete };
