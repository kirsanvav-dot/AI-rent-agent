const notion = require('../services/notion');
const llm = require('../services/llm');
const telegram = require('../services/telegram');
const realtycalendar = require('../services/realtycalendar');

const BIND_HINT =
  '\n\n💡 Чтобы я могла ответить по вашей брони, отправьте код брони или поделитесь контактом через кнопку.';

/** Источники RC — повторная синхронизация создаёт петлю (NFR-8). */
const RC_LOOP_SOURCES = new Set(['Яндекс Аренда', 'ЦИАН']);

/** @see CHANGE_REQUEST.md §1.3 — допустимые переходы статусов */
const ALLOWED_TRANSITIONS = {
  'Ожидает подтверждения': ['Подтверждена', 'Отменена'],
  'Подтверждена':          ['Заехал', 'Отменена'],
  'Заехал':                ['Завершена', 'Отменена'],
  'Завершена':             [],
  'Отменена':              [],
};

const ACTION_TO_STATUS = {
  status_confirmed:  'Подтверждена',
  status_checkedin:  'Заехал',
  status_completed:  'Завершена',
  status_cancelled:  'Отменена',
};

/**
 * POST /webhook/telegram
 * Принимает апдейты от Telegram Bot API.
 *
 * Логика (async, fire-and-forget):
 *   callback_query → owner guard → status transition / confirm_booking stub
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

function processTelegramUpdate(update) {
  if (update.callback_query) {
    handleCallbackQuery(update);
    return;
  }

  if (update.message?.contact) {
    handleContactMessage(update);
    return;
  }

  if (!update.message?.text) {
    return;
  }

  handleTextMessage(update);
}

async function telegramWebhook(req, res) {
  res.sendStatus(200);
  processTelegramUpdate(req.body);
}

async function handleConfirmBooking(pageId, callbackQueryId) {
  let booking = null;

  try {
    booking = await notion.findBookingByPageId(pageId);
  } catch (err) {
    console.error(`[webhook/telegram] Ошибка findBookingByPageId (confirm_booking): ${err.message}`);
    try {
      await telegram.answerCallbackQuery(callbackQueryId, 'Ошибка CRM');
    } catch (e) {
      console.error(`[webhook/telegram] Ошибка answerCallbackQuery: ${e.message}`);
    }
    return;
  }

  if (!booking) {
    console.error(`[webhook/telegram] confirm_booking: booking not found pageId=${pageId}`);
    try {
      await telegram.answerCallbackQuery(callbackQueryId, 'Бронь не найдена');
    } catch (err) {
      console.error(`[webhook/telegram] Ошибка answerCallbackQuery: ${err.message}`);
    }
    return;
  }

  console.log(
    `[webhook/telegram] confirm_booking: pageId=${pageId} source=${booking.source} rcSynced=${booking.rcSynced}`,
  );

  if (RC_LOOP_SOURCES.has(booking.source)) {
    try {
      await telegram.answerCallbackQuery(callbackQueryId, 'Бронь уже из RC, синхронизация не нужна');
    } catch (err) {
      console.error(`[webhook/telegram] Ошибка answerCallbackQuery: ${err.message}`);
    }
    return;
  }

  if (booking.rcSynced === true) {
    try {
      await telegram.answerCallbackQuery(callbackQueryId, 'Уже синхронизировано ✓');
    } catch (err) {
      console.error(`[webhook/telegram] Ошибка answerCallbackQuery: ${err.message}`);
    }
    return;
  }

  const dateFrom = booking.dates?.start;
  const dateTo = booking.dates?.end;
  if (!dateFrom || !dateTo) {
    try {
      await telegram.answerCallbackQuery(callbackQueryId, 'Укажите даты в CRM');
    } catch (err) {
      console.error(`[webhook/telegram] Ошибка answerCallbackQuery: ${err.message}`);
    }
    return;
  }

  try {
    await realtycalendar.blockDates({
      objectId: process.env.REALTYCALENDAR_OBJECT_ID,
      dateFrom,
      dateTo,
      externalRef: pageId,
    });

    await notion.updateBookingFields(pageId, { status: 'Подтверждена', rcSynced: true });
    await telegram.answerCallbackQuery(callbackQueryId, 'Даты заблокированы в ЦИАН и Яндексе ✓');
    await telegram.notifyOwner('✅ Бронь подтверждена, ЦИАН и Яндекс обновлены');
  } catch (err) {
    console.error(`[webhook/telegram] confirm_booking: ошибка RC: ${err.message}`);
    try {
      await telegram.answerCallbackQuery(callbackQueryId, 'Ошибка RC, попробуйте ещё раз');
    } catch (e) {
      console.error(`[webhook/telegram] Ошибка answerCallbackQuery: ${e.message}`);
    }
  }
}

function handleCallbackQuery(update) {
  const cq = update.callback_query;
  const fromId = cq.from.id;
  const callbackQueryId = cq.id;
  const callbackData = cq.data || '';

  (async () => {
    const ownerId = Number(process.env.TELEGRAM_OWNER_CHAT_ID);

    if (fromId !== ownerId) {
      try {
        await telegram.answerCallbackQuery(callbackQueryId, 'Нет доступа');
      } catch (err) {
        console.error(`[webhook/telegram] Ошибка answerCallbackQuery (access): ${err.message}`);
      }
      return;
    }

    const colonIdx = callbackData.indexOf(':');
    if (colonIdx === -1) {
      console.error(`[webhook/telegram] callback_query: invalid callback_data=${callbackData}`);
      try {
        await telegram.answerCallbackQuery(callbackQueryId, 'Неверный формат');
      } catch (err) {
        console.error(`[webhook/telegram] Ошибка answerCallbackQuery: ${err.message}`);
      }
      return;
    }

    const action = callbackData.slice(0, colonIdx);
    const pageId = callbackData.slice(colonIdx + 1);

    console.log(`[webhook/telegram] callback_query: action=${action} pageId=${pageId}`);

    if (action === 'confirm_booking') {
      await handleConfirmBooking(pageId, callbackQueryId);
      return;
    }

    const targetStatus = ACTION_TO_STATUS[action];
    if (!targetStatus) {
      console.error(`[webhook/telegram] callback_query: unknown action=${action}`);
      try {
        await telegram.answerCallbackQuery(callbackQueryId, 'Неизвестное действие');
      } catch (err) {
        console.error(`[webhook/telegram] Ошибка answerCallbackQuery: ${err.message}`);
      }
      return;
    }

    let booking = null;
    try {
      booking = await notion.findBookingByPageId(pageId);
    } catch (err) {
      console.error(`[webhook/telegram] Ошибка findBookingByPageId: ${err.message}`);
      try {
        await telegram.answerCallbackQuery(callbackQueryId, 'Ошибка CRM');
      } catch (e) {
        console.error(`[webhook/telegram] Ошибка answerCallbackQuery: ${e.message}`);
      }
      return;
    }

    if (!booking) {
      console.error(`[webhook/telegram] callback_query: booking not found pageId=${pageId}`);
      try {
        await telegram.answerCallbackQuery(callbackQueryId, 'Бронь не найдена');
      } catch (err) {
        console.error(`[webhook/telegram] Ошибка answerCallbackQuery: ${err.message}`);
      }
      return;
    }

    const allowed = ALLOWED_TRANSITIONS[booking.status] || [];
    if (!allowed.includes(targetStatus)) {
      console.error(
        `[webhook/telegram] callback_query: invalid transition ${booking.status} → ${targetStatus}`,
      );
      try {
        await telegram.answerCallbackQuery(callbackQueryId, 'Недопустимый переход');
      } catch (err) {
        console.error(`[webhook/telegram] Ошибка answerCallbackQuery: ${err.message}`);
      }
      return;
    }

    try {
      await notion.updateBookingStatus(pageId, targetStatus);
      await telegram.answerCallbackQuery(callbackQueryId, 'Статус обновлён ✓');
    } catch (err) {
      console.error(`[webhook/telegram] Ошибка updateBookingStatus: ${err.message}`);
      try {
        await telegram.answerCallbackQuery(callbackQueryId, 'Ошибка обновления');
      } catch (e) {
        console.error(`[webhook/telegram] Ошибка answerCallbackQuery: ${e.message}`);
      }
    }
  })();
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
module.exports.processTelegramUpdate = processTelegramUpdate;
