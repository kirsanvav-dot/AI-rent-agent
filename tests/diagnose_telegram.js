/**
 * Диагностика Telegram Bot API через чистый axios (без node-telegram-bot-api).
 * Запуск: node tests/diagnose_telegram.js
 */
require('dotenv').config();
const axios = require('axios');

const TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = process.env.TELEGRAM_OWNER_CHAT_ID;

console.log('\n══ Диагностика Telegram ════════════════════════════════\n');
console.log(`TELEGRAM_BOT_TOKEN       = ${TOKEN ? TOKEN.slice(0, 10) + '...' : '❌ НЕ ЗАДАН'}`);
console.log(`TELEGRAM_OWNER_CHAT_ID   = ${OWNER_ID || '❌ НЕ ЗАДАН'}`);

if (!TOKEN) {
  console.error('\n❌ Заполни TELEGRAM_BOT_TOKEN в .env\n');
  process.exit(1);
}

const api = axios.create({
  baseURL: `https://api.telegram.org/bot${TOKEN}`,
  timeout: 10_000,
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
    } else if (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED') {
      console.error('\n   → Сетевая ошибка. Попробуй:');
      console.error('   1. Отключить и снова включить VPN');
      console.error('   2. Сменить VPN-сервер');
      console.error('   3. Запустить: curl -s https://api.telegram.org — если не отвечает, VPN не пропускает\n');
    }
    process.exit(1);
  }
}

run();
