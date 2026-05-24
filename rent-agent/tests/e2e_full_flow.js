/**
 * Сквозной E2E-тест TO-BE цикла (Шаг 12 TRACKER).
 *
 * Запуск: node tests/e2e_full_flow.js
 *
 * In-process Express + axios; внешние API (Notion, LLM, Telegram, Avito, RC) — стабы.
 * Отдельный процесс, prod-код не меняется.
 */
process.env.NOTION_TOKEN           = 'test-notion-token';
process.env.NOTION_DATABASE_ID     = 'test-database-id';
process.env.OPENROUTER_API_KEY     = 'test-openrouter-key';
process.env.OPENROUTER_SITE_URL    = 'http://test.local';
process.env.OPENROUTER_APP_NAME    = 'TestSuite';
process.env.TELEGRAM_BOT_TOKEN     = '123456:TEST_TOKEN_NOT_FULL';
process.env.TELEGRAM_OWNER_CHAT_ID = '999000111';
process.env.AVITO_USER_ID          = 'mock-avito-user-id';
process.env.AVITO_CLIENT_ID        = 'mock-client-id';
process.env.AVITO_CLIENT_SECRET    = 'mock-client-secret';
process.env.REALTYCALENDAR_OBJECT_ID = 'RC-OBJ-FLOW-001';
process.env.DEMO_MODE              = 'false';
process.env.NODE_ENV               = 'test';

const http = require('http');
const assert = require('assert');
const express = require('express');
const axios = require('axios');

const notion = require('../src/services/notion');
const llm = require('../src/services/llm');
const telegram = require('../src/services/telegram');
const avito = require('../src/services/avito');
const realtycalendar = require('../src/services/realtycalendar');

// ── In-memory CRM (замена Notion API) ───────────────────────────────────────
const store = {
  byPageId: new Map(),
  byBookingId: new Map(),
  byAvitoChatId: new Map(),
  byTelegramChatId: new Map(),
};

let pageSeq = 1;
function makePageId() {
  return `flow-page-${pageSeq++}`;
}

function indexBooking(booking) {
  store.byPageId.set(booking.pageId, booking);
  store.byBookingId.set(booking.bookingId, booking);
  if (booking.avitoChatId) store.byAvitoChatId.set(String(booking.avitoChatId), booking);
  if (booking.telegramChatId != null) {
    store.byTelegramChatId.set(Number(booking.telegramChatId), booking);
  }
}

function cloneBooking(b) {
  return {
    ...b,
    dates: { start: b.dates.start, end: b.dates.end },
  };
}

notion.createBooking = async (data) => {
  const existing = store.byBookingId.get(String(data.bookingId));
  if (existing) return cloneBooking(existing);

  const booking = {
    pageId: makePageId(),
    bookingId: String(data.bookingId),
    guestName: data.guestName || '',
    phone: data.phone || '',
    apartment: data.apartment || '',
    source: data.source || '',
    status: data.status || '',
    totalPrice: data.totalPrice || 0,
    dates: {
      start: data.dateFrom || null,
      end: data.dateTo || null,
    },
    telegramChatId: data.telegramChatId ?? null,
    avitoChatId: data.avitoChatId ? String(data.avitoChatId) : '',
    avitoItemId: data.avitoItemId ? String(data.avitoItemId) : '',
    rcSynced: false,
  };
  indexBooking(booking);
  return cloneBooking(booking);
};

notion.findBookingByBookingId = async (bookingId) => {
  const b = store.byBookingId.get(String(bookingId).trim());
  return b ? cloneBooking(b) : null;
};

notion.findBookingByAvitoChatId = async (chatId) => {
  const b = store.byAvitoChatId.get(String(chatId));
  return b ? cloneBooking(b) : null;
};

notion.findBookingByChatId = async (chatId) => {
  const b = store.byTelegramChatId.get(Number(chatId));
  return b ? cloneBooking(b) : null;
};

notion.findBookingByPageId = async (pageId) => {
  const b = store.byPageId.get(pageId);
  return b ? cloneBooking(b) : null;
};

notion.findBookingByPhone = async () => null;

