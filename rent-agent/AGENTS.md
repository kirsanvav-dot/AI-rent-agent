# AGENTS.md

## Project Overview

AI-агент посуточной аренды: Express-сервер, принимает вебхуки Telegram / Авито / RealtyCalendar, ведёт CRM в Notion, отвечает гостям через OpenRouter LLM.  
Brownfield. Источник правды: `SPECIFICATION.md` v2.1, `ARCHITECTURE.md` v2.1, `CHANGE_REQUEST.md`.

## Setup

```bash
cd rent-agent
npm install
cp .env.example .env   # заполнить ключами (см. Environment)
```

## Build & Run

```bash
npm start              # production: node index.js
npm run dev            # nodemon
```

Запускать **только** из `rent-agent/` (см. CR-CHG-01: dotenv с явным путём).

## Testing

Тесты — самостоятельные скрипты без фреймворка.

```bash
node tests/test_notion.js        # CRUD Notion
node tests/test_llm.js           # OpenRouter
node tests/test_telegram.js      # Telegram (реальная отправка владельцу)
node tests/e2e_mock.js           # 3 happy-path вебхука + 2 edge-case (DEMO_MODE=true)
node tests/diagnose_notion.js    # схема базы Notion
node tests/diagnose_telegram.js  # бот через axios
```

**Регрессия перед коммитом:** `e2e_mock.js` + `test_notion.js` обязательно зелёные.

## Code Style

- CommonJS (`require` / `module.exports`), Node 18+.
- Конвенция логов: `[module] action: detail` (log), `[module] Ошибка action: msg` (error). Имя модуля = имя файла нижним регистром.
- Каждый внешний вызов в **отдельном** `try/catch`; ошибка одного шага не прерывает остальные.
- Все вебхуки: `res.sendStatus(200)` **первым**, дальше `(async () => { ... })()`.
- Thin routes / fat services. Сервисы не зависят друг от друга (исключение: `services/telegram.js` → `utils/formatDate.js`).
- Маппинг Notion API инкапсулирован в `services/notion.js` (`buildNotionProperties` / `parseNotionPage`) — наружу не утекает.
- Новые сервисы — отдельными файлами в `src/services/`. Новые тесты — `tests/test_<feature>.js`.

## Important Constraints

- **НЕ трогать** (CHANGE_REQUEST §4): `src/services/avito.js`, `src/services/llm.js`, `src/middleware/logger.js`, `src/utils/formatDate.js`, `tests/diagnose_*.js`, `tests/test_llm.js`, `tests/test_telegram.js`, `package.json` (новых deps не добавлять — `axios` хватает для нового RC-сервиса).
- **НЕ менять** контракты публичных функций в `services/notion.js` и `services/telegram.js` — только аддитивно.
- **НЕ удалять** `DEMO_MODE` — он нужен для CI (`e2e_mock.js`); только добавить warning при `NODE_ENV=production`.
- **НЕ коммитить** `.env`, реальные токены, `node_modules/`.
- **НЕ менять** схему Notion в коде — изменения схемы выполняются вручную в UI Notion (см. CHANGE_REQUEST §7).
- **НЕ оптимизировать** код вне задачи (рефакторинги из GAP-009/013/014/015/016 — в бэклоге, не трогать).
- **НЕ верифицировать** подписи вебхуков (GAP-003: DEFER до выхода на публичный URL).
- **НЕ добавлять** новые зависимости без явного запроса.

## Environment

`rent-agent/.env` (рядом с `index.js`, **не** в корне репо). Шаблон — `.env.example`.

| Переменная | Где взять |
|-----------|-----------|
| `NOTION_TOKEN`, `NOTION_DATABASE_ID` | notion.so/my-integrations + ID базы «Брони» |
| `OPENROUTER_API_KEY` | openrouter.ai/keys |
| `TELEGRAM_BOT_TOKEN` | @BotFather |
| `TELEGRAM_OWNER_CHAT_ID` | свой chat_id (написать боту, посмотреть лог) |
| `AVITO_CLIENT_ID/SECRET/USER_ID` | developers.avito.ru |
| `REALTYCALENDAR_API_URL/TOKEN/OBJECT_ID` | RealtyCalendar (новые, для US-CHG-6) |
| `DEMO_MODE` | `false` в production, `true` для CI |

## Validation

Перед коммитом:
1. `node tests/e2e_mock.js` — зелёный (регрессия US-OK-1).
2. `node tests/test_notion.js` — зелёный (если трогали `services/notion.js`).
3. Запуск `npm start` стартует без warning'ов о пустых обязательных переменных.
4. Изменённые файлы соответствуют §4 CHANGE_REQUEST («что остаётся как есть» — не задеты).
