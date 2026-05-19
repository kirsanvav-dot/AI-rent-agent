/**
 * Smoke-тест интеграции с Notion.
 * Запуск: node tests/test_notion.js
 *
 * Что проверяет:
 *  1. Подключение к Notion API
 *  2. Создание тестовой брони
 *  3. Дедупликацию (повторный вызов с тем же ID)
 *  4. Поиск брони по Telegram chat_id
 *  5. Обновление статуса брони
 */
require('dotenv').config();

const { createBooking, findBookingByChatId, updateBookingStatus } = require('../src/services/notion');

const TEST_BOOKING = {
  bookingId: `TEST-${Date.now()}`,
  guestName: 'Тестовый Гость',
  phone: '+79001234567',
  dateFrom: '2026-07-01',
  dateTo: '2026-07-03',
  apartment: 'Тестовая квартира',
  source: 'Другое',
  totalPrice: 5000,
  status: 'Подтверждена',
  telegramChatId: 999999999,
  notes: 'Создано автотестом test_notion.js',
};

async function run() {
  let passed = 0;
  let failed = 0;

  function ok(label) {
    console.log(`  ✓ ${label}`);
    passed++;
  }

  function fail(label, err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }

  console.log('\n── Тест 1: createBooking ──────────────────────────────');
  let createdBooking;
  try {
    createdBooking = await createBooking(TEST_BOOKING);
    if (!createdBooking.pageId) throw new Error('pageId отсутствует в ответе');
    ok(`Бронь создана: pageId=${createdBooking.pageId}`);
    ok(`bookingId совпадает: ${createdBooking.bookingId}`);
  } catch (err) {
    fail('createBooking', err);
  }

  console.log('\n── Тест 2: дедупликация (повторный createBooking) ─────');
  try {
    const duplicate = await createBooking(TEST_BOOKING);
    if (duplicate.pageId !== createdBooking?.pageId) {
      throw new Error(`pageId дубликата отличается: ${duplicate.pageId} ≠ ${createdBooking?.pageId}`);
    }
    ok('Дубликат не создан, вернулась существующая запись');
  } catch (err) {
    fail('дедупликация', err);
  }

  console.log('\n── Тест 3: findBookingByChatId ────────────────────────');
  try {
    const found = await findBookingByChatId(TEST_BOOKING.telegramChatId);
    if (!found) throw new Error('Бронь не найдена по chat_id');
    if (found.bookingId !== TEST_BOOKING.bookingId) {
      throw new Error(`bookingId не совпадает: ${found.bookingId} ≠ ${TEST_BOOKING.bookingId}`);
    }
    ok(`Бронь найдена по chatId=${TEST_BOOKING.telegramChatId}: гость=${found.guestName}`);
  } catch (err) {
    fail('findBookingByChatId', err);
  }

  console.log('\n── Тест 4: updateBookingStatus ────────────────────────');
  try {
    if (!createdBooking?.pageId) throw new Error('pageId недоступен — тест 1 упал');
    const updated = await updateBookingStatus(createdBooking.pageId, 'Завершена');
    if (updated.status !== 'Завершена') {
      throw new Error(`Статус не обновился: ${updated.status}`);
    }
    ok(`Статус обновлён → ${updated.status}`);
  } catch (err) {
    fail('updateBookingStatus', err);
  }

  console.log('\n── Тест 5: поиск несуществующего chat_id ──────────────');
  try {
    const notFound = await findBookingByChatId(0);
    if (notFound !== null) throw new Error('Ожидался null, получена запись');
    ok('Вернул null для несуществующего chatId=0');
  } catch (err) {
    fail('findBookingByChatId (несуществующий)', err);
  }

  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`Результат: ${passed} прошло, ${failed} упало`);

  if (failed > 0) {
    console.error('\n⚠  Исправь ошибки перед переходом к Шагу 3.\n');
    process.exit(1);
  } else {
    console.log('\n✅ Все тесты прошли. Можно переходить к Шагу 3.\n');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('[test_notion] Неожиданная ошибка:', err.message);
  process.exit(1);
});
