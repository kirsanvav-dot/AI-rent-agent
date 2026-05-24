/**
 * Регрессионный тест: services/telegram.js — чистые функции
 * Запуск: node tests/test_service_telegram.js
 *
 * Что проверяет (текущее поведение, которое НЕ должно измениться):
 *  - formatBookingNotification: формат HTML, наличие всех ключевых полей
 *  - корректная подстановка прочерка для пустых значений
 *  - формат диапазона дат через formatDateRange
 *
 * Чистая функция — моки не требуются. Не делает сетевых вызовов.
 */

process.env.TELEGRAM_BOT_TOKEN     = '123456:TEST_TOKEN_NOT_REAL';
process.env.TELEGRAM_OWNER_CHAT_ID = '999000111';

const assert = require('assert');
const { formatBookingNotification } = require('../src/services/telegram');

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

const FULL_BOOKING = {
  bookingId:  'RC-12345',
  guestName:  'Иванов Иван',
  phone:      '+79001234567',
  apartment:  'Квартира на Тверской',
  dateFrom:   '2026-06-20',
  dateTo:     '2026-06-22',
  totalPrice: 7500,
  source:     'Яндекс Аренда',
};

async function run() {
  console.log('\n══ Регрессия services/telegram.js (formatBookingNotification) ══');

  test('Все поля заполнены → HTML содержит имя, телефон, квартиру, источник, ID', () => {
    const html = formatBookingNotification(FULL_BOOKING);
    assert.ok(html.includes('Иванов Иван'),         'имя гостя');
    assert.ok(html.includes('+79001234567'),        'телефон');
    assert.ok(html.includes('Квартира на Тверской'), 'название квартиры');
    assert.ok(html.includes('Яндекс Аренда'),       'источник');
    assert.ok(html.includes('RC-12345'),            'ID брони');
  });

  test('Заголовок «Новая бронь!» присутствует', () => {
    const html = formatBookingNotification(FULL_BOOKING);
    assert.ok(html.includes('<b>Новая бронь!</b>'), 'жирный заголовок в HTML');
  });

  test('Сумма форматируется через toLocaleString("ru-RU") + ₽', () => {
    const html = formatBookingNotification(FULL_BOOKING);
    assert.ok(/7[\s\u00A0\u202F]?500\s?₽/.test(html), `ожидался "7 500 ₽" (с любым пробелом), получено: ${html}`);
  });

  test('Диапазон дат форматируется через formatDateRange (зависит от ICU-локали)', () => {
    const html = formatBookingNotification(FULL_BOOKING);
    // Зависит от платформы: macOS даёт "20–22 июнь 2026 г.", linux — "20–22 июня 2026"
    assert.ok(/20[–-]22\s+(июнь|июня)\s+2026/.test(html), `ожидались дни 20–22 и месяц июнь/июня 2026, получено: ${html}`);
  });

  test('Пустые поля → прочерк "—"', () => {
    const empty = {};
    const html = formatBookingNotification(empty);
    const dashCount = (html.match(/—/g) || []).length;
    assert.ok(dashCount >= 5, `ожидалось ≥5 прочерков для пустого объекта, получено: ${dashCount}`);
  });

  test('Поддержка booking.dates.{start,end} (как из Notion parseNotionPage)', () => {
    const fromNotion = {
      bookingId: 'N-1',
      guestName: 'Из Notion',
      apartment: 'Квартира',
      dates: { start: '2026-06-20', end: '2026-06-22' },
      totalPrice: 1000,
      source: 'Авито',
      phone: '+7900',
    };
    const html = formatBookingNotification(fromNotion);
    assert.ok(/20[–-]22\s+(июнь|июня)/.test(html), 'формат dates.start/dates.end должен распознаваться');
  });

  test('HTML-разметка не падает на null/undefined полях', () => {
    const partial = {
      bookingId: 'X',
      guestName: 'Имя',
      phone: null,
      apartment: undefined,
      dateFrom: '2026-06-20',
      dateTo: '2026-06-22',
      totalPrice: null,
      source: null,
    };
    const html = formatBookingNotification(partial);
    assert.ok(html.length > 0, 'функция не должна падать');
    assert.ok(html.includes('Имя'), 'имя гостя осталось');
  });

  console.log(`\n  Итог: ${passed} прошло, ${failed} упало`);
  return { passed, failed };
}

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}

module.exports = { run };
