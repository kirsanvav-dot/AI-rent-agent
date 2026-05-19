require('dotenv').config();

const express = require('express');
const requestLogger = require('./src/middleware/logger');
const telegramWebhook = require('./src/routes/telegram');
const realtycalendarWebhook = require('./src/routes/realtycalendar');
const avitoWebhook = require('./src/routes/avito');

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.post('/webhook/telegram', telegramWebhook);
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
});

module.exports = app;