notion.updateBookingFields = async (pageId, fields) => {
  const b = store.byPageId.get(pageId);
  if (!b) throw new Error(`updateBookingFields: page not found ${pageId}`);

  if (fields.guestName !== undefined) b.guestName = fields.guestName;
  if (fields.phone !== undefined) b.phone = fields.phone;
  if (fields.telegramChatId !== undefined) {
    if (b.telegramChatId != null) store.byTelegramChatId.delete(Number(b.telegramChatId));
    b.telegramChatId = fields.telegramChatId;
    store.byTelegramChatId.set(Number(fields.telegramChatId), b);
  }
  if (fields.dateFrom !== undefined) b.dates.start = fields.dateFrom;
  if (fields.dateTo !== undefined) b.dates.end = fields.dateTo;
  if (fields.status !== undefined) b.status = fields.status;
  if (fields.rcSynced !== undefined) b.rcSynced = fields.rcSynced;

  return cloneBooking(b);
};

notion.updateBookingStatus = async (pageId, status) => {
  const b = store.byPageId.get(pageId);
  if (!b) throw new Error(`updateBookingStatus: page not found ${pageId}`);
  b.status = status;
  return cloneBooking(b);
};

// ── Стабы внешних сервисов ───────────────────────────────────────────────────
const llmCalls = [];
const telegramCalls = { notifyOwnerWithActions: [], answerCallbackQuery: [], sendMessage: [], notifyOwner: [] };
let blockDatesCallCount = 0;
const blockDatesCalls = [];

llm.generateReply = async (text, context) => {
  llmCalls.push({ text, context: { ...context } });
  return context.guestName
    ? `Здравствуйте, ${context.guestName}! Рада помочь.`
    : 'mock-LLM-reply';
};

telegram.sendMessage = async (chatId, text) => {
  telegramCalls.sendMessage.push({ chatId, text });
};

telegram.notifyOwner = async (html) => {
  telegramCalls.notifyOwner.push(html);
};

telegram.notifyOwnerWithActions = async (html, keyboard) => {
  telegramCalls.notifyOwnerWithActions.push({ html, keyboard });
};

telegram.answerCallbackQuery = async (id, text) => {
  telegramCalls.answerCallbackQuery.push({ id, text });
};

avito.getToken = async () => 'mock-avito-token';
avito.sendMessage = async () => {};

realtycalendar.blockDates = async (params) => {
  blockDatesCallCount += 1;
  blockDatesCalls.push({ ...params });
  return { rcBookingId: `MOCK-RC-${blockDatesCallCount}` };
};

// ── Express app (как index.js, без listen) ───────────────────────────────────
const telegramWebhook = require('../src/routes/telegram');
const realtycalendarWebhook = require('../src/routes/realtycalendar');
const avitoWebhook = require('../src/routes/avito');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.post('/webhook/telegram', telegramWebhook);
  app.post('/webhook/realtycalendar', realtycalendarWebhook);
  app.post('/webhook/avito', avitoWebhook);
  return app;
}

const GREEN  = (s) => `\x1b[32m${s}\x1b[0m`;
const RED    = (s) => `\x1b[31m${s}\x1b[0m`;
const BOLD   = (s) => `\x1b[1m${s}\x1b[0m`;

const DELAY_MS = 150;
const OWNER_ID = Number(process.env.TELEGRAM_OWNER_CHAT_ID);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startServer() {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const api = axios.create({ baseURL: `http://127.0.0.1:${port}`, timeout: 5_000 });
  return { server, api };
}

async function postWebhook(api, path, body) {
  const t0 = Date.now();
  const { status } = await api.post(path, body);
  const elapsed = Date.now() - t0;
  if (status !== 200) throw new Error(`Ожидался 200, получен ${status}`);
  if (elapsed > 100) throw new Error(`NFR-2: ответ ${elapsed}ms > 100ms`);
  return elapsed;
}

