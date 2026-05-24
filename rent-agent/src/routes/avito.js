const avito = require('../services/avito');
const llm = require('../services/llm');
const notion = require('../services/notion');
const telegram = require('../services/telegram');
const { formatBookingNotification } = require('../services/telegram');

const { AVITO_USER_ID } = process.env;

/** Клавиатура для нового Авито-лида (ARCHITECTURE §3.6). */
function buildAvitoLeadKeyboard(pageId) {
  return [
    [
      { text: '🔒 Подтвердить бронь', callback_data: `confirm_booking:${pageId}` },
      { text: '❌ Отменена', callback_data: `status_cancelled:${pageId}` },
    ],
  ];
}

/**
 * POST /webhook/avito
 * Принимает события из Авито (новые сообщения в чатах).
 *
 * Pipeline (async, fire-and-forget):
 *   фильтр автора → avito.getToken → Notion CRM → llm.generateReply → avito.sendMessage
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
    status:     booking.status,
  };
}

function extractGuestFromPayload(payload) {
  const guestName =
    payload.user?.name ||
    payload.author?.name ||
    payload.user_name ||
    payload.sender?.name ||
    '';
  const phone =
    payload.user?.phone ||
    payload.phone ||
    payload.contact?.phone ||
    '';

  return {
    guestName: guestName || undefined,
    phone: phone || undefined,
  };
}

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

    // 2. Notion CRM: поиск или создание лида
    let booking = null;
    let context = {};

    try {
      booking = await notion.findBookingByAvitoChatId(chatId);
      if (booking) {
        console.log(`[webhook/avito] findBookingByAvitoChatId: chatId=${chatId} found pageId=${booking.pageId}`);
      } else {
        console.log(`[webhook/avito] findBookingByAvitoChatId: chatId=${chatId} not found`);
      }
    } catch (err) {
      console.error(`[webhook/avito] Ошибка findBookingByAvitoChatId: ${err.message}`);
    }

    if (!booking) {
      try {
        const guest = extractGuestFromPayload(payload);
        booking = await notion.createBooking({
          bookingId: `AVITO-${chatId}`,
          source: 'Авито',
          avitoChatId: chatId,
          avitoItemId: payload.item_id || null,
          status: 'Ожидает подтверждения',
          guestName: guest.guestName,
          phone: guest.phone,
        });
        console.log(`[webhook/avito] findBookingByAvitoChatId: chatId=${chatId} created pageId=${booking.pageId}`);

        try {
          const html = formatBookingNotification({
            bookingId: booking.bookingId,
            guestName: booking.guestName,
            phone: booking.phone,
            apartment: booking.apartment,
            dateFrom: booking.dates?.start,
            dateTo: booking.dates?.end,
            totalPrice: booking.totalPrice,
            source: booking.source,
          });
          await telegram.notifyOwnerWithActions(html, buildAvitoLeadKeyboard(booking.pageId));
          console.log(`[webhook/avito] notifyOwnerWithActions: pageId=${booking.pageId}`);
        } catch (err) {
          console.error(`[webhook/avito] Ошибка notifyOwnerWithActions: ${err.message}`);
        }
      } catch (err) {
        console.error(`[webhook/avito] Ошибка createBooking: ${err.message}`);
      }
    } else {
      const guest = extractGuestFromPayload(payload);
      const fields = {};
      if (guest.guestName) fields.guestName = guest.guestName;
      if (guest.phone) fields.phone = guest.phone;

      if (Object.keys(fields).length > 0) {
        try {
          booking = await notion.updateBookingFields(booking.pageId, fields);
          console.log(`[webhook/avito] updateBookingFields: pageId=${booking.pageId}`);
        } catch (err) {
          console.error(`[webhook/avito] Ошибка updateBookingFields: ${err.message}`);
        }
      }
    }

    context = buildContextFromBooking(booking);

    // 3. Генерируем ответ через LLM
    let reply;
    try {
      reply = await llm.generateReply(text, context);
    } catch (err) {
      console.error(`[webhook/avito] Ошибка LLM: ${err.message}`);
      reply = 'Здравствуйте! Уточню детали и отвечу вам в ближайшее время 😊';
    }

    // 4. Отправляем ответ в чат Авито
    try {
      await avito.sendMessage(token, AVITO_USER_ID, chatId, reply);
    } catch (err) {
      console.error(`[webhook/avito] Ошибка отправки сообщения: ${err.message}`);
    }
  })();
}

module.exports = avitoWebhook;
