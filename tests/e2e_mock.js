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
require('dotenv').config();
const axios = require('axios');

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
