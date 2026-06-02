require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE === 'true') {
  console.warn('[index] ⚠️ DEMO_MODE=true в production!');
}
if (process.env.NODE_ENV === 'production' && (!process.env.AVITO_CLIENT_ID || !process.env.AVITO_CLIENT_SECRET)) {
  console.error('[index] Production без AVITO_CLIENT_ID/SECRET — выход');
  process.exit(1);
}

const express = require('express');
const requestLogger = require('./src/middleware/logger');
const telegramWebhook = require('./src/routes/telegram');
const telegramService = require('./src/services/telegram');
const realtycalendarWebhook = require('./src/routes/realtycalendar');
const avitoWebhook = require('./src/routes/avito');

const TELEGRAM_MODE = (process.env.TELEGRAM_MODE || 'webhook').toLowerCase();
if (TELEGRAM_MODE !== 'webhook' && TELEGRAM_MODE !== 'polling') {
  console.error(`[index] Неверный TELEGRAM_MODE="${process.env.TELEGRAM_MODE}", ожидается webhook или polling`);
  process.exit(1);
}

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

if (TELEGRAM_MODE === 'webhook') {
  app.post('/webhook/telegram', telegramWebhook);
} else {
  telegramService.startPolling(telegramWebhook.processTelegramUpdate).catch((err) => {
    console.error(`[index] Не удалось запустить Telegram polling: ${err.message}`);
    process.exit(1);
  });
}

app.post('/webhook/realtycalendar', realtycalendarWebhook);
app.post('/webhook/avito', avitoWebhook);

app.use((err, _req, res, _next) => {
  console.error('[index] Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Rental AI Agent запущен на http://localhost:${PORT}`);
  console.log(`NODE_ENV=${process.env.NODE_ENV || 'development'}`);
  console.log(`TELEGRAM_MODE=${TELEGRAM_MODE}`);
});

module.exports = app;
