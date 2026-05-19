const axios = require('axios');

const {
  OPENROUTER_API_KEY,
  OPENROUTER_MODEL = 'openai/gpt-4o-mini',
  OPENROUTER_SITE_URL = 'http://localhost',
  OPENROUTER_APP_NAME = 'Rental AI Agent',
} = process.env;

if (!OPENROUTER_API_KEY) {
  console.warn('[llm] OPENROUTER_API_KEY не задан — генерация ответов работать не будет');
}

const openrouter = axios.create({
  baseURL: 'https://openrouter.ai/api/v1',
  headers: {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'HTTP-Referer': OPENROUTER_SITE_URL,
    'X-Title': OPENROUTER_APP_NAME,
    'Content-Type': 'application/json',
  },
  timeout: 30_000,
});

// ─── Системный промпт ─────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `Ты — Анна, вежливый и дружелюбный менеджер по посуточной аренде квартир.
Отвечай коротко (2–4 предложения), тепло и по делу.
Если знаешь данные гостя — используй их в ответе.
Если не знаешь ответа на вопрос — напиши: «Уточню для вас и отвечу в ближайшее время 😊».
Не придумывай адреса, цены и условия, если они не указаны в контексте.`;

/**
 * Формирует системный промпт с подстановкой контекста брони.
 * @param {object} context
 * @returns {string}
 */
function buildSystemPrompt(context = {}) {
  if (!context || Object.keys(context).length === 0) {
    return BASE_SYSTEM_PROMPT + '\n\nДанных о брони гостя пока нет — отвечай в режиме первичной консультации.';
  }

  const lines = [BASE_SYSTEM_PROMPT, '\nКонтекст текущей брони:'];

  if (context.guestName) lines.push(`- Имя гостя: ${context.guestName}`);
  if (context.apartment)  lines.push(`- Квартира: ${context.apartment}`);
  if (context.dateFrom)   lines.push(`- Дата заезда: ${context.dateFrom}`);
  if (context.dateTo)     lines.push(`- Дата выезда: ${context.dateTo}`);
  if (context.totalPrice) lines.push(`- Сумма брони: ${context.totalPrice} ₽`);
  if (context.source)     lines.push(`- Источник бронирования: ${context.source}`);

  return lines.join('\n');
}

// ─── Публичные функции ────────────────────────────────────────────────────────

/**
 * Генерирует ответ от имени «Анны» через OpenRouter API.
 *
 * @param {string} userMessage — сообщение от гостя
 * @param {object} context     — данные брони (см. SPECIFICATION §8)
 * @returns {string}           — текст ответа
 */
async function generateReply(userMessage, context = {}) {
  console.log(`[llm] generateReply: "${userMessage.slice(0, 60)}${userMessage.length > 60 ? '...' : ''}", model=${OPENROUTER_MODEL}`);

  const systemPrompt = buildSystemPrompt(context);

  try {
    const response = await openrouter.post('/chat/completions', {
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system',    content: systemPrompt },
        { role: 'user',      content: userMessage },
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const reply = response.data.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      throw new Error('Пустой ответ от OpenRouter');
    }

    console.log(`[llm] Ответ получен (${reply.length} символов)`);
    return reply;

  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.error?.message || err.message;

    if (status === 429) {
      console.error(`[llm] Rate limit (429): ${detail}`);
    } else if (status >= 500) {
      console.error(`[llm] Ошибка сервера OpenRouter (${status}): ${detail}`);
    } else if (err.code === 'ECONNABORTED') {
      console.error('[llm] Таймаут запроса (30 сек)');
    } else {
      console.error(`[llm] Ошибка: ${detail}`);
    }

    return 'Анна сейчас недоступна — отвечу вам в течение часа 😊';
  }
}

module.exports = {
  generateReply,
  buildSystemPrompt,
};
