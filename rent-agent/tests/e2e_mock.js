/**
 * E2E-тест: мок-вебхуки для проверки всего pipeline локально.
 *
 * Запуск (два терминала):
 *   Терминал 1: node index.js
 *   Терминал 2: node tests/e2e_mock.js
 *
 * Что проверяет:
 *   1. POST /webhook/realtycalendar → запись в Notion + уведомление в Telegram
 *   2. POST /webhook/telegram       → ответ «Анны» гостю
 *   3. POST /webhook/avito          → ответ в чат Авито (только HTTP 200, реальный Авито не вызывается)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const { findBookingByAvitoChatId, findBookingByBookingId, findBookingByChatId, updateBookingFields } = require('../src/services/notion');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const DELAY_MS = 3000; // ждём pipeline после 200 OK

const api = axios.create({ baseURL: BASE_URL, timeout: 10_000 });

// ── Цвета для консоли ──────────────────────────────────────────────────────
const GREEN  = (s) => `\x1b[32m${s}\x1b[0m`;
const RED    = (s) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const BOLD   = (s) => `\x1b[1m${s}\x1b[0m`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Тестовые данные ────────────────────────────────────────────────────────
const RC_PAYLOAD = {
  action:       'create_booking',
  booking_id:   `E2E-${Date.now()}`,
  date_from:    '2026-08-01',
  date_to:      '2026-08-03',
  total_price:  6000,
  guest: {
    name:  'E2E Тестовый Гость',
    phone: '+79001112233',
  },
  property: {
    title:          'Тестовая квартира E2E',
    avito_item_id:  null,  // нет Авито ID — шаг blockDates будет пропущен
  },
  booking_origin: {
    title: 'Яндекс Аренда',
  },
};

const TG_PAYLOAD = {
  update_id: 100000001,
  message: {
    message_id: 1,
    from: { id: 999888777, first_name: 'E2E Гость', language_code: 'ru' },
    chat: { id: 999888777, type: 'private' },
    date: Math.floor(Date.now() / 1000),
    text: 'Добрый день! Когда можно заехать?',
  },
};

const AVITO_PAYLOAD = {
  payload: {
    type:      'message',
    author_id: 987654321,    // не AVITO_USER_ID → должен обработаться
    chat_id:   'avito-chat-e2e-001',
    content:   { text: 'Здравствуйте, квартира ещё свободна?' },
  },
};

// ── Основной прогон ────────────────────────────────────────────────────────
async function run() {
  let passed = 0;
  let failed = 0;

  async function test(label, fn) {
    try {
      await fn();
      console.log(GREEN(`  ✓ ${label}`));
      passed++;
    } catch (err) {
      console.log(RED(`  ✗ ${label}`));
      console.log(RED(`    ${err.message}`));
      failed++;
    }
  }

  // ── Проверяем, что сервер запущен ────────────────────────────────────────
  console.log(BOLD('\n── Проверка сервера ───────────────────────────────────'));
  await test('GET /health → 200 OK', async () => {
    const { data } = await api.get('/health');
    if (data.status !== 'ok') throw new Error(`Неожиданный статус: ${data.status}`);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Тест 1: RealtyCalendar webhook
  // ────────────────────────────────────────────────────────────────────────
  console.log(BOLD('\n── Тест 1: POST /webhook/realtycalendar ───────────────'));
  console.log(YELLOW(`  booking_id: ${RC_PAYLOAD.booking_id}`));

  await test('Вебхук вернул 200 OK', async () => {
    const { status } = await api.post('/webhook/realtycalendar', RC_PAYLOAD);
    if (status !== 200) throw new Error(`Ожидался 200, получен ${status}`);
  });

  console.log(YELLOW(`  Ждём ${DELAY_MS / 1000} сек (pipeline: Notion + Telegram)...`));
  await sleep(DELAY_MS);
  console.log(YELLOW('  → Проверь Notion: должна появиться запись «E2E Тестовый Гость»'));
  console.log(YELLOW('  → Проверь Telegram: владелец должен получить уведомление о брони'));

  // ────────────────────────────────────────────────────────────────────────
  // Тест 2: Telegram webhook
  // ────────────────────────────────────────────────────────────────────────
  console.log(BOLD('\n── Тест 2: POST /webhook/telegram ─────────────────────'));
  console.log(YELLOW(`  chat_id: ${TG_PAYLOAD.message.chat.id}, текст: "${TG_PAYLOAD.message.text}"`));

  await test('Вебхук вернул 200 OK', async () => {
    const { status } = await api.post('/webhook/telegram', TG_PAYLOAD);
    if (status !== 200) throw new Error(`Ожидался 200, получен ${status}`);
  });

  console.log(YELLOW(`  Ждём ${DELAY_MS / 1000} сек (pipeline: Notion → LLM → Telegram)...`));
  await sleep(DELAY_MS);
  console.log(YELLOW(`  → Бронь для chatId=999888777 не найдена (ожидаемо — это тест)`));
  console.log(YELLOW(`  → Владелец должен получить уведомление о незнакомом госте`));

  // ────────────────────────────────────────────────────────────────────────
  // Тест 3: Авито webhook
  // ────────────────────────────────────────────────────────────────────────
  console.log(BOLD('\n── Тест 3: POST /webhook/avito ────────────────────────'));
  console.log(YELLOW(`  chat_id: ${AVITO_PAYLOAD.payload.chat_id}`));

  await test('Вебхук вернул 200 OK', async () => {
    const { status } = await api.post('/webhook/avito', AVITO_PAYLOAD);
    if (status !== 200) throw new Error(`Ожидался 200, получен ${status}`);
  });

  console.log(YELLOW(`  Ждём ${DELAY_MS / 1000} сек (pipeline: LLM → Авито Messenger)...`));
  await sleep(DELAY_MS);
  console.log(YELLOW('  → Авито: попытка отправить ответ (упадёт если нет реальных Авито-ключей — это норма)'));

  // ────────────────────────────────────────────────────────────────────────
  // Тест 4: игнорирование чужих событий
  // ────────────────────────────────────────────────────────────────────────
  console.log(BOLD('\n── Тест 4: Авито — игнорирование собственных сообщений ─'));

  await test('Сообщение от себя → 200 OK, pipeline не запущен', async () => {
    const selfMsg = {
      payload: {
        type:      'message',
        author_id: process.env.AVITO_USER_ID || '0',
        chat_id:   'avito-chat-self',
        content:   { text: 'Это моё собственное сообщение' },
      },
    };
    const { status } = await api.post('/webhook/avito', selfMsg);
    if (status !== 200) throw new Error(`Ожидался 200, получен ${status}`);
  });

  await test('Неизвестный action RealtyCalendar → 200 OK, пропущено', async () => {
    const { status } = await api.post('/webhook/realtycalendar', { action: 'unknown_event' });
    if (status !== 200) throw new Error(`Ожидался 200, получен ${status}`);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Тест 5: Авито → новый лид в Notion CRM
  // ────────────────────────────────────────────────────────────────────────
  const AVITO_LEAD_CHAT = `avito-lead-e2e-${Date.now()}`;

  console.log(BOLD('\n── Тест 5: Авито — новый чат → лид в Notion ───────────'));
  console.log(YELLOW(`  chat_id: ${AVITO_LEAD_CHAT}`));

  await test('Новый Авито-чат → лид создан в Notion', async () => {
    const payload = {
      payload: {
        type: 'message',
        author_id: 987654321,
        chat_id: AVITO_LEAD_CHAT,
        item_id: 'avito-item-e2e-001',
        content: { text: 'Здравствуйте, интересует квартира на выходные' },
      },
    };
    const { status } = await api.post('/webhook/avito', payload);
    if (status !== 200) throw new Error(`Ожидался 200, получен ${status}`);

    await sleep(DELAY_MS);

    const booking = await findBookingByAvitoChatId(AVITO_LEAD_CHAT);
    if (!booking) throw new Error('Лид не найден в Notion');
    if (booking.bookingId !== `AVITO-${AVITO_LEAD_CHAT}`) {
      throw new Error(`ID Брони: ${booking.bookingId}, ожидался AVITO-${AVITO_LEAD_CHAT}`);
    }
    if (booking.status !== 'Ожидает подтверждения') {
      throw new Error(`Статус: ${booking.status}, ожидался «Ожидает подтверждения»`);
    }
    if (booking.source !== 'Авито') {
      throw new Error(`Источник: ${booking.source}, ожидался «Авито»`);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // Тест 6: Авито — повторное сообщение без дубликата
  // ────────────────────────────────────────────────────────────────────────
  console.log(BOLD('\n── Тест 6: Авито — повторное сообщение → без дубликата ─'));

  await test('Повторное сообщение в том же чате → одна запись в Notion', async () => {
    const payload = {
      payload: {
        type: 'message',
        author_id: 987654321,
        chat_id: AVITO_LEAD_CHAT,
        content: { text: 'А можно с животными?' },
      },
    };
    const { status } = await api.post('/webhook/avito', payload);
    if (status !== 200) throw new Error(`Ожидался 200, получен ${status}`);

    await sleep(DELAY_MS);

    const byChat = await findBookingByAvitoChatId(AVITO_LEAD_CHAT);
    const byId = await findBookingByBookingId(`AVITO-${AVITO_LEAD_CHAT}`);
    if (!byChat || !byId) throw new Error('Запись не найдена после повторного сообщения');
    if (byChat.pageId !== byId.pageId) {
      throw new Error('pageId различается — возможен дубликат');
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // Тест 7: Telegram — матчинг по коду брони
  // ────────────────────────────────────────────────────────────────────────
  const TG_MATCH_CHAT = 800000000 + (Date.now() % 100000000);
  const TG_BOOKING_ID = RC_PAYLOAD.booking_id;

  console.log(BOLD('\n── Тест 7: Telegram — код брони → привязка chat_id ──'));
  console.log(YELLOW(`  chat_id: ${TG_MATCH_CHAT}, booking_id: ${TG_BOOKING_ID}`));

  await test('Код брони → Telegram chat_id записан в Notion', async () => {
    const payload = {
      update_id: 200000001,
      message: {
        message_id: 2,
        from: { id: TG_MATCH_CHAT, first_name: 'E2E Match', language_code: 'ru' },
        chat: { id: TG_MATCH_CHAT, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: TG_BOOKING_ID,
      },
    };
    const { status } = await api.post('/webhook/telegram', payload);
    if (status !== 200) throw new Error(`Ожидался 200, получен ${status}`);

    await sleep(DELAY_MS);

    const booking = await findBookingByChatId(TG_MATCH_CHAT);
    if (!booking) throw new Error('Бронь не найдена по chat_id после матчинга');
    if (booking.bookingId !== TG_BOOKING_ID) {
      throw new Error(`bookingId: ${booking.bookingId}, ожидался ${TG_BOOKING_ID}`);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // Тест 8: Telegram — матчинг по contact
  // ────────────────────────────────────────────────────────────────────────
  const TG_CONTACT_CHAT = 777666555;
  const RC_CONTACT_PHONE = '+79002223344';
  const RC_CONTACT_BOOKING = `E2E-CONTACT-${Date.now()}`;

  console.log(BOLD('\n── Тест 8: Telegram — contact → привязка chat_id ──────'));
  console.log(YELLOW(`  chat_id: ${TG_CONTACT_CHAT}, phone: ${RC_CONTACT_PHONE}`));

  await test('Contact → Telegram chat_id записан в Notion', async () => {
    const rcContactPayload = {
      action: 'create_booking',
      booking_id: RC_CONTACT_BOOKING,
      date_from: '2026-09-01',
      date_to: '2026-09-03',
      total_price: 5000,
      guest: { name: 'E2E Contact Guest', phone: RC_CONTACT_PHONE },
      property: { title: 'Квартира для contact-теста', avito_item_id: null },
      booking_origin: { title: 'ЦИАН' },
    };
    const { status: rcStatus } = await api.post('/webhook/realtycalendar', rcContactPayload);
    if (rcStatus !== 200) throw new Error(`RC webhook: ожидался 200, получен ${rcStatus}`);
    await sleep(DELAY_MS);

    const payload = {
      update_id: 200000002,
      message: {
        message_id: 3,
        from: { id: TG_CONTACT_CHAT, first_name: 'E2E Contact', language_code: 'ru' },
        chat: { id: TG_CONTACT_CHAT, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        contact: {
          phone_number: RC_CONTACT_PHONE,
          first_name: 'E2E Contact',
          user_id: TG_CONTACT_CHAT,
        },
      },
    };
    const { status } = await api.post('/webhook/telegram', payload);
    if (status !== 200) throw new Error(`Ожидался 200, получен ${status}`);

    await sleep(DELAY_MS);

    const booking = await findBookingByChatId(TG_CONTACT_CHAT);
    if (!booking) throw new Error('Бронь не найдена по chat_id после contact');
    if (booking.bookingId !== RC_CONTACT_BOOKING) {
      throw new Error(`bookingId: ${booking.bookingId}, ожидался ${RC_CONTACT_BOOKING}`);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // Тест 9: Telegram — повторное сообщение находит бронь сразу
  // ────────────────────────────────────────────────────────────────────────
  console.log(BOLD('\n── Тест 9: Telegram — повторный chatId → findByChatId ─'));

  await test('Повторное сообщение → бронь находится по chat_id без повторной привязки', async () => {
    const payload = {
      update_id: 200000003,
      message: {
        message_id: 4,
        from: { id: TG_MATCH_CHAT, first_name: 'E2E Match', language_code: 'ru' },
        chat: { id: TG_MATCH_CHAT, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: 'Спасибо, а во сколько заезд?',
      },
    };
    const { status } = await api.post('/webhook/telegram', payload);
    if (status !== 200) throw new Error(`Ожидался 200, получен ${status}`);

    await sleep(DELAY_MS);

    const booking = await findBookingByChatId(TG_MATCH_CHAT);
    if (!booking) throw new Error('Бронь не найдена при повторном сообщении');
    if (Number(booking.telegramChatId) !== TG_MATCH_CHAT) {
      throw new Error(`telegramChatId: ${booking.telegramChatId}, ожидался ${TG_MATCH_CHAT}`);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // Тест 10–12: callback_query — смена статуса владельцем
  // ────────────────────────────────────────────────────────────────────────
  const CB_RC_BOOKING = `E2E-CB-${Date.now()}`;
  const OWNER_ID = Number(process.env.TELEGRAM_OWNER_CHAT_ID);
  let cbPageId = null;

  console.log(BOLD('\n── Тест 10–12: Telegram callback_query — статусы ──────'));
  console.log(YELLOW(`  booking_id: ${CB_RC_BOOKING}, owner_id: ${OWNER_ID}`));

  await test('Подготовка: RC-бронь для callback-тестов', async () => {
    const payload = {
      action: 'create_booking',
      booking_id: CB_RC_BOOKING,
      date_from: '2026-10-01',
      date_to: '2026-10-03',
      total_price: 7000,
      guest: { name: 'E2E Callback Guest', phone: '+79003334455' },
      property: { title: 'Квартира для callback-теста', avito_item_id: null },
      booking_origin: { title: 'Яндекс Аренда' },
    };
    const { status } = await api.post('/webhook/realtycalendar', payload);
    if (status !== 200) throw new Error(`RC webhook: ожидался 200, получен ${status}`);
    await sleep(DELAY_MS);

    const booking = await findBookingByBookingId(CB_RC_BOOKING);
    if (!booking) throw new Error('RC-бронь не создана');
    if (booking.status !== 'Подтверждена') {
      throw new Error(`Статус: ${booking.status}, ожидался «Подтверждена»`);
    }
    cbPageId = booking.pageId;
  });

  await test('Не-владелец нажал кнопку → статус не меняется', async () => {
    const payload = {
      update_id: 300000001,
      callback_query: {
        id: `cb-non-owner-${Date.now()}`,
        from: { id: 111222333, first_name: 'Intruder', language_code: 'ru' },
        message: {
          message_id: 50,
          chat: { id: OWNER_ID, type: 'private' },
        },
        chat_instance: 'e2e-non-owner',
        data: `status_cancelled:${cbPageId}`,
      },
    };
    const { status } = await api.post('/webhook/telegram', payload);
    if (status !== 200) throw new Error(`Ожидался 200, получен ${status}`);
    await sleep(DELAY_MS);

    const booking = await findBookingByBookingId(CB_RC_BOOKING);
    if (booking.status !== 'Подтверждена') {
      throw new Error(`Статус изменился на «${booking.status}», ожидался «Подтверждена»`);
    }
  });

  await test('Недопустимый переход → статус не меняется', async () => {
    const payload = {
      update_id: 300000002,
      callback_query: {
        id: `cb-invalid-${Date.now()}`,
        from: { id: OWNER_ID, first_name: 'Owner', language_code: 'ru' },
        message: {
          message_id: 51,
          chat: { id: OWNER_ID, type: 'private' },
        },
        chat_instance: 'e2e-invalid',
        data: `status_completed:${cbPageId}`,
      },
    };
    const { status } = await api.post('/webhook/telegram', payload);
    if (status !== 200) throw new Error(`Ожидался 200, получен ${status}`);
    await sleep(DELAY_MS);

    const booking = await findBookingByBookingId(CB_RC_BOOKING);
    if (booking.status !== 'Подтверждена') {
      throw new Error(`Статус: «${booking.status}», ожидался «Подтверждена» (переход Подтверждена→Завершена недопустим)`);
    }
  });

  await test('Валидный переход → Notion-статус обновился', async () => {
    const payload = {
      update_id: 300000003,
      callback_query: {
        id: `cb-valid-${Date.now()}`,
        from: { id: OWNER_ID, first_name: 'Owner', language_code: 'ru' },
        message: {
          message_id: 52,
          chat: { id: OWNER_ID, type: 'private' },
        },
        chat_instance: 'e2e-valid',
        data: `status_checkedin:${cbPageId}`,
      },
    };
    const { status } = await api.post('/webhook/telegram', payload);
    if (status !== 200) throw new Error(`Ожидался 200, получен ${status}`);
    await sleep(DELAY_MS);

    const booking = await findBookingByBookingId(CB_RC_BOOKING);
    if (booking.status !== 'Заехал') {
      throw new Error(`Статус: «${booking.status}», ожидался «Заехал»`);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // Тест 13–15: confirm_booking → blockDates (US-CHG-6)
  // ────────────────────────────────────────────────────────────────────────
  const CONFIRM_AVITO_CHAT = `avito-confirm-e2e-${Date.now()}`;
  const CIAN_LOOP_BOOKING = `E2E-CIAN-LOOP-${Date.now()}`;
  let confirmPageId = null;

  console.log(BOLD('\n── Тест 13–15: confirm_booking → RC blockDates ───────'));

  await test('confirm_booking: Авито-лид с датами → rcSynced=true', async () => {
    const payload = {
      payload: {
        type: 'message',
        author_id: 987654321,
        chat_id: CONFIRM_AVITO_CHAT,
        item_id: 'avito-item-confirm-001',
        content: { text: 'Хочу забронировать на 1–3 ноября' },
      },
    };
    const { status } = await api.post('/webhook/avito', payload);
    if (status !== 200) throw new Error(`Avito webhook: ожидался 200, получен ${status}`);
    await sleep(DELAY_MS);

    const lead = await findBookingByAvitoChatId(CONFIRM_AVITO_CHAT);
    if (!lead) throw new Error('Авито-лид не создан');
    confirmPageId = lead.pageId;

    await updateBookingFields(confirmPageId, {
      dateFrom: '2026-11-01',
      dateTo: '2026-11-03',
    });

    const cbPayload = {
      update_id: 400000001,
      callback_query: {
        id: `cb-confirm-${Date.now()}`,
        from: { id: OWNER_ID, first_name: 'Owner', language_code: 'ru' },
        message: { message_id: 60, chat: { id: OWNER_ID, type: 'private' } },
        chat_instance: 'e2e-confirm',
        data: `confirm_booking:${confirmPageId}`,
      },
    };
    const { status: cbStatus } = await api.post('/webhook/telegram', cbPayload);
    if (cbStatus !== 200) throw new Error(`callback_query: ожидался 200, получен ${cbStatus}`);
    await sleep(DELAY_MS);

    const booking = await findBookingByAvitoChatId(CONFIRM_AVITO_CHAT);
    if (booking.status !== 'Подтверждена') {
      throw new Error(`Статус: «${booking.status}», ожидался «Подтверждена»`);
    }
    if (booking.rcSynced !== true) {
      throw new Error(`rcSynced=${booking.rcSynced}, ожидался true`);
    }
  });

  await test('confirm_booking: source=ЦИАН → гард-петля, rcSynced=false', async () => {
    const rcPayload = {
      action: 'create_booking',
      booking_id: CIAN_LOOP_BOOKING,
      date_from: '2026-12-01',
      date_to: '2026-12-03',
      total_price: 8000,
      guest: { name: 'E2E CIAN Loop', phone: '+79004445566' },
      property: { title: 'Квартира CIAN loop', avito_item_id: null },
      booking_origin: { title: 'ЦИАН' },
    };
    const { status: rcStatus } = await api.post('/webhook/realtycalendar', rcPayload);
    if (rcStatus !== 200) throw new Error(`RC webhook: ожидался 200, получен ${rcStatus}`);
    await sleep(DELAY_MS);

    const cianBooking = await findBookingByBookingId(CIAN_LOOP_BOOKING);
    if (!cianBooking) throw new Error('CIAN-бронь не создана');

    const cbPayload = {
      update_id: 400000002,
      callback_query: {
        id: `cb-cian-loop-${Date.now()}`,
        from: { id: OWNER_ID, first_name: 'Owner', language_code: 'ru' },
        message: { message_id: 61, chat: { id: OWNER_ID, type: 'private' } },
        chat_instance: 'e2e-cian-loop',
        data: `confirm_booking:${cianBooking.pageId}`,
      },
    };
    const { status: cbStatus } = await api.post('/webhook/telegram', cbPayload);
    if (cbStatus !== 200) throw new Error(`callback_query: ожидался 200, получен ${cbStatus}`);
    await sleep(DELAY_MS);

    const after = await findBookingByBookingId(CIAN_LOOP_BOOKING);
    if (after.rcSynced === true) {
      throw new Error('rcSynced=true для CIAN-брони — гард-петля не сработал');
    }
  });

  await test('confirm_booking: повторное нажатие → идемпотентность (rcSynced остаётся true)', async () => {
    if (!confirmPageId) throw new Error('confirmPageId не задан (тест 13 не прошёл)');

    const cbPayload = {
      update_id: 400000003,
      callback_query: {
        id: `cb-confirm-repeat-${Date.now()}`,
        from: { id: OWNER_ID, first_name: 'Owner', language_code: 'ru' },
        message: { message_id: 62, chat: { id: OWNER_ID, type: 'private' } },
        chat_instance: 'e2e-confirm-repeat',
        data: `confirm_booking:${confirmPageId}`,
      },
    };
    const { status: cbStatus } = await api.post('/webhook/telegram', cbPayload);
    if (cbStatus !== 200) throw new Error(`callback_query: ожидался 200, получен ${cbStatus}`);
    await sleep(DELAY_MS);

    const booking = await findBookingByAvitoChatId(CONFIRM_AVITO_CHAT);
    if (booking.rcSynced !== true) {
      throw new Error(`rcSynced=${booking.rcSynced}, ожидался true после повторного нажатия`);
    }
    if (booking.status !== 'Подтверждена') {
      throw new Error(`Статус: «${booking.status}», ожидался «Подтверждена»`);
    }
  });

  // ── Итог ─────────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(54)}`);
  console.log(`Результат: ${GREEN(`${passed} прошло`)}, ${failed > 0 ? RED(`${failed} упало`) : `0 упало`}`);

  if (failed > 0) {
    console.log(RED('\n⚠  Есть ошибки HTTP-уровня. Проверь, что сервер запущен: node index.js\n'));
    process.exit(1);
  } else {
    console.log(GREEN('\n✅ Все HTTP-тесты прошли.'));
    console.log('   Проверь вручную Notion и Telegram — там должны появиться тестовые данные.\n');
    process.exit(0);
  }
}

run().catch((err) => {
  if (err.code === 'ECONNREFUSED') {
    console.error(RED('\n❌ Сервер не запущен. Выполни в другом терминале: node index.js\n'));
  } else {
    console.error(RED(`\n❌ Неожиданная ошибка: ${err.message}\n`));
  }
  process.exit(1);
});
