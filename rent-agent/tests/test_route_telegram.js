/**
 * Регрессионный тест: routes/telegram.js
 * Запуск: node tests/test_route_telegram.js
 *
 * Что проверяет (текущее поведение, которое НЕ должно измениться):
 *  1. Update без message.text → 200 OK + ничего не вызвано
 *  2. message.text + бронь найдена → context из Notion → LLM → sendMessage
 *  3. message.text + бронь НЕ найдена → notifyOwner('Неизвестный гость') + LLM с пустым context + sendMessage
 *  4. Сбой LLM → fallback-сообщение всё равно отправляется
 *  5. 200 OK сразу (fire-and-forget)
 *
 * Внешние сервисы заменены стабами через подмену методов на require-объекте.
 */

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

const notion   = require('../src/services/notion');
const llm      = require('../src/services/llm');
const telegram = require('../src/services/telegram');

const calls = { notion: [], llm: [], telegram: [] };

notion.findBookingByChatId = async (chatId) => {
  calls.notion.push(['findBookingByChatId', chatId]);
  return notion._mockBooking; // подкладываем нужное в каждом тесте
};

llm.generateReply = async (text, context) => {
  calls.llm.push(['generateReply', text, context]);
  if (llm._mockShouldThrow) throw new Error('LLM API down');
  return llm._mockReply || 'mock-LLM-reply';
};

telegram.sendMessage = async (chatId, text) => {
  calls.telegram.push(['sendMessage', { chatId, text }]);
};
telegram.notifyOwner = async (html) => {
  calls.telegram.push(['notifyOwner', html]);
};

const telegramWebhook = require('../src/routes/telegram');

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
function reset() {
  calls.notion.length = 0;
  calls.llm.length = 0;
  calls.telegram.length = 0;
  notion._mockBooking = null;
  llm._mockReply = 'mock-LLM-reply';
  llm._mockShouldThrow = false;
}

// ── Раннер ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function test(label, fn) {
  reset();
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
const MSG_UPDATE = (chatId, text, fromName = 'Иван') => ({
  update_id: 1,
  message: {
    message_id: 100,
    from: { id: chatId, first_name: fromName, language_code: 'ru' },
    chat: { id: chatId, type: 'private' },
    date: Math.floor(Date.now() / 1000),
    text,
  },
});

const FOUND_BOOKING = {
  pageId: 'page-found-001',
  bookingId: 'RC-12345',
  guestName: 'Иванов Иван',
  apartment: 'Квартира на Тверской',
  dates: { start: '2026-09-01', end: '2026-09-05' },
  totalPrice: 12000,
  source: 'Яндекс Аренда',
};

// ── Тесты ────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n══ Регрессия routes/telegram.js ══════════════════════════════');

  await test('Update без message.text → 200 OK + ничего не вызвано', async () => {
    const res = makeRes();
    await telegramWebhook(makeReq({ update_id: 1, edited_message: { text: 'edited' } }), res);
    await sleep(50);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(calls.notion.length, 0);
    assert.strictEqual(calls.llm.length, 0);
    assert.strictEqual(calls.telegram.length, 0);
  });

  await test('message без text → 200 OK + ничего не вызвано (sticker/voice/etc.)', async () => {
    const res = makeRes();
    await telegramWebhook(makeReq({ update_id: 1, message: { sticker: {} } }), res);
    await sleep(50);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(calls.notion.length + calls.llm.length + calls.telegram.length, 0);
  });

  await test('message.text → 200 OK сразу (до завершения pipeline)', async () => {
    const res = makeRes();
    await telegramWebhook(makeReq(MSG_UPDATE(555, 'Привет')), res);
    assert.strictEqual(res.statusCode, 200, '200 OK возвращён ДО pipeline');
    await sleep(50);
  });

  await test('Бронь найдена → context из Notion передан в LLM, ответ отправлен гостю', async () => {
    notion._mockBooking = FOUND_BOOKING;

    const res = makeRes();
    await telegramWebhook(makeReq(MSG_UPDATE(777, 'Когда заезд?')), res);
    await sleep(50);

    assert.strictEqual(calls.notion.length, 1);
    assert.deepStrictEqual(calls.notion[0], ['findBookingByChatId', 777]);

    assert.strictEqual(calls.llm.length, 1);
    const [, userText, context] = calls.llm[0];
    assert.strictEqual(userText, 'Когда заезд?');
    assert.strictEqual(context.guestName,  'Иванов Иван');
    assert.strictEqual(context.apartment,  'Квартира на Тверской');
    assert.strictEqual(context.dateFrom,   '2026-09-01');
    assert.strictEqual(context.dateTo,     '2026-09-05');
    assert.strictEqual(context.totalPrice, 12000);
    assert.strictEqual(context.source,     'Яндекс Аренда');

    const sends = calls.telegram.filter((c) => c[0] === 'sendMessage');
    assert.strictEqual(sends.length, 1, 'sendMessage гостю вызван 1 раз');
    assert.strictEqual(sends[0][1].chatId, 777);
    assert.strictEqual(sends[0][1].text, 'mock-LLM-reply');

    const notifies = calls.telegram.filter((c) => c[0] === 'notifyOwner');
    assert.strictEqual(notifies.length, 0, 'notifyOwner НЕ должен вызываться при найденной брони');
  });

  await test('Бронь НЕ найдена → notifyOwner("Неизвестный гость") + LLM с пустым context + ответ', async () => {
    notion._mockBooking = null;

    const res = makeRes();
    await telegramWebhook(makeReq(MSG_UPDATE(888, 'А сколько стоит?', 'Незнакомый')), res);
    await sleep(50);

    const notifies = calls.telegram.filter((c) => c[0] === 'notifyOwner');
    assert.strictEqual(notifies.length, 1, 'notifyOwner вызван для незнакомого гостя');
    assert.ok(notifies[0][1].includes('Неизвестный гость'), 'текст уведомления содержит маркер');
    assert.ok(notifies[0][1].includes('888'),  'chatId есть в уведомлении');

    assert.strictEqual(calls.llm.length, 1);
    const [, , context] = calls.llm[0];
    assert.deepStrictEqual(context, {}, 'context должен быть пустым при ненайденной брони');

    const sends = calls.telegram.filter((c) => c[0] === 'sendMessage');
    assert.strictEqual(sends.length, 1, 'ответ гостю всё равно отправляется');
  });

  await test('Сбой LLM → fallback-сообщение отправляется гостю (текущая защита)', async () => {
    notion._mockBooking = FOUND_BOOKING;
    llm._mockShouldThrow = true;

    const res = makeRes();
    await telegramWebhook(makeReq(MSG_UPDATE(999, 'тест')), res);
    await sleep(50);

    const sends = calls.telegram.filter((c) => c[0] === 'sendMessage');
    assert.strictEqual(sends.length, 1, 'sendMessage всё равно вызван');
    assert.ok(
      sends[0][1].text.includes('Анна сейчас недоступна'),
      `ожидался fallback-текст, получено: "${sends[0][1].text}"`,
    );
  });

  await test('Текст обрезается через trim() — пробелы по краям не ломают pipeline', async () => {
    notion._mockBooking = FOUND_BOOKING;

    const res = makeRes();
    await telegramWebhook(makeReq(MSG_UPDATE(111, '   Привет   ')), res);
    await sleep(50);

    assert.strictEqual(calls.llm[0][1], 'Привет', 'текст должен быть обрезан');
  });

  console.log(`\n  Итог: ${passed} прошло, ${failed} упало`);
  return { passed, failed };
}

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}

module.exports = { run };
