# AS_IS.md — Текущее состояние кодовой базы

> **Роль автора:** Senior Software Engineer / Code Archaeologist
> **Метод:** изучение каждого `.js`-файла в `rent-agent/`, сверка с `ARCHITECTURE.md` и `TRACKER.md`, без доверия к документации
> **Дата снимка:** 20 мая 2026

---

## 1. Что система делает сейчас (по факту, не по спеке)

AI-агент — это Express-сервер на Node.js 18+, который принимает три типа вебхуков и обрабатывает их асинхронно.

### Что работает:

1. **Принимает бронь от RealtyCalendar** (`POST /webhook/realtycalendar`)
   - Парсит JSON с полями `booking_id`, `date_from`, `date_to`, `guest.{name,phone}`, `property.{title,avito_item_id}`, `booking_origin.title`, `total_price`
   - Создаёт запись в базе Notion «Брони» с дедупликацией по `ID Брони`
   - Если у объекта есть `avito_item_id` — блокирует даты в календаре Авито через STR API
   - Отправляет HTML-уведомление владельцу в Telegram
   - Игнорирует все события кроме `action === 'create_booking'`

2. **Отвечает гостям в Telegram** (`POST /webhook/telegram`)
   - Достаёт `chat_id` и текст сообщения из апдейта
   - Ищет бронь гостя в Notion по полю `Telegram chat_id`
   - Если бронь найдена — подставляет данные в контекст LLM (имя, квартира, даты, сумма)
   - Если бронь не найдена — отвечает в режиме «первичной консультации» **и** уведомляет владельца «⚠️ Неизвестный гость»
   - Генерирует ответ через OpenRouter LLM от лица персонажа «Анна»
   - Отправляет ответ гостю
   - При ошибке LLM возвращает заранее заготовленный fallback: «Анна сейчас недоступна — отвечу вам в течение часа 😊»

3. **Отвечает в чатах Авито** (`POST /webhook/avito`)
   - Принимает события только `payload.type === 'message'`
   - Игнорирует собственные сообщения (`author_id === AVITO_USER_ID`)
   - Получает OAuth2-токен (с in-memory кешем, обновляется за 60 сек до истечения)
   - Генерирует ответ через LLM (контекст всегда пустой — Notion-поиска по Авито нет)
   - Отправляет ответ через Messenger API Авито

4. **Демо-режим Авито**
   - Если `DEMO_MODE=true` или не заданы `AVITO_CLIENT_ID/SECRET` — токен и запросы только логируются, реальных HTTP-вызовов нет
   - Позволяет прогонять e2e-тесты без реальных Авито-ключей

5. **Логирует все входящие запросы**
   - Middleware `requestLogger` пишет `[timestamp] METHOD path status — Xms (ip)` для каждого запроса

6. **Health-check**
   - `GET /health` → `{ status: 'ok', uptime: <секунды> }`

### Что НЕ делает (но в `SPECIFICATION.md` или `.env.example` упоминается):

- **Не проверяет подпись вебхуков RealtyCalendar** — переменная `REALTYCALENDAR_WEBHOOK_SECRET` есть в `.env.example`, но в коде роута не используется. **ТРЕБУЕТ УТОЧНЕНИЯ:** планировалось или забыли?
- **Не верифицирует Telegram-вебхуки** через `X-Telegram-Bot-Api-Secret-Token`
- **Не верифицирует Авито-вебхуки**
- **Не вызывает `updateBookingStatus`** нигде кроме теста — функция экспортируется, но не используется в production-pipeline (см. §5)
- **Не ищет бронь по Авито `chat_id`** — в `routes/avito.js` контекст для LLM всегда пустой `{}`, хотя в Notion поле «Авито chat_id» есть и заполняется
- **Не отправляет автоответы в Telegram для гостя с найденной бронью** в момент создания брони — только владельцу. Гость в TG узнаёт о брони только когда сам напишет боту

---

## 2. Архитектурная карта

### Реальные файлы (что есть на диске):

