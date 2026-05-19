const avito = require('../services/avito');
const llm = require('../services/llm');

const { AVITO_USER_ID } = process.env;

/**
 * POST /webhook/avito
 * Принимает события из Авито (новые сообщения в чатах).
 *
 * Pipeline (async, fire-and-forget):
 *   фильтр автора → avito.getToken → llm.generateReply → avito.sendMessage
 */
async function avitoWebhook(req, res) {
  // Немедленно отвечаем — Авито ждёт 200 OK
  res.sendStatus(200);

  const { payload } = req.body;

  // Обрабатываем только текстовые сообщения
  if (!payload || payload.type !== 'message') {
    return;
  }

  // Не отвечаем на собственные сообщения
  if (String(payload.author_id) === String(AVITO_USER_ID)) {
    return;
  }

  const chatId = String(payload.chat_id);
  const text   = payload.content?.text || '';

  if (!text) {
    return;
  }

  console.log(`[webhook/avito] Новое сообщение в чате ${chatId}: "${text.slice(0, 80)}"`);

  (async () => {
    // 1. Получаем токен Авито
    let token;
    try {
      token = await avito.getToken();
    } catch (err) {
      console.error(`[webhook/avito] Ошибка получения токена: ${err.message}`);
      return;
    }

    // 2. Генерируем ответ через LLM (контекст пуст — режим первичной консультации)
    let reply;
    try {
      reply = await llm.generateReply(text, {});
    } catch (err) {
      console.error(`[webhook/avito] Ошибка LLM: ${err.message}`);
      reply = 'Здравствуйте! Уточню детали и отвечу вам в ближайшее время 😊';
    }

    // 3. Отправляем ответ в чат Авито
    try {
      await avito.sendMessage(token, AVITO_USER_ID, chatId, reply);
    } catch (err) {
      console.error(`[webhook/avito] Ошибка отправки сообщения: ${err.message}`);
    }
  })();
}

module.exports = avitoWebhook;
