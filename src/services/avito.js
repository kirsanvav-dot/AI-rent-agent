const axios = require('axios');

const {
  AVITO_CLIENT_ID,
  AVITO_CLIENT_SECRET,
  AVITO_USER_ID,
  DEMO_MODE,
} = process.env;

const isDemoMode = DEMO_MODE === 'true' || !AVITO_CLIENT_ID || !AVITO_CLIENT_SECRET;

if (isDemoMode) {
  console.log('[avito] 🎭 DEMO MODE — реальные запросы к Авито не отправляются');
} 

const avito = axios.create({
  baseURL: 'https://api.avito.ru',
  timeout: 15_000,
});

// ─── Кеш OAuth2-токена ────────────────────────────────────────────────────────

let _tokenCache = null;

/**
 * Получает OAuth2 access_token через Client Credentials.
 * В DEMO MODE возвращает фиктивный токен без обращения к API.
 *
 * @returns {string} access_token
 */
async function getToken() {
  if (isDemoMode) {
    console.log('[avito] [DEMO] getToken → demo-token-xxx');
    return 'demo-token-xxx';
  }

  const now = Date.now();
  if (_tokenCache && _tokenCache.expires_at > now + 60_000) {
    return _tokenCache.access_token;
  }

  console.log('[avito] Получение нового OAuth2-токена...');

  const params = new URLSearchParams({
    client_id:     AVITO_CLIENT_ID,
    client_secret: AVITO_CLIENT_SECRET,
    grant_type:    'client_credentials',
  });

  const response = await avito.post('/token', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const { access_token, expires_in } = response.data;
  _tokenCache = { access_token, expires_at: now + expires_in * 1000 };

  console.log(`[avito] Токен получен, истекает через ${expires_in} сек`);
  return access_token;
}

// ─── Публичные функции ────────────────────────────────────────────────────────

/**
 * Блокирует даты в календаре объявления на Авито.
 * В DEMO MODE только логирует действие.
 */
async function blockDates(token, userId, itemId, dateFrom, dateTo) {
  if (isDemoMode) {
    console.log(`[avito] [DEMO] blockDates: itemId=${itemId}, ${dateFrom} → ${dateTo} ✓ (не отправлено)`);
    return;
  }

  console.log(`[avito] blockDates: itemId=${itemId}, ${dateFrom} → ${dateTo}`);

  await avito.post(
    `/core/v1/accounts/${userId}/items/${itemId}/bookings`,
    { date_from: dateFrom, date_to: dateTo },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  console.log(`[avito] Даты заблокированы: itemId=${itemId}`);
}

/**
 * Отправляет сообщение в чат Авито.
 * В DEMO MODE только логирует текст ответа.
 */
async function sendMessage(token, userId, chatId, text) {
  if (isDemoMode) {
    console.log(`[avito] [DEMO] sendMessage → chatId=${chatId}`);
    console.log(`[avito] [DEMO] Текст ответа: "${text}"`);
    return;
  }

  console.log(`[avito] sendMessage → chatId=${chatId}: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);

  await avito.post(
    `/messenger/v1/accounts/${userId}/chats/${chatId}/messages`,
    { message: { text }, type: 'text' },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  console.log(`[avito] Сообщение отправлено в чат ${chatId}`);
}

module.exports = {
  getToken,
  blockDates,
  sendMessage,
  isDemoMode,
  userId: AVITO_USER_ID,
};