```
rent-agent/
├── index.js                          ← точка входа Express
├── package.json                      ← @notionhq/client, axios, dotenv, express, node-telegram-bot-api
├── .env.example                      ← шаблон переменных
├── src/
│   ├── routes/
│   │   ├── telegram.js               ← POST /webhook/telegram
│   │   ├── realtycalendar.js         ← POST /webhook/realtycalendar
│   │   └── avito.js                  ← POST /webhook/avito
│   ├── services/
│   │   ├── notion.js                 ← createBooking, findBookingByChatId, updateBookingStatus
│   │   ├── llm.js                    ← generateReply, buildSystemPrompt
│   │   ├── telegram.js               ← sendMessage, notifyOwner, formatBookingNotification
│   │   └── avito.js                  ← getToken, blockDates, sendMessage (+ isDemoMode, userId)
│   ├── middleware/
│   │   └── logger.js                 ← requestLogger
│   └── utils/
│       └── formatDate.js             ← formatDate, formatDateRange
└── tests/
    ├── diagnose_notion.js            ← диагностика подключения + проверка схемы базы
    ├── diagnose_telegram.js          ← диагностика бота через чистый axios
    ├── test_notion.js                ← 5 smoke-тестов (create / dedup / find / update / not-found)
    ├── test_llm.js                   ← 5 тестов (buildSystemPrompt × 2, generateReply × 2, fallback)
    ├── test_telegram.js              ← 3 теста (getMe, format, реальная отправка владельцу)
    └── e2e_mock.js                   ← 5 тестов: 3 happy-path вебхука + 2 edge-case
```

### Граф зависимостей (по `require`):

```
index.js
├─ middleware/logger
├─ routes/telegram     ── services/{notion, llm, telegram}
├─ routes/realtycalendar ── services/{notion, avito, telegram}
└─ routes/avito        ── services/{avito, llm}

services/telegram      ── utils/formatDate
services/notion        ── @notionhq/client
services/llm           ── axios
services/avito         ── axios
```

**Принцип «сервисы не зависят друг от друга» соблюдён** — каждый сервис требует только npm-пакеты + (в случае telegram) utils. Оркестрация — только в роутах.

### Точки входа HTTP (полный список):

| Метод | Путь | Обработчик | Сразу отвечает 200? |
|-------|------|-----------|---------------------|
| `GET` | `/health` | inline в `index.js` | да |
| `POST` | `/webhook/telegram` | `routes/telegram.js` | да (fire-and-forget) |
| `POST` | `/webhook/realtycalendar` | `routes/realtycalendar.js` | да |
| `POST` | `/webhook/avito` | `routes/avito.js` | да |

Все вебхуки соблюдают паттерн «200 OK сразу → тяжёлая обработка асинхронно».

---

## 3. Внешние интеграции

### 3.1 Notion API (`@notionhq/client`)

**Что используется:**
- `notion.databases.query` — поиск по `ID Брони` (дедупликация) и по `Telegram chat_id` (поиск гостя)
- `notion.pages.create` — создание брони
- `notion.pages.update` — обновление статуса (НЕ вызывается в production-pipeline)
- `notion.users.me` — только в `diagnose_notion.js`
- `notion.databases.retrieve` — только в `diagnose_notion.js`

**Передаваемые данные:** см. §4

**Конфиг:** `NOTION_TOKEN`, `NOTION_DATABASE_ID`

### 3.2 OpenRouter (LLM, через axios)

**Endpoint:** `POST https://openrouter.ai/api/v1/chat/completions`

**Передаётся:**
```json
{
  "model": "openai/gpt-4o-mini",
  "messages": [
    { "role": "system", "content": "<промпт Анны + контекст брони>" },
    { "role": "user",   "content": "<текст гостя>" }
  ],
  "max_tokens": 300,
  "temperature": 0.7
}
```

**Заголовки:** `Authorization: Bearer <key>`, `HTTP-Referer`, `X-Title`

**Таймаут:** 30 секунд. При 429/5xx/таймауте — возвращается заготовленный fallback-текст.

**Конфиг:** `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (по умолчанию `openai/gpt-4o-mini`), `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME`

### 3.3 Telegram Bot API (`node-telegram-bot-api`)

**Что используется:** только `bot.sendMessage(chatId, text, { parse_mode: 'HTML' })` и `bot.getMe()` (в тесте)

**Режим:** `polling: false` — бот только принимает вебхуки и отправляет ответы

**Конфиг:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID`

