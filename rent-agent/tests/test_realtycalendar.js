/**
 * Smoke-тест services/realtycalendar.js
 * Запуск: node tests/test_realtycalendar.js
 *
 * Мокает axios.create до загрузки модуля — проверяет URL, тело запроса и возврат rcBookingId.
 * Без реальных ключей RC (DEMO_MODE в сервисе при пустом токене).
 */
const axios = require('axios');

process.env.REALTYCALENDAR_API_URL = 'https://rc-test.example/api/v2';
process.env.REALTYCALENDAR_API_TOKEN = 'test-token';
process.env.REALTYCALENDAR_OBJECT_ID = 'OBJ-999';

let captured = null;

const originalCreate = axios.create.bind(axios);
axios.create = (config) => {
  const client = originalCreate(config);
  client.post = async (url, body, options) => {
    captured = { url, body, options, baseURL: config.baseURL };
    return { data: { id: 'RC-MOCK-42' } };
  };
  return client;
};

delete require.cache[require.resolve('../src/services/realtycalendar')];
const { blockDates } = require('../src/services/realtycalendar');

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

  console.log('\n── Тест 1: blockDates (mock axios) ────────────────────');
  try {
    captured = null;
    const result = await blockDates({
      objectId: 'OBJ-123',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-03',
      externalRef: 'page-abc',
    });

    if (!captured) throw new Error('axios.post не был вызван');
    if (captured.url !== '/objects/OBJ-123/block') {
      throw new Error(`URL: ${captured.url}`);
    }
    if (captured.body.date_from !== '2026-06-01' || captured.body.date_to !== '2026-06-03') {
      throw new Error('date_from/date_to не совпадают');
    }
    if (captured.body.external_ref !== 'page-abc') {
      throw new Error('external_ref не совпадает');
    }
    if (result.rcBookingId !== 'RC-MOCK-42') {
      throw new Error(`rcBookingId: ${result.rcBookingId}`);
    }
    ok('POST /objects/{id}/block с корректным телом → { rcBookingId: "RC-MOCK-42" }');
  } catch (err) {
    fail('blockDates', err);
  }

  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`Результат: ${passed} прошло, ${failed} упало`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n✅ test_realtycalendar.js — все тесты прошли.\n');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('[test_realtycalendar] Неожиданная ошибка:', err.message);
  process.exit(1);
});
