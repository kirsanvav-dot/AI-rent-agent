/**
 * Диагностика подключения к Notion.
 * Запуск: node tests/diagnose_notion.js
 */
require('dotenv').config();
const { Client } = require('@notionhq/client');

const TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_DATABASE_ID;

console.log('\n══ Диагностика Notion ══════════════════════════════════\n');

// ── Шаг 1: проверяем .env ────────────────────────────────────────────────────
console.log('1. Переменные окружения:');
console.log(`   NOTION_TOKEN       = ${TOKEN ? TOKEN.slice(0, 12) + '...' : '❌ НЕ ЗАДАН'}`);
console.log(`   NOTION_DATABASE_ID = ${DB_ID || '❌ НЕ ЗАДАН'}`);

if (!TOKEN || !DB_ID) {
  console.error('\n❌ Заполни NOTION_TOKEN и NOTION_DATABASE_ID в файле .env\n');
  process.exit(1);
}

const notion = new Client({ auth: TOKEN });

async function run() {
  // ── Шаг 2: проверяем токен через /users/me ──────────────────────────────
  console.log('\n2. Проверка токена (GET /users/me):');
  try {
    const me = await notion.users.me();
    console.log(`   ✓ Токен действителен. Интеграция: "${me.name}" (id=${me.id})`);
  } catch (err) {
    console.error(`   ✗ Токен недействителен: ${err.message}`);
    console.error('   → Создай новый токен на https://www.notion.so/my-integrations');
    process.exit(1);
  }

  // ── Шаг 3: пробуем получить базу данных и печатаем реальную схему ──────
  console.log(`\n3. Получение базы данных (ID: ${DB_ID}):`);
  try {
    const db = await notion.databases.retrieve({ database_id: DB_ID });
    const title = db.title?.[0]?.plain_text || '(без названия)';
    console.log(`   ✓ База найдена: "${title}"`);

    // Печатаем реальные типы полей
    const EXPECTED = {
      'ID Брони':         'title',
      'Имя клиента':      'rich_text',
      'Телефон':          'phone_number',
      'Даты':             'date',
      'Квартира':         'rich_text',   // в коде поддерживается rich_text
      'Источник':         'select',
      'Сумма':            'number',
      'Статус':           'select',
      'Telegram chat_id': 'number',
      'Авито item_id':    'rich_text',
      'Авито chat_id':    'rich_text',
      'Заметки':          'rich_text',
    };

    console.log('\n4. Сравнение схемы полей:');
    console.log('   ' + '─'.repeat(54));
    console.log(`   ${'Поле'.padEnd(22)} ${'Ожидается'.padEnd(14)} ${'В Notion'.padEnd(14)} Статус`);
    console.log('   ' + '─'.repeat(54));

    let mismatch = false;
    for (const [field, expectedType] of Object.entries(EXPECTED)) {
      const prop = db.properties[field];
      if (!prop) {
        console.log(`   ${field.padEnd(22)} ${expectedType.padEnd(14)} ${'ОТСУТСТВУЕТ'.padEnd(14)} ❌`);
        mismatch = true;
        continue;
      }
      const actualType = prop.type;
      const ok = actualType === expectedType;
      if (!ok) mismatch = true;
      console.log(`   ${field.padEnd(22)} ${expectedType.padEnd(14)} ${actualType.padEnd(14)} ${ok ? '✓' : '❌ НЕСОВПАДЕНИЕ'}`);
    }
    console.log('   ' + '─'.repeat(54));

    if (mismatch) {
      console.error('\n   ⚠  Есть несовпадения типов. Исправь поля в Notion или сообщи об ошибке.');
    } else {
      console.log('\n   ✓ Схема совпадает. Можно переходить к node tests/test_notion.js');
    }
  } catch (err) {
    if (err.code === 'object_not_found') {
      console.error(`   ✗ База не найдена (object_not_found)`);
      console.error('\n   Возможные причины:\n');
      console.error('   A) Нажми ··· → Connections → подключи интеграцию "rental-ai-agent"');
      console.error('   Б) Неверный NOTION_DATABASE_ID в .env (32 символа из URL до ?v=)');
      console.error('   В) Это страница, а не база (создай через / → Database → Full page)\n');
    } else if (err.code === 'unauthorized') {
      console.error(`   ✗ Нет прав: ${err.message}`);
    } else {
      console.error(`   ✗ Ошибка: ${err.code} — ${err.message}`);
    }
    process.exit(1);
  }
}

run();
