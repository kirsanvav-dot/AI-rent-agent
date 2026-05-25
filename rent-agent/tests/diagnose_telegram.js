/**
 * Диагностика Telegram Bot API через чистый axios (без node-telegram-bot-api).
 * Запуск: node tests/diagnose_telegram.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const { getTelegramProxyUrl, buildAxiosProxyConfig } = require('../src/utils/proxyConfig');

const TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = process.env.TELEGRAM_OWNER_CHAT_ID;
const PROXY    = getTelegramProxyUrl();

console.log('\n══ Диагностика Telegram ════════════════════════════════\n');
console.log(`TELEGRAM_BOT_TOKEN       = ${TOKEN ? TOKEN.slice(0, 10) + '...' : '❌ НЕ ЗАДАН'}`);
console.log(`TELEGRAM_OWNER_CHAT_ID   = ${OWNER_ID || '❌ НЕ ЗАДАН'}`);
console.log(`TELEGRAM_PROXY           = ${PROXY || '(не задан — прямое подключение)'}`);

if (!TOKEN) {
  console.error('\n❌ Заполни TELEGRAM_BOT_TOKEN в .env\n');
  process.exit(1);
}

const api = axios.create({
  baseURL: `https://api.telegram.org/bot${TOKEN}`,
  timeout: 10_000,
  ...buildAxiosProxyConfig(),
});

async function run() {
  // 1. getMe — проверка токена
  console.log('\n1. Проверка токена (getMe):');
  try {
    const { data } = await api.get('/getMe');
    console.log(`   ✓ Бот: @${data.result.username} (id=${data.result.id})`);
  } catch (err) {
    const msg = err.response?.data?.description || err.message;
    console.error(`   ✗ ${msg}`);
    if (err.response?.status === 404) {
      console.error('   → Токен неверный или бот удалён. Проверь TELEGRAM_BOT_TOKEN в .env');
    }
    process.exit(1);
  }

  // 2. sendMessage — отправка владельцу
  console.log(`\n2. Отправка сообщения владельцу (chat_id=${OWNER_ID}):`);
  if (!OWNER_ID) {
    console.error('   ✗ TELEGRAM_OWNER_CHAT_ID не задан');
    process.exit(1);
  }

  try {
    const { data } = await api.post('/sendMessage', {
      chat_id:    OWNER_ID,
      text:       '✅ Диагностика Telegram прошла успешно. Бот работает!',
      parse_mode: 'HTML',
    });
    console.log(`   ✓ Сообщение отправлено (message_id=${data.result.message_id})`);
    console.log('\n✅ Telegram работает корректно. Запусти node tests/test_telegram.js\n');
  } catch (err) {
    const status = err.response?.status;
    const msg    = err.response?.data?.description || err.message;
    console.error(`   ✗ ${msg}`);

    if (status === 400 && msg.includes('chat not found')) {
      console.error('\n   → Бот не может писать тебе первым.');
      console.error('   → Открой Telegram, найди @' + (process.env.BOT_USERNAME || 'своего бота') + ' и нажми Start.\n');
    } else if (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      console.error('\n   → Сетевая ошибка. Попробуй:');
      console.error('   1. Задай TELEGRAM_PROXY=socks5://127.0.0.1:10808 в .env (Xray mixed на RU-сервере)');
      console.error('   2. Проверь: curl -x socks5h://127.0.0.1:10808 https://api.telegram.org/bot<TOKEN>/getMe');
      console.error('   3. Убедись, что Xray outbound на NL-сервер активен\n');
    }
    process.exit(1);
  }
}

run();