**Странность:** для отправки одного метода `sendMessage` подключена тяжёлая библиотека `node-telegram-bot-api`. В диагностическом скрипте `diagnose_telegram.js` тот же самый вызов уже сделан на чистом axios — то есть зависимость избыточна. См. §5.

### 3.4 Авито STR API + Messenger (через axios)

**Endpoints:**
- `POST https://api.avito.ru/token` — OAuth2 Client Credentials
- `POST /core/v1/accounts/{userId}/items/{itemId}/bookings` — блок дат
- `POST /messenger/v1/accounts/{userId}/chats/{chatId}/messages` — отправка сообщения

**Передаётся:**
- При блоке дат: `{ date_from, date_to }`
- При отправке: `{ message: { text }, type: 'text' }`

**Таймаут:** 15 секунд

**Конфиг:** `AVITO_CLIENT_ID`, `AVITO_CLIENT_SECRET`, `AVITO_USER_ID`, `DEMO_MODE`

### 3.5 RealtyCalendar

**Direction:** только входящий вебхук (мы не дёргаем их API)

**Ожидаемый формат payload:**
```json
{
  "action": "create_booking",
  "booking_id": "...",
  "date_from": "YYYY-MM-DD",
  "date_to":   "YYYY-MM-DD",
  "total_price": 6000,
  "guest":   { "name": "...", "phone": "..." },
  "property": { "title": "...", "avito_item_id": "..." | null },
  "booking_origin": { "title": "Яндекс Аренда" | "ЦИАН" | ... }
}
```

**Конфиг:** `REALTYCALENDAR_WEBHOOK_SECRET` — **заявлен в `.env.example`, в коде НЕ используется**

---

## 4. Структура данных

### 4.1 Notion-база «Брони» — единственное персистентное хранилище

| Поле | Тип Notion | Откуда заполняется | Используется для |
|------|-----------|---------------------|------------------|
| `ID Брони` | `title` | `bookingId` из RealtyCalendar | Дедупликация |
| `Имя клиента` | `rich_text` | `guest.name` | LLM-контекст, уведомление |
| `Телефон` | `phone_number` | `guest.phone` | Уведомление владельцу |
| `Квартира` | `rich_text` | `property.title` | LLM-контекст |
| `Источник` | `select` | `booking_origin.title` | Аналитика, LLM-контекст |
| `Сумма` | `number` | `total_price` | Уведомление |
| `Статус` | `select` | константа `'Подтверждена'` при создании | НЕ обновляется в production |
| `Даты` | `date` (range) | `date_from` / `date_to` | LLM-контекст, сортировка при поиске |
| `Telegram chat_id` | `number` | **НИКОГДА не заполняется автоматически** ⚠️ | Поиск брони в Telegram-роуте |
| `Авито item_id` | `rich_text` | `property.avito_item_id` | Блокировка дат на Авито |
| `Авито chat_id` | `rich_text` | **НИКОГДА не заполняется автоматически** | Не используется в чтении |
| `Заметки` | `rich_text` | передаётся, но source не указан | — |

**Критическое наблюдение:** `Telegram chat_id` нигде в production-коде не записывается. Поиск `findBookingByChatId` всегда вернёт `null`, если поле не заполнено вручную в Notion. Это означает, что Telegram-pipeline **в текущем виде не работает с реальными гостями** — каждый гость будет распознан как «незнакомый». **ТРЕБУЕТ УТОЧНЕНИЯ:** ожидается ли ручное заполнение этого поля владельцем после телефонного разговора, или это незакрытая задача?

### 4.2 In-memory кеш

| Что | Где | TTL | Что произойдёт при рестарте |
|-----|-----|-----|------------------------------|
| OAuth2 токен Авито | `services/avito.js` → `_tokenCache` | `expires_in` минус 60 сек | Кеш обнулится, при первом запросе будет новый OAuth-call |

### 4.3 Файловое хранилище

Нет. Логи пишутся в stdout (`console.log`).

### 4.4 База данных

Нет. Notion — единственное хранилище.

---

## 5. Технический долг и странные места

### 5.1 КРИТИЧЕСКИЕ — могут сломать запуск

**🔴 `.env` лежит в корне репозитория, а код в `rent-agent/`**

