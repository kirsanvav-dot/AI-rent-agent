const TelegramBot = require('node-telegram-bot-api');
const { formatDateRange } = require('../utils/formatDate');

const { TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_CHAT_ID } = process.env;

if (!TELEGRAM_BOT_TOKEN) {
  console.warn('[telegram] TELEGRAM_BOT_TOKEN не задан — отправка сообщений работать не будет');
}
if (!TELEGRAM_OWNER_CHAT_ID) {
  console.warn('[telegram] TELEGRAM_OWNER_CHAT_ID не задан — уведомления владельцу работать не будут');
}

const bot = TELEGRAM_BOT_TOKEN
  ? new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false })
  : null;

// ─── Публичные функции ────────────────────────────────────────────────────────

/**
 * Отправляет текстовое сообщение гостю.
 *
 * @param {number|string} chatId — Telegram chat_id получателя
 * @param {string} text         — текст сообщения
 */
async function sendMessage(chatId, text) {
  if (!bot) {
    console.warn('[telegram] sendMessage пропущен — бот не инициализирован');
    return;
  }

  console.log(`[telegram] sendMessage → chatId=${chatId}: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);

  await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

/**
 * Отправляет HTML-уведомление владельцу.
 *
 * @param {string} html — HTML-текст уведомления
 */
async function notifyOwner(html) {
  if (!bot) {
    console.warn('[telegram] notifyOwner пропущен — бот не инициализирован');
    return;
  }
  if (!TELEGRAM_OWNER_CHAT_ID) {
    console.warn('[telegram] notifyOwner пропущен — TELEGRAM_OWNER_CHAT_ID не задан');
    return;
  }

  console.log(`[telegram] notifyOwner → ownerChatId=${TELEGRAM_OWNER_CHAT_ID}`);

  await bot.sendMessage(TELEGRAM_OWNER_CHAT_ID, html, { parse_mode: 'HTML' });
}

/**
 * Формирует HTML-уведомление о новой брони для владельца.
 *
 * @param {object} booking — объект брони (BookingData)
 * @returns {string}
 */
function formatBookingNotification(booking) {
  const dates = formatDateRange(booking.dateFrom || booking.dates?.start, booking.dateTo || booking.dates?.end);

  return [
    `🏠 <b>Новая бронь!</b>`,
    ``,
    `👤 <b>Гость:</b> ${booking.guestName || '—'}`,
    `📞 <b>Телефон:</b> ${booking.phone || '—'}`,
    `🏢 <b>Квартира:</b> ${booking.apartment || '—'}`,
    `📅 <b>Даты:</b> ${dates || '—'}`,
    `💰 <b>Сумма:</b> ${booking.totalPrice ? booking.totalPrice.toLocaleString('ru-RU') + ' ₽' : '—'}`,
    `🔗 <b>Источник:</b> ${booking.source || '—'}`,
    `🆔 <b>ID брони:</b> <code>${booking.bookingId || '—'}</code>`,
  ].join('\n');
}

module.exports = {
  bot,
  ownerChatId: TELEGRAM_OWNER_CHAT_ID,
  sendMessage,
  notifyOwner,
  formatBookingNotification,
};
