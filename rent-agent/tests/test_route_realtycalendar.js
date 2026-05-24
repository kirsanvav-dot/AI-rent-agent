/**
 * Регрессионный тест: routes/realtycalendar.js
 * Запуск: node tests/test_route_realtycalendar.js
 *
 * Что проверяет (текущее поведение, которое НЕ должно измениться после CHANGE_REQUEST):
 *  1. action !== 'create_booking'  → 200 OK, ни один сервис не вызывается
 *  2. create_booking + avito_item_id → notion.createBooking + avito.getToken/blockDates + telegram.notifyOwner
 *  3. create_booking БЕЗ avito_item_id → Авито пропущен, остальные шаги выполнены
 *  4. Маппинг полей из RC payload в BookingData корректен
 *  5. 200 OK возвращается СРАЗУ (fire-and-forget)
 *
 * Все внешние сервисы заменены стабами через подмену методов на require-объекте.
 */

// ── Изоляция от .env: ставим тестовые значения ДО любых require ──────────────
process.env.NOTION_TOKEN          = 'test-notion-token';
process.env.NOTION_DATABASE_ID    = 'test-database-id';
process.env.OPENROUTER_API_KEY    = 'test-openrouter-key';
process.env.OPENROUTER_SITE_URL   = 'http://test.local';
process.env.OPENROUTER_APP_NAME   = 'TestSuite';
process.env.TELEGRAM_BOT_TOKEN    = '123456:TEST_TOKEN_NOT_REAL';
process.env.TELEGRAM_OWNER_CHAT_ID = '999000111';
process.env.AVITO_USER_ID         = 'mock-avito-user-id';
process.env.AVITO_CLIENT_ID       = 'mock-client-id';
process.env.AVITO_CLIENT_SECRET   = 'mock-client-secret';
process.env.DEMO_MODE             = 'false';

const assert = require('assert');

// ── Загружаем сервисы и подменяем их методы ─────────────────────────────────
const notion   = require('../src/services/notion');
const avito    = require('../src/services/avito');
const telegram = require('../src/services/telegram');

const calls = { notion: [], avito: [], telegram: [] };

notion.createBooking = async (data) => {
  calls.notion.push(['createBooking', data]);
  return { pageId: 'mock-page-id-001', bookingId: data.bookingId };
};

avito.getToken = async () => {
  calls.avito.push(['getToken']);
  return 'mock-access-token';
};
avito.blockDates = async (token, userId, itemId, dateFrom, dateTo) => {
  calls.avito.push(['blockDates', { token, userId, itemId, dateFrom, dateTo }]);
};

telegram.notifyOwner = async (html) => {
  calls.telegram.push(['notifyOwner', html]);
};
telegram.notifyOwnerWithActions = async (html, keyboard) => {
  calls.telegram.push(['notifyOwnerWithActions', html, keyboard]);
};

// Загружаем роут ПОСЛЕ подмены — он подхватит наши стабы
const realtycalendarWebhook = require('../src/routes/realtycalendar');

// ── Утилиты ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function makeReq(body) { return { body }; }
function makeRes() {
  let statusCode = null;
  return {
    sendStatus: (code) => { statusCode = code; },
    get statusCode() { return statusCode; },
  };
}

function resetCalls() {
  calls.notion.length = 0;
  calls.avito.length = 0;
  calls.telegram.length = 0;
}

// ── Тестовый раннер ──────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function test(label, fn) {
  resetCalls();
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ── Фикстуры ─────────────────────────────────────────────────────────────────
const VALID_RC_PAYLOAD = {
  action:      'create_booking',
  booking_id:  'RC-REGRESSION-001',
  date_from:   '2026-09-01',
  date_to:     '2026-09-05',
  total_price: 12000,
  guest:       { name: 'Регрессионный Гость', phone: '+79001234567' },
  property:    { title: 'Квартира на Тестовой 1', avito_item_id: 'avito-item-9999' },
  booking_origin: { title: 'Яндекс Аренда' },
};