После реорганизации структуры (см. `git log`) `.env` остался в `AI-rent-agent/.env`, но `dotenv.config()` в `rent-agent/index.js` ищет файл в `process.cwd()`. Поведение зависит от того, откуда запускается процесс:

| Команда запуска | Загрузится `.env`? |
|------------------|--------------------|
| `cd rent-agent && node index.js` | ❌ нет (ищет в `rent-agent/.env` — пусто) |
| `node rent-agent/index.js` из корня | ✅ да (найдёт корневой `.env`) |
| `npm start` (cwd = rent-agent) | ❌ нет |

**Рекомендация:** перенести `.env` в `rent-agent/.env` или использовать `dotenv.config({ path: '../.env' })`.

**🔴 `Telegram chat_id` нигде не пишется в Notion**

См. §4.1. Telegram-pipeline без ручного заполнения этого поля никогда не найдёт бронь.

### 5.2 МЁРТВЫЙ КОД И ПОЛОВИНЧАТЫЕ ФИЧИ

**`updateBookingStatus` не вызывается в production**
- Экспортируется из `services/notion.js`
- Используется только в `tests/test_notion.js`
- В `SPECIFICATION.md` упоминается переход статусов («Подтверждена» → «Заехал» → «Завершена»), но триггеров для этих переходов в коде нет

**Поле «Заметки» (`notes`) в Notion**
- `buildNotionProperties` поддерживает `data.notes`
- В production-pipeline (`routes/realtycalendar.js`) поле никогда не передаётся
- Только `tests/test_notion.js` создаёт запись с notes

**Поле «Авито chat_id» в Notion**
- `buildNotionProperties` его пишет, если передан `avitoChatId`
- В `routes/avito.js` ничего не пишет в Notion — поле не заполняется
- Возможно, задумывалось для связки Авито-чата с бронью

**Авито-роут не использует контекст из Notion**
- При сообщении в Авито-чат LLM получает пустой контекст `{}`
- В Notion есть поле «Авито chat_id», но поиск по нему не реализован

### 5.3 ИЗБЫТОЧНЫЕ ЗАВИСИМОСТИ

**`node-telegram-bot-api` подключена ради одного метода**
- Используется только `bot.sendMessage` и `bot.getMe`
- Тот же `diagnose_telegram.js` делает sendMessage чистым axios в 5 строк
- Библиотека тянет много кода и зависимостей ради удобства, которое не используется

### 5.4 БЕЗОПАСНОСТЬ — пропущенные проверки

**Нет верификации входящих вебхуков:**
- `REALTYCALENDAR_WEBHOOK_SECRET` объявлен в `.env.example` и упомянут в `ARCHITECTURE.md` §6, но в коде роута нет ни строчки проверки подписи
- Для Telegram не проверяется `X-Telegram-Bot-Api-Secret-Token`
- Для Авито не проверяется источник

Любой, кто узнает URL вебхука, может отправить произвольный JSON и:
- Создать фейковую бронь в Notion (которая отправит push-уведомление владельцу)
- Дёрнуть LLM (сжечь токены OpenRouter)

### 5.5 РАССИНХРОН ДОКУМЕНТАЦИИ И КОДА

| Документ | Заявлено | Факт |
|----------|----------|------|
| `TRACKER.md` Шаг 7 | `[backlog]` middleware + utils | ✅ файлы реализованы и работают |
| `TRACKER.md` Шаг 9 | `[backlog]` README + QA | ❌ README — заглушка с «будет дополнен в Шаге 9» |
| `ARCHITECTURE.md` §2 | `rental-ai-agent/` как корень | По факту корень `rent-agent/` |
| `ARCHITECTURE.md` §6 | `REALTYCALENDAR_WEBHOOK_SECRET` подключён к роуту | Не подключён |

### 5.6 МИНОРНЫЕ СТРАННОСТИ

**`services/telegram.js` экспортирует сам объект `bot`**
```javascript
module.exports = { bot, ownerChatId, sendMessage, ... };
```
Тесты пользуются `bot` напрямую (`bot.getMe()`). Это нарушает изоляцию — внешний код может вызвать на боте что угодно, минуя обёртки.

