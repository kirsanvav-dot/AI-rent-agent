const notion = require('../services/notion');
const llm = require('../services/llm');
const telegram = require('../services/telegram');

const BIND_HINT =
  '\n\n💡 Чтобы я могла ответить по вашей брони, отправьте код брони или поделитесь контактом через кнопку.';

/**
 * POST /webhook/telegram
 * Принимает апдейты от Telegram Bot API.
 *
 * Логика (async, fire-and-forget):
 *   message.text → findBookingByChatId → [bookingId/phone match] → llm → sendMessage
 *   message.contact → findBookingByPhone → updateBookingFields → sendMessage
 */
function buildContextFromBooking(booking) {
  if (!booking) return {};
  return {
    guestName:  booking.guestName,
    apartment:  booking.apartment,
    dateFrom:   booking.dates?.start,
    dateTo:     booking.dates?.end,
    totalPrice: booking.totalPrice,
    source:     booking.source,
  };
}

function looksLikePhone(text) {
  return String(text).replace(/\D/g, '').length >= 10;
}

async function telegramWebhook(req, res) {
  res.sendStatus(200);

  const update = req.body;

  if (update.message?.contact) {
    handleContactMessage(update);
    return;
  }

  if (!update.message?.text) {
    return;
  }

  handleTextMessage(update);
}

function handleContactMessage(update) {
  const chatId = update.message.chat.id;
  const phone  = update.message.contact.phone_number;
  const from   = update.message.from?.first_name || 'Гость';

  console.log(`[webhook/telegram] contact chat_id=${chatId}, от="${from}", phone=${phone}`);

  (async () => {
    let booking = null;

    try {
      booking = await notion.findBookingByPhone(phone);
      if (booking) {
        console.log(`[webhook/telegram] match by contact: chatId=${chatId} pageId=${booking.pageId}`);
      }
    } catch (err) {
      console.error(`[webhook/telegram] Ошибка findBookingByPhone (contact): ${err.message}`);
    }

    if (booking) {
      try {
        await notion.updateBookingFields(booking.pageId, { telegramChatId: chatId });
      } catch (err) {
        console.error(`[webhook/telegram] Ошибка updateBookingFields (contact): ${err.message}`);
      }

      try {
        await telegram.sendMessage(chatId, 'Готово, теперь я вас узнаю 👍');
      } catch (err) {
        console.error(`[webhook/telegram] Ошибка отправки сообщения (contact): ${err.message}`);
      }
      return;
    }

    try {
      await telegram.sendMessage(
        chatId,
        'Не нашла вашу бронь по этому номеру. Отправьте код брони или напишите нам.',
      );
    } catch (err) {
      console.error(`[webhook/telegram] Ошибка отправки сообщения (contact, not found): ${err.message}`);
    }

    try {
      await telegram.notifyOwner(
        `⚠️ <b>Контакт без брони</b>\n\n` +
        `chat_id: <code>${chatId}</code>\n` +
        `Имя: ${from}\n` +
        `Телефон: ${phone}\n\n` +
        `Бронь в CRM не найдена.`,
      );
    } catch (err) {
      console.error(`[webhook/telegram] Ошибка уведомления владельца (contact): ${err.message}`);
    }
  })();
}

function handleTextMessage(update) {
  const chatId = update.message.chat.id;
  const text   = update.message.text.trim();
  const from   = update.message.from?.first_name || 'Гость';

  console.log(`[webhook/telegram] chat_id=${chatId}, от="${from}": "${text}"`);

  (async () => {
    let booking = null;
    let context = {};
    let unknownGuest = false;

    try {
      booking = await notion.findBookingByChatId(chatId);
    } catch (err) {
      console.error(`[webhook/telegram] Ошибка поиска брони: ${err.message}`);
    }

    if (booking) {
      context = buildContextFromBooking(booking);
    } else {
      let matchedBy = null;

      try {
        booking = await notion.findBookingByBookingId(text);
        if (booking) matchedBy = 'bookingId';
      } catch (err) {
        console.error(`[webhook/telegram] Ошибка findBookingByBookingId: ${err.message}`);
      }

      if (!booking && looksLikePhone(text)) {
        try {
          booking = await notion.findBookingByPhone(text);
          if (booking) matchedBy = 'phone';
        } catch (err) {
          console.error(`[webhook/telegram] Ошибка findBookingByPhone: ${err.message}`);
        }
      }

      if (booking && matchedBy) {
        console.log(`[webhook/telegram] match by ${matchedBy}: chatId=${chatId} pageId=${booking.pageId}`);

        try {
          booking = await notion.updateBookingFields(booking.pageId, { telegramChatId: chatId });
        } catch (err) {
          console.error(`[webhook/telegram] Ошибка updateBookingFields: ${err.message}`);
        }

        context = buildContextFromBooking(booking);
      } else {
        unknownGuest = true;

        try {
          await telegram.notifyOwner(
            `⚠️ <b>Неизвестный гость</b>\n\n` +
            `chat_id: <code>${chatId}</code>\n` +
            `Имя: ${from}\n` +
            `Сообщение: «${text}»\n\n` +
            `Бронь в CRM не найдена. Ответил в режиме консультации.`,
          );
        } catch (err) {
          console.error(`[webhook/telegram] Ошибка уведомления владельца: ${err.message}`);
        }
      }
    }

    let reply;
    try {
      reply = await llm.generateReply(text, context);
    } catch (err) {
      console.error(`[webhook/telegram] Ошибка LLM: ${err.message}`);
      reply = 'Анна сейчас недоступна — отвечу вам в течение часа 😊';
    }

    if (unknownGuest) {
      reply += BIND_HINT;
    }

    try {
      await telegram.sendMessage(chatId, reply);
    } catch (err) {
      console.error(`[webhook/telegram] Ошибка отправки сообщения: ${err.message}`);
    }
  })();
}

module.exports = telegramWebhook;