// ── Тесты ────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n══ Регрессия routes/realtycalendar.js ════════════════════════');

  await test('action !== "create_booking" → 200 OK + ни один сервис не вызван', async () => {
    const res = makeRes();
    await realtycalendarWebhook(makeReq({ action: 'unknown_event' }), res);
    await sleep(50);

    assert.strictEqual(res.statusCode, 200, 'res.sendStatus(200) должен быть вызван');
    assert.strictEqual(calls.notion.length, 0, 'notion.* не должен вызываться');
    assert.strictEqual(calls.avito.length, 0, 'avito.* не должен вызываться');
    assert.strictEqual(calls.telegram.length, 0, 'telegram.* не должен вызываться');
  });

  await test('create_booking → 200 OK сразу (до завершения pipeline)', async () => {
    const res = makeRes();
    await realtycalendarWebhook(makeReq(VALID_RC_PAYLOAD), res);
    assert.strictEqual(res.statusCode, 200, '200 OK возвращён ДО pipeline');
    await sleep(50);
  });

  await test('create_booking + avito_item_id → Notion + Avito + Telegram (3 шага)', async () => {
    const res = makeRes();
    await realtycalendarWebhook(makeReq(VALID_RC_PAYLOAD), res);
    await sleep(50);

    assert.strictEqual(calls.notion.length, 1, 'notion.createBooking вызван 1 раз');
    assert.strictEqual(calls.notion[0][0], 'createBooking');

    assert.strictEqual(calls.avito.length, 2, 'avito: getToken + blockDates');
    assert.strictEqual(calls.avito[0][0], 'getToken');
    assert.strictEqual(calls.avito[1][0], 'blockDates');

    assert.strictEqual(calls.telegram.length, 1, 'telegram.notifyOwnerWithActions вызван 1 раз');
    assert.strictEqual(calls.telegram[0][0], 'notifyOwnerWithActions');
    const keyboard = calls.telegram[0][2];
    assert.ok(Array.isArray(keyboard), 'keyboard — массив рядов кнопок');
    assert.strictEqual(keyboard.flat().length, 3, '3 кнопки статуса');
    assert.ok(
      keyboard.flat().every((btn) => btn.callback_data.startsWith('status_')),
      'callback_data начинается с status_',
    );
    assert.ok(
      keyboard.flat().every((btn) => btn.callback_data.endsWith(':mock-page-id-001')),
      'callback_data содержит pageId',
    );
  });

  await test('create_booking БЕЗ avito_item_id → Авито пропускается, Notion и Telegram вызываются', async () => {
    const payload = { ...VALID_RC_PAYLOAD, property: { title: 'Квартира', avito_item_id: null } };
    const res = makeRes();
    await realtycalendarWebhook(makeReq(payload), res);
    await sleep(50);

    assert.strictEqual(calls.notion.length, 1, 'Notion должен быть вызван');
    assert.strictEqual(calls.avito.length, 0, 'Авито должен быть пропущен (нет avito_item_id)');
    assert.strictEqual(calls.telegram.length, 1, 'Telegram должен быть вызван');
    assert.strictEqual(calls.telegram[0][0], 'notifyOwnerWithActions');
  });

  await test('Маппинг payload → BookingData (notion.createBooking)', async () => {
    const res = makeRes();
    await realtycalendarWebhook(makeReq(VALID_RC_PAYLOAD), res);
    await sleep(50);

    const data = calls.notion[0][1];
    assert.strictEqual(data.bookingId,  'RC-REGRESSION-001');
    assert.strictEqual(data.guestName,  'Регрессионный Гость');
    assert.strictEqual(data.phone,      '+79001234567');
    assert.strictEqual(data.dateFrom,   '2026-09-01');
    assert.strictEqual(data.dateTo,     '2026-09-05');
    assert.strictEqual(data.apartment,  'Квартира на Тестовой 1');
    assert.strictEqual(data.source,     'Яндекс Аренда');
    assert.strictEqual(data.totalPrice, 12000);
    assert.strictEqual(data.status,     'Подтверждена', 'статус всегда Подтверждена при создании');
    assert.strictEqual(data.avitoItemId, 'avito-item-9999');
  });

  await test('blockDates получает корректные параметры', async () => {
    const res = makeRes();
    await realtycalendarWebhook(makeReq(VALID_RC_PAYLOAD), res);
    await sleep(50);

    const args = calls.avito[1][1];
    assert.strictEqual(args.token,    'mock-access-token');
    assert.strictEqual(args.userId,   'mock-avito-user-id');
    assert.strictEqual(args.itemId,   'avito-item-9999');
    assert.strictEqual(args.dateFrom, '2026-09-01');
    assert.strictEqual(args.dateTo,   '2026-09-05');
  });

  await test('Сбой Notion не прерывает pipeline (Avito и Telegram всё равно вызываются)', async () => {
    const original = notion.createBooking;
    notion.createBooking = async () => { throw new Error('Notion API down'); };

    try {
      const res = makeRes();
      await realtycalendarWebhook(makeReq(VALID_RC_PAYLOAD), res);
      await sleep(50);

      assert.strictEqual(res.statusCode, 200, '200 OK всё равно вернулся');
      assert.strictEqual(calls.avito.length,    2, 'Avito выполнился несмотря на ошибку Notion');
      assert.strictEqual(calls.telegram.length, 1, 'Telegram выполнился несмотря на ошибку Notion');
      assert.strictEqual(calls.telegram[0][0], 'notifyOwner', 'fallback без pageId → notifyOwner');
    } finally {
      notion.createBooking = original;
    }
  });

  console.log(`\n  Итог: ${passed} прошло, ${failed} упало`);
  return { passed, failed };
}

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}

module.exports = { run };
