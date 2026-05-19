const notion = require('../services/notion');
const llm = require('../services/llm');
const telegram = require('../services/telegram');

/**
 * POST /webhook/telegram
 * Принимает апдейты от Telegram Bot API.
 *
 * Логика (async, fire-and-forget):
 *   chat_id → notion.findBookingByChatId → llm.generateReply → telegram.sendMessage
 * Если бронь не найдена — отвечаем в режиме консультации + уведомляем владельца.
 */
async function telegramWebhook(req, res) {
  // Немедленно отвечаем Telegram, иначе он будет слать повторы
  res.sendStatus(200);

  const update = req.body;

  // Обрабатываем только обычные сообщения
  if (!update.message?.text) {
    return;
  }

  const chatId = update.message.chat.id;
  const text   = update.message.text.trim();
  const from   = update.message.from?.first_name || 'Гость';

  console.log(`[webhook/telegram] chat_id=${chatId}, от="${from}": "${text}"`);

  // Асинхронная обработка — ошибки не должны прерывать друг друга
  (async () => {
    // 1. Ищем бронь гостя в Notion
    let booking = null;
    let context = {};

    try {
      booking = await notion.findBookingByChatId(chatId);
    } catch (err) {
      console.error(`[webhook/telegram] Ошибка поиска брони: ${err.message}`);
    }

    if (booking) {
      context = {
        guestName:  booking.guestName,
        apartment:  booking.apartment,
        dateFrom:   booking.dates?.start,
        dateTo:     booking.dates?.end,
        totalPrice: booking.totalPrice,
        source:     booking.source,
      };
    } else {
      // Уведомляем владельца о незнакомом госте
      try {
        await telegram.notifyOwner(
          `⚠️ <b>Неизвестный гость</b>\n\n` +
          `chat_id: <code>${chatId}</code>\n` +
          `Имя: ${from}\n` +
          `Сообщение: «${text}»\n\n` +
          `Бронь в CRM не найдена. Ответил в режиме консультации.`
        );
      } catch (err) {
        console.error(`[webhook/telegram] Ошибка уведомления владельца: ${err.message}`);
      }
    }

    // 2. Генерируем ответ через LLM
    let reply;
    try {
      reply = await llm.generateReply(text, context);
    } catch (err) {
      console.error(`[webhook/telegram] Ошибка LLM: ${err.message}`);
      reply = 'Анна сейчас недоступна — отвечу вам в течение часа 😊';
    }

    // 3. Отправляем ответ гостю
    try {
      await telegram.sendMessage(chatId, reply);
    } catch (err) {
      console.error(`[webhook/telegram] Ошибка отправки сообщения: ${err.message}`);
    }
  })();
}

module.exports = telegramWebhook;
