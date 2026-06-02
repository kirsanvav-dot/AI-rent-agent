/**
 * Регрессионный тест: routes/avito.js
 * Запуск: node tests/test_route_avito.js
 *
 * Что проверяет (текущее поведение, которое НЕ должно измениться):
 *  1. payload.type !== 'message' → 200 OK + ничего не вызвано
 *  2. author_id === AVITO_USER_ID → 200 OK + ничего не вызвано (свои сообщения)
 *  3. payload без content.text → 200 OK + ничего не вызвано
 *  4. Нормальное сообщение → getToken → generateReply(text, {}) → sendMessage
 *  5. Сбой токена → pipeline останавливается, LLM не вызывается
 *  6. Сбой LLM → fallback-текст отправляется в чат
 *  7. 200 OK сразу (fire-and-forget)
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
process.env.AVITO_USER_ID         = 'avito-owner-42';
process.env.AVITO_CLIENT_ID       = 'mock-client-id';
process.env.AVITO_CLIENT_SECRET   = 'mock-client-secret';
process.env.DEMO_MODE             = 'false';

const assert = require('assert');

const avito = require('../src/services/avito');
const llm   = require('../src/services/llm');
const notion = require('../src/services/notion');
const telegram = require('../src/services/telegram');

const calls = { avito: [], llm: [], notion: [], telegram: [] };

notion.findBookingByAvitoChatId = async (chatId) => {
  calls.notion.push(['findBookingByAvitoChatId', chatId]);
  return notion._mockBooking || null;
};
notion.createBooking = async (data) => {
  calls.notion.push(['createBooking', data]);
  return notion._mockCreatedBooking || {
    pageId: 'mock-page-id',
    bookingId: data.bookingId,
    guestName: data.guestName || '',
    apartment: data.apartment || '',
    source: data.source || 'Авито',
    status: data.status || 'Ожидает подтверждения',
    totalPrice: null,
    dates: { start: null, end: null },
  };
};
notion.updateBookingFields = async (pageId, fields) => {
  calls.notion.push(['updateBookingFields', pageId, fields]);
  return notion._mockBooking || { pageId, ...fields };
};

avito.getToken = async () => {
  calls.avito.push(['getToken']);
  if (avito._mockTokenShouldThrow) throw new Error('Avito OAuth down');
  return 'mock-access-token';
};
avito.sendMessage = async (token, userId, chatId, text) => {
  calls.avito.push(['sendMessage', { token, userId, chatId, text }]);
};

llm.generateReply = async (text, context) => {
  calls.llm.push(['generateReply', text, context]);
  if (llm._mockShouldThrow) throw new Error('LLM API down');
  return llm._mockReply || 'mock-LLM-reply';
};

telegram.notifyOwnerWithActions = async (html, keyboard) => {
  calls.telegram.push(['notifyOwnerWithActions', html, keyboard]);
};

const avitoWebhook = require('../src/routes/avito');

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
  calls.avito.length = 0;
  calls.llm.length = 0;
  calls.notion.length = 0;
  calls.telegram.length = 0;
  avito._mockTokenShouldThrow = false;
  llm._mockReply = 'mock-LLM-reply';
  llm._mockShouldThrow = false;
  notion._mockBooking = null;
  notion._mockCreatedBooking = null;
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
const guestMsg = (text, chatId = 'avito-chat-001') => ({
  payload: {
    type: 'message',
    author_id: 'guest-12345',
    chat_id: chatId,
    content: { text },
  },
});

// ── Тесты ────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n══ Регрессия routes/avito.js ═════════════════════════════════');

  await test('Нет payload → 200 OK + ничего не вызвано', async () => {
    const res = makeRes();
    await avitoWebhook(makeReq({}), res);
    await sleep(50);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(calls.avito.length, 0);
    assert.strictEqual(calls.llm.length, 0);
  });

  await test('payload.type !== "message" → 200 OK + ничего не вызвано', async () => {
    const res = makeRes();
    await avitoWebhook(makeReq({ payload: { type: 'view', chat_id: 'x' } }), res);
    await sleep(50);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(calls.avito.length + calls.llm.length, 0);
  });

  await test('author_id === AVITO_USER_ID → 200 OK + ничего не вызвано (свои сообщения)', async () => {
    const selfMsg = {
      payload: {
        type: 'message',
        author_id: 'avito-owner-42',
        chat_id: 'avito-chat-self',
        content: { text: 'Это я' },
      },
    };
    const res = makeRes();
    await avitoWebhook(makeReq(selfMsg), res);
    await sleep(50);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(calls.avito.length + calls.llm.length, 0);
  });

  await test('author_id сравнивается как строка (число → строка)', async () => {
    process.env.AVITO_USER_ID = 'avito-owner-42';
    const numericAuthor = {
      payload: {
        type: 'message',
        author_id: 'avito-owner-42',
        chat_id: 'c1',
        content: { text: 'Привет' },
      },
    };
    const res = makeRes();
    await avitoWebhook(makeReq(numericAuthor), res);
    await sleep(50);
    assert.strictEqual(calls.avito.length, 0, 'строка с тем же значением должна быть отфильтрована');
  });

  await test('Пустой текст → 200 OK + pipeline не запущен', async () => {
    const res = makeRes();
    await avitoWebhook(makeReq(guestMsg('')), res);
    await sleep(50);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(calls.avito.length + calls.llm.length, 0);
  });

  await test('Нормальное сообщение → 200 OK сразу (fire-and-forget)', async () => {
    const res = makeRes();
    await avitoWebhook(makeReq(guestMsg('Свободно ли на 10–12 июня?')), res);
    assert.strictEqual(res.statusCode, 200);
    await sleep(50);
  });

  await test('Полный pipeline: getToken → Notion → generateReply → sendMessage', async () => {
    const res = makeRes();
    await avitoWebhook(makeReq(guestMsg('Здравствуйте, есть свободные даты?', 'chat-XYZ')), res);
    await sleep(50);

    assert.strictEqual(calls.avito.length, 2, 'getToken + sendMessage');
    assert.strictEqual(calls.avito[0][0], 'getToken');

    assert.strictEqual(calls.notion.length, 2, 'findBookingByAvitoChatId + createBooking');
    assert.strictEqual(calls.notion[0][0], 'findBookingByAvitoChatId');
    assert.strictEqual(calls.notion[1][0], 'createBooking');

    assert.strictEqual(calls.llm.length, 1);
    const [, userText, context] = calls.llm[0];
    assert.strictEqual(userText, 'Здравствуйте, есть свободные даты?');
    assert.strictEqual(context.source, 'Авито');
    assert.strictEqual(context.status, 'Ожидает подтверждения');

    const sendCall = calls.avito[1];
    assert.strictEqual(sendCall[0], 'sendMessage');
    assert.strictEqual(sendCall[1].token,  'mock-access-token');
    assert.strictEqual(sendCall[1].userId, 'avito-owner-42');
    assert.strictEqual(sendCall[1].chatId, 'chat-XYZ');
    assert.strictEqual(sendCall[1].text,   'mock-LLM-reply');

    const notify = calls.telegram.filter((c) => c[0] === 'notifyOwnerWithActions');
    assert.strictEqual(notify.length, 1, 'notifyOwnerWithActions для нового лида');
    const keyboard = notify[0][2];
    assert.strictEqual(keyboard.flat().length, 2);
    assert.ok(keyboard[0][0].callback_data.startsWith('confirm_booking:'));
    assert.ok(keyboard[0][1].callback_data.startsWith('status_cancelled:'));
  });

  await test('API v3 payload (payload.value) → тот же pipeline', async () => {
    const res = makeRes();
    await avitoWebhook(makeReq({
      id: 'wh-1',
      version: '2.0',
      timestamp: 1730000000,
      payload: {
        type: 'message',
        value: {
          id: 'msg-1',
          chat_id: 'avito-v3-chat-99',
          author_id: 'guest-12345',
          item_id: 'item-777',
          type: 'text',
          content: { text: 'Здравствуйте, есть место?' },
        },
      },
    }), res);
    await sleep(50);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(calls.avito.length, 2, 'getToken + sendMessage');
    assert.strictEqual(calls.llm[0][1], 'Здравствуйте, есть место?');
    assert.strictEqual(calls.avito[1][1].chatId, 'avito-v3-chat-99');
  });

  await test('Повторное сообщение в известном чате → notifyOwnerWithActions НЕ вызывается', async () => {
    notion._mockBooking = {
      pageId: 'existing-page',
      bookingId: 'AVITO-existing',
      source: 'Авито',
      status: 'Ожидает подтверждения',
      dates: { start: null, end: null },
    };

    const res = makeRes();
    await avitoWebhook(makeReq(guestMsg('Повторный вопрос', 'existing-chat')), res);
    await sleep(50);

    assert.strictEqual(calls.notion.length, 1, 'только findBookingByAvitoChatId');
    assert.strictEqual(calls.notion[0][0], 'findBookingByAvitoChatId');
    assert.strictEqual(calls.telegram.length, 0, 'уведомление только для нового лида');
  });

  await test('Сбой токена → LLM и sendMessage НЕ вызываются (early return)', async () => {
    avito._mockTokenShouldThrow = true;

    const res = makeRes();
    await avitoWebhook(makeReq(guestMsg('тест')), res);
    await sleep(50);

    assert.strictEqual(calls.avito.length, 1, 'только getToken (упал)');
    assert.strictEqual(calls.llm.length, 0, 'LLM не должен вызываться без токена');
  });

  await test('Сбой LLM → fallback-текст отправляется в чат Авито', async () => {
    llm._mockShouldThrow = true;

    const res = makeRes();
    await avitoWebhook(makeReq(guestMsg('тест-fallback')), res);
    await sleep(50);

    const send = calls.avito.find((c) => c[0] === 'sendMessage');
    assert.ok(send, 'sendMessage должен быть вызван');
    assert.ok(
      send[1].text.includes('Уточню детали и отвечу'),
      `ожидался fallback от роута Авито, получено: "${send[1].text}"`,
    );
  });

  console.log(`\n  Итог: ${passed} прошло, ${failed} упало`);
  return { passed, failed };
}

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}

module.exports = { run };