**`services/avito.js` экспортирует `userId`**
```javascript
module.exports = { ..., userId: AVITO_USER_ID };
```
`routes/realtycalendar.js` использует `avito.userId`, но мог бы читать `process.env.AVITO_USER_ID` напрямую (как это делает `routes/avito.js`). Несогласованность стилей.

**Маппинг `total_price` через два преобразования**
```javascript
typeof body.total_price === 'number' ? body.total_price : Number(body.total_price) || 0
```
Тернарка избыточна — `Number(x) || 0` отработает корректно для числа тоже. Но не баг.

**Глобальный catch-all error handler в `index.js`** обрабатывает только синхронные ошибки middleware. Все вебхуки делают `res.sendStatus(200)` ДО основной работы, поэтому ошибки внутри `(async () => {...})()` уходят в `console.error` и нигде не агрегируются.

---

## 6. Точки расширения (где безопасно добавлять)

### Зелёная зона — низкий риск

**Добавить новый webhook**
- Создать `src/routes/<source>.js` по образцу существующих
- Зарегистрировать в `index.js` (1 строка)
- Не трогает существующие сервисы

**Расширить LLM-контекст**
- Добавить поля в объект `context` в `routes/telegram.js`
- Добавить ветку в `buildSystemPrompt` в `services/llm.js`
- Не ломает существующий поведение (новые поля — опциональны)

**Добавить новый метод в Notion-сервис**
- `services/notion.js` уже инкапсулирует `buildNotionProperties` и `parseNotionPage`
- Новый метод (`updateBookingNotes`, `findByPhone`, ...) добавляется без изменения существующих

**Добавить новые тесты**
- Папка `tests/` свободна, имена `test_*.js` и `diagnose_*.js` — конвенция
- Каждый тест — самостоятельный скрипт без фреймворка

### Жёлтая зона — требует осторожности

**Добавить запись `Telegram chat_id` в Notion**
- Самое нужное изменение для работающего Telegram-pipeline
- Затрагивает `routes/telegram.js`: при первом сообщении гостя — пытаться сматчить по телефону/имени или создать черновик брони
- Решение требует продуктового выбора (см. ТРЕБУЕТ УТОЧНЕНИЯ ниже)

**Добавить верификацию подписи вебхуков**
- Можно сделать через Express middleware
- Затрагивает все три роута
- Нужно знать алгоритм подписи каждой системы (HMAC SHA-256 обычно)

**Перенести `_tokenCache` в Redis/файл**
- Текущая реализация теряется при рестарте — для одного инстанса терпимо
- Для нескольких инстансов (горизонтальное масштабирование) обязательно

### Красная зона — много связанного кода

**Сменить хранилище с Notion на SQL**
- Сервис `notion.js` придётся переписать целиком
- `buildNotionProperties` / `parseNotionPage` слепляют формат API Notion в коде сервиса — нет промежуточного DTO
- Тесты завязаны на конкретные имена полей Notion

**Изменить структуру `BookingData`**
- Имена полей размазаны по: `routes/realtycalendar.js` (маппинг), `services/notion.js` (запись/чтение), `services/telegram.js` (форматирование), `services/llm.js` (контекст), `tests/*`
- Переименование поля = правка ≥5 файлов

---

## ТРЕБУЕТ УТОЧНЕНИЯ (продуктовые вопросы)

1. **Telegram chat_id**: должен ли заполняться автоматически при первом сообщении? Если да — как сматчить гостя с существующей бронью (по номеру? по имени? через ввод кода брони)?
2. **RealtyCalendar webhook secret**: реально ли RealtyCalendar шлёт подпись и просто забыли проверить, или это «на будущее»?
3. **Авито → Notion связка**: должен ли агент создавать черновик брони в Notion при первом контакте в Авито-чате?
4. **Статусы броней**: кто и когда переводит «Подтверждена» → «Заехал» → «Завершена»? Это ручная работа владельца в Notion или нужна автоматизация?
5. **`updateBookingStatus`**: эта функция оставлена «на будущее» или планировалась интеграция (например, кнопки в Telegram у владельца)?

---

## Сводка одной строкой

Система работает на счастливом пути всех трёх вебхуков, но **Telegram-pipeline в production бесполезен без ручного заполнения `Telegram chat_id` в Notion**, плюс есть критическая ловушка с расположением `.env` после недавней реорганизации репозитория.
