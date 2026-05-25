const TelegramBot = require('node-telegram-bot-api');
const { formatDateRange } = require('../utils/formatDate');
const { getTelegramProxyUrl, buildRequestOptionsForTelegramBot } = require('../utils/proxyConfig');

const { TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_CHAT_ID } = process.env;

if (!TELEGRAM_BOT_TOKEN) {
  console.warn('[telegram] TELEGRAM_BOT_TOKEN не задан — отправка сообщений работать не будет');
}
if (!TELEGRAM_OWNER_CHAT_ID) {
  console.warn('[telegram] TELEGRAM_OWNER_CHAT_ID не задан — уведомления владельцу работать не будут');
}

const telegramProxy = getTelegramProxyUrl();
if (telegramProxy) {
  console.log(`[telegram] Исходящие запросы Bot API через proxy: ${telegramProxy}`);
}

const botOptions = { polling: false };
const proxyRequest = buildRequestOptionsForTelegramBot();
if (Object.keys(proxyRequest).length > 0) {
  botOptions.request = proxyRequest;
}

const bot = TELEGRAM_BOT_TOKEN
  ? new TelegramBot(TELEGRAM_BOT_TOKEN, botOptions)
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

/**
 * Отправляет HTML-сообщение с inline-клавиатурой.
 *
 * @param {number|string} chatId
 * @param {string} text
 * @param {Array<Array<{text: string, callback_data: string}>>} inlineKeyboard
 */
async function sendMessageWithKeyboard(chatId, text, inlineKeyboard) {
  if (!bot) {
    console.warn('[telegram] sendMessageWithKeyboard пропущен — бот не инициализирован');
    return;
  }

  console.log(`[telegram] sendMessageWithKeyboard: chatId=${chatId}, buttons=${inlineKeyboard.flat().length}`);

  await bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}

/**
 * Отправляет HTML-уведомление владельцу с inline-кнопками.
 *
 * @param {string} html
 * @param {Array<Array<{text: string, callback_data: string}>>} inlineKeyboard
 */
async function notifyOwnerWithActions(html, inlineKeyboard) {
  if (!bot) {
    console.warn('[telegram] notifyOwnerWithActions пропущен — бот не инициализирован');
    return;
  }
  if (!TELEGRAM_OWNER_CHAT_ID) {
    console.warn('[telegram] notifyOwnerWithActions пропущен — TELEGRAM_OWNER_CHAT_ID не задан');
    return;
  }

  console.log(`[telegram] notifyOwnerWithActions: ownerChatId=${TELEGRAM_OWNER_CHAT_ID}, buttons=${inlineKeyboard.flat().length}`);

  await sendMessageWithKeyboard(TELEGRAM_OWNER_CHAT_ID, html, inlineKeyboard);
}

/**
 * Подтверждает нажатие inline-кнопки (убирает «часики»).
 *
 * @param {string} callbackQueryId
 * @param {string} text — всплывающий текст для пользователя
 */
async function answerCallbackQuery(callbackQueryId, text) {
  if (!bot) {
    console.warn('[telegram] answerCallbackQuery пропущен — бот не инициализирован');
    return;
  }

  console.log(`[telegram] answerCallbackQuery: id=${callbackQueryId}, text="${text}"`);

  await bot.answerCallbackQuery(callbackQueryId, { text });
}

module.exports = {
  bot,
  ownerChatId: TELEGRAM_OWNER_CHAT_ID,
  sendMessage,
  notifyOwner,
  formatBookingNotification,
  sendMessageWithKeyboard,
  notifyOwnerWithActions,
  answerCallbackQuery,
};
