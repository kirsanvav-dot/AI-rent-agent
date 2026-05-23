/**
 * Smoke-тест интеграции с Telegram.
 * Запуск: node tests/test_telegram.js
 *
 * Что проверяет:
 *  1. Инициализацию бота (токен валиден)
 *  2. Формирование HTML-уведомления о брони
 *  3. Отправку тестового сообщения владельцу (реальный вызов API)
 *
 * ⚠️  Тест отправляет реальное сообщение в Telegram владельцу.
 *     Убедись, что TELEGRAM_OWNER_CHAT_ID задан верно.
 */
require('dotenv').config();

const { bot, sendMessage, notifyOwner, formatBookingNotification, notifyOwnerWithActions } = require('../src/services/telegram');

const TEST_BOOKING = {
  bookingId:  'TEST-001',
  guestName:  'Тестовый Гость',
  phone:      '+79001234567',
  apartment:  '1й проезд Марьиной рощи д11',
  dateFrom:   '2026-07-01',
  dateTo:     '2026-07-03',
  totalPrice: 5000,
  source:     'Другое',
};

async function run() {
  let passed = 0;
  let failed = 0;

  function ok(label, detail = '') {
    console.log(`  ✓ ${label}${detail ? ': ' + detail : ''}`);
    passed++;
  }

  function fail(label, err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }

  // ── Тест 1: бот инициализирован ──────────────────────────────────────────
  console.log('\n── Тест 1: инициализация бота ─────────────────────────');
  try {
    if (!bot) throw new Error('bot === null (TELEGRAM_BOT_TOKEN не задан)');
    const me = await bot.getMe();
    ok(`Бот подключён: @${me.username} (id=${me.id})`);
  } catch (err) {
    fail('инициализация бота', err);
  }

  // ── Тест 2: formatBookingNotification ───────────────────────────────────
  console.log('\n── Тест 2: formatBookingNotification ──────────────────');
  try {
    const html = formatBookingNotification(TEST_BOOKING);
    if (!html.includes(TEST_BOOKING.guestName)) throw new Error('Нет имени гостя');
    if (!html.includes(TEST_BOOKING.apartment))  throw new Error('Нет квартиры');
    if (!html.includes('5'))                     throw new Error('Нет суммы');
    ok('HTML-уведомление сформировано', `${html.length} символов`);
  } catch (err) {
    fail('formatBookingNotification', err);
  }

  // ── Тест 3: notifyOwner — реальная отправка владельцу ───────────────────
  console.log('\n── Тест 3: notifyOwner (отправка владельцу) ───────────');
  try {
    const html = formatBookingNotification(TEST_BOOKING);
    await notifyOwner(`🧪 <b>Тест test_telegram.js</b>\n\n` + html);
    ok('Уведомление отправлено владельцу');
  } catch (err) {
    fail('notifyOwner', err);
  }

  // ── Тест 4: notifyOwnerWithActions — сообщение с двумя кнопками ─────────
  console.log('\n── Тест 4: notifyOwnerWithActions (inline-кнопки) ─────');
  try {
    const keyboard = [
      [
        { text: '✅ Подтверждена', callback_data: 'status_confirmed:test-page-id' },
        { text: '❌ Отменена', callback_data: 'status_cancelled:test-page-id' },
      ],
    ];
    await notifyOwnerWithActions('🧪 <b>Тест test_telegram.js</b> — inline-кнопки', keyboard);
    ok('Сообщение с двумя inline-кнопками отправлено владельцу');
  } catch (err) {
    fail('notifyOwnerWithActions', err);
  }

  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`Результат: ${passed} прошло, ${failed} упало`);

  if (failed > 0) {
    console.error('\n⚠  Исправь ошибки перед переходом к Шагу 5.\n');
    process.exit(1);
  } else {
    console.log('\n✅ Все тесты прошли. Можно переходить к Шагу 5.\n');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('[test_telegram] Неожиданная ошибка:', err.message);
  process.exit(1);
});
