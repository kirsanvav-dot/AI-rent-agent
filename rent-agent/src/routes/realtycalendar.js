const notion = require('../services/notion');
const avito = require('../services/avito');
const telegram = require('../services/telegram');
const { formatBookingNotification } = require('../services/telegram');

/** Inline-клавиатура смены статуса для уведомления владельцу (ARCHITECTURE §3.6). */
function buildStatusKeyboard(pageId) {
  return [
    [
      { text: '🏠 Заехал', callback_data: `status_checkedin:${pageId}` },
      { text: '🎉 Завершена', callback_data: `status_completed:${pageId}` },
    ],
    [
      { text: '❌ Отменена', callback_data: `status_cancelled:${pageId}` },
    ],
  ];
}

/**
 * POST /webhook/realtycalendar
 * Принимает события о бронях от RealtyCalendar (Яндекс Путешествия, ЦИАН).
 *
 * Pipeline (async, fire-and-forget):
 *   маппинг JSON → notion.createBooking → avito.blockDates → telegram.notifyOwner
 */
async function realtycalendarWebhook(req, res) {
  // Отвечаем немедленно — RealtyCalendar ждёт 200 OK в течение 3 секунд
  res.sendStatus(200);

  const body = req.body;

  if (body.action !== 'create_booking') {
    console.log(`[webhook/realtycalendar] Пропущено событие: action=${body.action}`);
    return;
  }

  console.log(`[webhook/realtycalendar] Новая бронь: ${body.booking_id}`);

  // ── Маппинг входящего JSON → BookingData ──────────────────────────────────
  const bookingData = {
    bookingId:  String(body.booking_id),
    guestName:  body.guest?.name        || '',
    phone:      body.guest?.phone       || '',
    dateFrom:   body.date_from          || '',
    dateTo:     body.date_to            || '',
    apartment:  body.property?.title    || '',
    source:     body.booking_origin?.title || 'RealtyCalendar',
    totalPrice: typeof body.total_price === 'number' ? body.total_price : Number(body.total_price) || 0,
    status:     'Подтверждена',
    avitoItemId: body.property?.avito_item_id || null,
  };

  // ── Шаг 1: сохраняем в Notion ─────────────────────────────────────────────
  let savedBooking = null;
  try {
    savedBooking = await notion.createBooking(bookingData);
    console.log(`[webhook/realtycalendar] Notion: бронь сохранена (pageId=${savedBooking.pageId})`);
  } catch (err) {
    console.error(`[webhook/realtycalendar] Ошибка Notion: ${err.message}`);
  }

  // ── Шаг 2: блокируем даты на Авито (только если есть avito_item_id) ───────
  if (bookingData.avitoItemId && bookingData.dateFrom && bookingData.dateTo) {
    try {
      const token = await avito.getToken();
      await avito.blockDates(
        token,
        avito.userId,
        bookingData.avitoItemId,
        bookingData.dateFrom,
        bookingData.dateTo
      );
      console.log(`[webhook/realtycalendar] Авито: даты заблокированы`);
    } catch (err) {
      console.error(`[webhook/realtycalendar] Ошибка Авито: ${err.message}`);
    }
  } else {
    console.log(`[webhook/realtycalendar] Авито: пропущено (нет avito_item_id в вебхуке)`);
  }

  // ── Шаг 3: уведомляем владельца в Telegram ────────────────────────────────
  try {
    const html = formatBookingNotification(bookingData);
    if (savedBooking?.pageId) {
      await telegram.notifyOwnerWithActions(html, buildStatusKeyboard(savedBooking.pageId));
    } else {
      await telegram.notifyOwner(html);
    }
    console.log(`[webhook/realtycalendar] Telegram: уведомление отправлено`);
  } catch (err) {
    console.error(`[webhook/realtycalendar] Ошибка Telegram: ${err.message}`);
  }
}

module.exports = realtycalendarWebhook;