function callbackPayload(data) {
  return {
    update_id: Date.now(),
    callback_query: {
      id: `cb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      from: { id: OWNER_ID, first_name: 'Owner', language_code: 'ru' },
      message: { message_id: 1, chat: { id: OWNER_ID, type: 'private' } },
      chat_instance: 'full-flow',
      data,
    },
  };
}

// ── Основной прогон ──────────────────────────────────────────────────────────
async function run() {
  let passed = 0;
  let failed = 0;

  async function test(label, fn) {
    try {
      await fn();
      console.log(GREEN(`  ✓ ${label}`));
      passed += 1;
    } catch (err) {
      console.log(RED(`  ✗ ${label}`));
      console.log(RED(`    ${err.message}`));
      failed += 1;
    }
  }

  const { server, api } = await startServer();

  const RUN_ID = Date.now();
  const RC_BOOKING_ID = `FULL-RC-${RUN_ID}`;
  const TG_MATCH_CHAT = 700000000 + (RUN_ID % 100000000);
  const AVITO_CHAT = `avito-full-flow-${RUN_ID}`;

  let rcPageId = null;
  let avitoPageId = null;

  try {
    console.log(BOLD('\n══ E2E full flow (TO-BE) ══════════════════════════════════\n'));

    await api.get('/health');

    // ── Шаг 1: RC → Notion + уведомление с status_* ────────────────────────
    console.log(BOLD('── Шаг 1: RC create_booking ────────────────────────────'));

    await test('RC webhook → 200 OK ≤100ms, запись в Notion', async () => {
      telegramCalls.notifyOwnerWithActions.length = 0;

      await postWebhook(api, '/webhook/realtycalendar', {
        action: 'create_booking',
        booking_id: RC_BOOKING_ID,
        date_from: '2026-08-10',
        date_to: '2026-08-12',
        total_price: 9000,
        guest: { name: 'Full Flow RC Guest', phone: '+79001110001' },
        property: { title: 'Квартира full-flow', avito_item_id: null },
        booking_origin: { title: 'Яндекс Аренда' },
      });
      await sleep(DELAY_MS);

      const booking = await notion.findBookingByBookingId(RC_BOOKING_ID);
      assert.ok(booking, 'RC-бронь не создана');
      assert.strictEqual(booking.status, 'Подтверждена');
      assert.strictEqual(booking.rcSynced, false);
      assert.strictEqual(booking.source, 'Яндекс Аренда');
      rcPageId = booking.pageId;

      assert.ok(telegramCalls.notifyOwnerWithActions.length >= 1, 'notifyOwnerWithActions не вызван');
      const keyboard = telegramCalls.notifyOwnerWithActions.at(-1).keyboard.flat();
      assert.ok(keyboard.every((btn) => btn.callback_data.startsWith('status_')), 'ожидались кнопки status_*');
      assert.ok(keyboard.some((btn) => btn.callback_data.includes(rcPageId)), 'pageId в callback_data');
    });

    // ── Шаг 2: Telegram match по ID брони ──────────────────────────────────
    console.log(BOLD('\n── Шаг 2: Telegram match по ID брони ───────────────────'));

    await test('TG bookingId → telegramChatId записан, LLM с контекстом', async () => {
      llmCalls.length = 0;
      telegramCalls.sendMessage.length = 0;

      await postWebhook(api, '/webhook/telegram', {
        update_id: RUN_ID + 1,
        message: {
          message_id: 10,
          from: { id: TG_MATCH_CHAT, first_name: 'Flow Guest', language_code: 'ru' },
          chat: { id: TG_MATCH_CHAT, type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: RC_BOOKING_ID,
        },
      });
      await sleep(DELAY_MS);

      const booking = await notion.findBookingByChatId(TG_MATCH_CHAT);
      assert.ok(booking, 'бронь не найдена по chat_id');
      assert.strictEqual(booking.bookingId, RC_BOOKING_ID);
      assert.strictEqual(Number(booking.telegramChatId), TG_MATCH_CHAT);

      assert.ok(llmCalls.length >= 1, 'LLM не вызван');
      assert.strictEqual(llmCalls.at(-1).context.guestName, 'Full Flow RC Guest');
      assert.ok(telegramCalls.sendMessage.length >= 1, 'sendMessage гостю не вызван');
    });

    // ── Шаг 3: Avito → новый лид + кнопка confirm_booking ──────────────────
    console.log(BOLD('\n── Шаг 3: Avito → новый лид ────────────────────────────'));

    await test('Avito webhook → лид AVITO-{chatId}, кнопка confirm_booking', async () => {
      telegramCalls.notifyOwnerWithActions.length = 0;

      await postWebhook(api, '/webhook/avito', {
        payload: {
          type: 'message',
          author_id: 123456789,
          chat_id: AVITO_CHAT,
          item_id: 'avito-item-flow',
          content: { text: 'Интересует бронь на ноябрь' },
        },
      });
      await sleep(DELAY_MS);

      const lead = await notion.findBookingByAvitoChatId(AVITO_CHAT);
      assert.ok(lead, 'Авито-лид не создан');
      assert.strictEqual(lead.bookingId, `AVITO-${AVITO_CHAT}`);
      assert.strictEqual(lead.status, 'Ожидает подтверждения');
      assert.strictEqual(lead.source, 'Авито');
      avitoPageId = lead.pageId;

      const notify = telegramCalls.notifyOwnerWithActions.at(-1);
      assert.ok(notify, 'notifyOwnerWithActions не вызван для нового лида');
      const buttons = notify.keyboard.flat();
      assert.ok(
        buttons.some((b) => b.callback_data === `confirm_booking:${avitoPageId}`),
        'нет кнопки confirm_booking',
      );

      await notion.updateBookingFields(avitoPageId, {
        dateFrom: '2026-11-01',
        dateTo: '2026-11-03',
      });
    });

    // ── Шаг 4: confirm_booking → blockDates ────────────────────────────────
    console.log(BOLD('\n── Шаг 4: confirm_booking → blockDates ─────────────────'));

    await test('confirm_booking → blockDates вызван, rcSynced=true', async () => {
      const beforeCount = blockDatesCallCount;

      await postWebhook(api, '/webhook/telegram', callbackPayload(`confirm_booking:${avitoPageId}`));
      await sleep(DELAY_MS);

      assert.strictEqual(blockDatesCallCount, beforeCount + 1, 'blockDates должен быть вызван 1 раз');
      assert.strictEqual(blockDatesCalls.at(-1).externalRef, avitoPageId);

      const lead = await notion.findBookingByAvitoChatId(AVITO_CHAT);
      assert.strictEqual(lead.status, 'Подтверждена');
      assert.strictEqual(lead.rcSynced, true);
    });

    // ── Шаг 5: повторный confirm_booking → идемпотентность ─────────────────
    console.log(BOLD('\n── Шаг 5: повторный confirm_booking ─────────────────────'));

    await test('повторный confirm_booking → blockDates не вызывается снова', async () => {
      const beforeCount = blockDatesCallCount;

      await postWebhook(api, '/webhook/telegram', callbackPayload(`confirm_booking:${avitoPageId}`));
      await sleep(DELAY_MS);

      assert.strictEqual(blockDatesCallCount, beforeCount, 'blockDates не должен вызываться повторно');

      const lead = await notion.findBookingByAvitoChatId(AVITO_CHAT);
      assert.strictEqual(lead.rcSynced, true);
      assert.strictEqual(lead.status, 'Подтверждена');

      const lastAnswer = telegramCalls.answerCallbackQuery.at(-1);
      assert.strictEqual(lastAnswer.text, 'Уже синхронизировано ✓');
    });

    // ── Мини-сценарий: CIAN → гард-петля ───────────────────────────────────
    console.log(BOLD('\n── Мини: CIAN → confirm_booking отбит ───────────────────'));

    const CIAN_BOOKING_ID = `FULL-CIAN-${RUN_ID}`;

    await test('source=ЦИАН → confirm_booking отбивается, rcSynced=false', async () => {
      await postWebhook(api, '/webhook/realtycalendar', {
        action: 'create_booking',
        booking_id: CIAN_BOOKING_ID,
        date_from: '2026-12-01',
        date_to: '2026-12-03',
        total_price: 8000,
        guest: { name: 'CIAN Guard Guest', phone: '+79002220002' },
        property: { title: 'CIAN квартира', avito_item_id: null },
        booking_origin: { title: 'ЦИАН' },
      });
      await sleep(DELAY_MS);

      const cian = await notion.findBookingByBookingId(CIAN_BOOKING_ID);
      assert.ok(cian, 'CIAN-бронь не создана');

      const beforeCount = blockDatesCallCount;

      await postWebhook(api, '/webhook/telegram', callbackPayload(`confirm_booking:${cian.pageId}`));
      await sleep(DELAY_MS);

      assert.strictEqual(blockDatesCallCount, beforeCount, 'blockDates не должен вызываться для CIAN');

      const after = await notion.findBookingByBookingId(CIAN_BOOKING_ID);
      assert.strictEqual(after.rcSynced, false);

      const lastAnswer = telegramCalls.answerCallbackQuery.at(-1);
      assert.ok(lastAnswer.text.includes('RC'), `ожидался гард RC, получено: ${lastAnswer.text}`);
    });

    // ── Итог ───────────────────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(54)}`);
    console.log(`Результат: ${GREEN(`${passed} прошло`)}, ${failed > 0 ? RED(`${failed} упало`) : '0 упало'}`);

    if (failed > 0) process.exit(1);

    console.log(GREEN('\n✅ e2e_full_flow.js — все сценарии прошли.\n'));
    process.exit(0);
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error(RED(`\n❌ Неожиданная ошибка: ${err.message}\n`));
  process.exit(1);
});
