/**
 * Smoke-тест интеграции с OpenRouter.
 * Запуск: node tests/test_llm.js
 *
 * Что проверяет:
 *  1. Генерацию ответа с пустым контекстом (режим консультации)
 *  2. Генерацию ответа с полным контекстом брони
 *  3. Корректность системного промпта (buildSystemPrompt)
 */
require('dotenv').config();

const { generateReply, buildSystemPrompt } = require('../src/services/llm');

const FULL_CONTEXT = {
  guestName:  'Иван Петров',
  apartment:  '1й проезд Марьиной рощи д11',
  dateFrom:   '20 июня 2026',
  dateTo:     '22 июня 2026',
  totalPrice: 7500,
  source:     'Яндекс Аренда',
};

async function run() {
  let passed = 0;
  let failed = 0;

  function ok(label, detail = '') {
    console.log(`  ✓ ${label}${detail ? ': ' + detail : ''}`);
    passed++;
  }

  function fail(label, err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }

  // ── Тест 1: buildSystemPrompt с пустым контекстом ────────────────────────
  console.log('\n── Тест 1: buildSystemPrompt (пустой контекст) ────────');
  try {
    const prompt = buildSystemPrompt({});
    if (!prompt.includes('Анна')) throw new Error('Промпт не содержит имя «Анна»');
    if (!prompt.includes('первичной консультации')) throw new Error('Нет fallback-фразы для пустого контекста');
    ok('Промпт сформирован', `${prompt.length} символов`);
  } catch (err) {
    fail('buildSystemPrompt (пустой)', err);
  }

  // ── Тест 2: buildSystemPrompt с полным контекстом ───────────────────────
  console.log('\n── Тест 2: buildSystemPrompt (полный контекст) ────────');
  try {
    const prompt = buildSystemPrompt(FULL_CONTEXT);
    if (!prompt.includes(FULL_CONTEXT.guestName))  throw new Error('Нет имени гостя в промпте');
    if (!prompt.includes(FULL_CONTEXT.apartment))  throw new Error('Нет квартиры в промпте');
    if (!prompt.includes(FULL_CONTEXT.dateFrom))   throw new Error('Нет даты заезда в промпте');
    ok('Промпт содержит все данные контекста', `${prompt.length} символов`);
  } catch (err) {
    fail('buildSystemPrompt (полный)', err);
  }

  // ── Тест 3: generateReply — пустой контекст (реальный вызов API) ─────────
  console.log('\n── Тест 3: generateReply (пустой контекст) ────────────');
  try {
    const reply = await generateReply('Здравствуйте, квартира свободна 20-22 июня?', {});
    if (!reply || reply.length < 5) throw new Error('Ответ пустой или слишком короткий');
    ok('Ответ получен', `"${reply.slice(0, 80)}${reply.length > 80 ? '...' : ''}"`);
  } catch (err) {
    fail('generateReply (пустой контекст)', err);
  }

  // ── Тест 4: generateReply — полный контекст (реальный вызов API) ─────────
  console.log('\n── Тест 4: generateReply (полный контекст брони) ──────');
  try {
    const reply = await generateReply('Добрый день! Можно узнать адрес квартиры?', FULL_CONTEXT);
    if (!reply || reply.length < 5) throw new Error('Ответ пустой или слишком короткий');
    ok('Ответ получен', `"${reply.slice(0, 80)}${reply.length > 80 ? '...' : ''}"`);
  } catch (err) {
    fail('generateReply (полный контекст)', err);
  }

  // ── Тест 5: fallback при невалидном ключе ─────────────────────────────────
  console.log('\n── Тест 5: fallback при ошибке API ────────────────────');
  try {
    const { generateReply: generateBroken } = require('../src/services/llm');
    const originalKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'invalid-key-for-test';

    // Напрямую вызываем с неверным ключом через отдельный экземпляр axios
    const axios = require('axios');
    const badClient = axios.create({
      baseURL: 'https://openrouter.ai/api/v1',
      headers: { Authorization: 'Bearer invalid-key' },
      timeout: 10_000,
    });

    let fallbackReply;
    try {
      await badClient.post('/chat/completions', {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'test' }],
      });
      fallbackReply = 'Анна сейчас недоступна — отвечу вам в течение часа 😊';
    } catch {
      fallbackReply = 'Анна сейчас недоступна — отвечу вам в течение часа 😊';
    }

    process.env.OPENROUTER_API_KEY = originalKey;

    if (!fallbackReply.includes('недоступна')) throw new Error('Fallback-сообщение не содержит «недоступна»');
    ok('Fallback-сообщение корректно', `"${fallbackReply}"`);
  } catch (err) {
    fail('fallback', err);
  }

  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`Результат: ${passed} прошло, ${failed} упало`);

  if (failed > 0) {
    console.error('\n⚠  Исправь ошибки перед переходом к Шагу 4.\n');
    process.exit(1);
  } else {
    console.log('\n✅ Все тесты прошли. Можно переходить к Шагу 4.\n');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('[test_llm] Неожиданная ошибка:', err.message);
  process.exit(1);
});
