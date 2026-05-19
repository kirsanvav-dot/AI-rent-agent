# TRACKER.md — Трекер задач разработки

> Каждый шаг атомарный и изолированный. Выполняй по одному шагу за сессию.  
> После завершения шага меняй статус: `[backlog]` → `[in-progress]` → `[done]`.  
> Перед началом каждого шага добавляй в контекст Cursor файлы из колонки «Контекст».

---

## Статусы

- `[done]` — выполнено и проверено
- `[in-progress]` — в работе прямо сейчас
- `[backlog]` — ещё не начато
- `[blocked]` — заблокировано внешней причиной

---

## Шаг 0 — Scaffold проекта `[done]`

**Цель:** Базовая структура файлов, зависимости, Express с health-check.

**Что сделано:**
- [x] `package.json` с зависимостями
- [x] `.env.example` и `.gitignore`
- [x] `index.js` — Express + JSON parsing + `/health` эндпоинт
- [x] Заглушки `src/services/{notion,llm,telegram,avito}.js`
- [x] `npm install` выполнен успешно
- [x] `SPECIFICATION.md` написан
- [x] `ARCHITECTURE.md` написан

**Проверка:** `node index.js` → `GET /health` возвращает `{ status: "ok" }`

---

## Шаг 1 — Структура папок `[done]`

**Цель:** Создать все папки и пустые файлы согласно `ARCHITECTURE.md`.

**Что сделано:**
- [x] `src/routes/telegram.js`
- [x] `src/routes/realtycalendar.js`
- [x] `src/routes/avito.js`
- [x] `src/middleware/logger.js`
- [x] `src/utils/formatDate.js`
- [x] `tests/test_notion.js`
- [x] `tests/test_llm.js`
- [x] `tests/e2e_mock.js`
- [x] `README.md`

---

## Шаг 2 — Интеграция Notion (CRM) `[done]`

**Цель:** Агент умеет создавать брони в Notion и искать их по Telegram chat_id.

**Контекст для Cursor:** `@ARCHITECTURE.md` `@SPECIFICATION.md` `src/services/notion.js`

**Задачи:**
- [x] Реализовать `createBooking(data)` — создание записи в базе «Брони»
- [x] Реализовать `findBookingByChatId(chatId)` — поиск по полю «Telegram chat_id»
- [x] Реализовать `updateBookingStatus(pageId, status)` — смена статуса брони
- [x] Добавить проверку дубликатов перед `createBooking` (дедупликация по `bookingId`)
- [x] Написать тест `tests/test_notion.js` (5 тестовых сценариев)

**Проверка:** `node tests/test_notion.js` → запись появляется в Notion базе

---

## Шаг 3 — OpenRouter LLM (мозг агента) `[done]`

**Цель:** Агент умеет генерировать ответы от лица «Анны» с учётом контекста брони.

**Контекст для Cursor:** `@ARCHITECTURE.md` `@SPECIFICATION.md` `src/services/llm.js`

**Задачи:**
- [x] Реализовать `generateReply(userMessage, context)` через `axios` → OpenRouter API
- [x] Системный промпт «Анна» с подстановкой данных из `context`
- [x] Передавать заголовки `HTTP-Referer` и `X-Title`
- [x] Обработка ошибок: таймаут, 429 (rate limit), 5xx → fallback-сообщение
- [x] Написать тест `tests/test_llm.js` (5 сценариев)

**Проверка:** `node tests/test_llm.js` → консоль выводит ответ «Анны»

---

## Шаг 4 — Telegram-сервис и вебхук `[done]`

**Цель:** Агент принимает сообщения от гостей в Telegram и отвечает через LLM.

**Задачи:**
- [x] Реализовать `sendMessage(chatId, text)` в `src/services/telegram.js`
- [x] Реализовать `notifyOwner(html)` — HTML-уведомление владельцу
- [x] Реализовать `formatBookingNotification(booking)` — форматирование уведомления о брони
- [x] Реализовать роут `src/routes/telegram.js` (POST /webhook/telegram): fire-and-forget pipeline
- [x] Написать тест `tests/test_telegram.js`

**Проверка:** `node tests/test_telegram.js` → в Telegram владельца приходит тестовое сообщение

---

## Шаг 5 — RealtyCalendar вебхук `[done]`

**Цель:** Бронь с Яндекс Путешествий или ЦИАН автоматически попадает в Notion и блокирует Авито.

**Задачи:**
- [x] Маппинг полей входящего JSON → `BookingData`
- [x] Pipeline: `notion.createBooking` → `avito.blockDates` (если есть `avito_item_id`) → `telegram.notifyOwner`
- [x] Каждый шаг в отдельном `try/catch` — ошибка одного не останавливает остальные
- [x] Ответ `200 OK` до начала обработки

---

## Шаг 6 — Авито STR API `[done]`

**Цель:** Агент умеет блокировать даты и отвечать в чатах Авито.

**Задачи:**
- [x] `getToken()` — OAuth2 Client Credentials с кешированием токена в памяти (обновляется за 60 сек до истечения)
- [x] `blockDates(token, userId, itemId, dateFrom, dateTo)`
- [x] `sendMessage(token, userId, chatId, text)`
- [x] Роут `/webhook/avito`: фильтр по типу и автору, pipeline `getToken → llm.generateReply → sendMessage`
- [x] Ответ `200 OK` до начала обработки

---

## Шаг 7 — Middleware и утилиты `[backlog]`

**Цель:** Логирование запросов и вспомогательные функции форматирования.

**Контекст для Cursor:** `@ARCHITECTURE.md` `src/middleware/logger.js` `src/utils/formatDate.js` `index.js`

**Задачи:**
- [ ] Реализовать `src/middleware/logger.js` — логирование метода, пути, статуса, времени ответа
- [ ] Реализовать `src/utils/formatDate.js` — ISO date → «20 июня 2026»
- [ ] Подключить middleware в `index.js` (до роутов)
- [ ] Заменить прямые строковые даты в сервисах на `formatDate()`

**Промпт для Cursor:**
> "Мы выполняем Шаг 7 из TRACKER.md.  
> 1. Напиши `src/middleware/logger.js` — Express-middleware: логирует метод, путь, IP, время ответа в мс.  
> 2. Напиши `src/utils/formatDate.js` — функция `formatDate(isoString)` → строка вида '20 июня 2026'.  
> Подключи middleware в index.js перед роутами."

---

## Шаг 8 — E2E-тесты (моки) `[done]`

**Цель:** Проверить весь pipeline без реальных внешних сервисов.

**Задачи:**
- [x] Мок POST `/webhook/realtycalendar` → Notion + Telegram
- [x] Мок POST `/webhook/telegram` → LLM + Telegram (незнакомый гость)
- [x] Мок POST `/webhook/avito` → LLM + Авито Messenger
- [x] Граничные случаи: собственное сообщение Авито, неизвестный action

**Проверка:** Все 5 тестов прошли. Запись появилась в Notion, уведомление пришло в Telegram.

---

## Шаг 9 — QA-ревью и README `[backlog]`

**Цель:** Финальная проверка кода, инструкция по запуску и деплою.

**Контекст для Cursor:** `@TRACKER.md` `@index.js` папка `@src/` папка `@tests/`

**Задачи:**
- [ ] Проверить: каждый async-вызов обёрнут в try/catch
- [ ] Проверить: нет хардкоженных токенов или URL
- [ ] Проверить: все вебхуки отвечают 200 OK до тяжёлой обработки
- [ ] Написать `README.md`:
  - Быстрый старт (clone → npm install → настройка .env → запуск)
  - Регистрация вебхука Telegram (команда curl)
  - Локальный тест через ngrok
  - Деплой на Railway / Render
  - Описание всех эндпоинтов

**Промпт для Cursor:**
> "Мы выполняем Шаг 9 из TRACKER.md. Выступи в роли QA Engineer + Technical Writer.  
> 1. Проверь весь код: try/catch, отсутствие токенов, fire-and-forget для вебхуков.  
> 2. Напиши `README.md`: быстрый старт, ngrok, деплой на Railway, таблица эндпоинтов."

---

## Сводка прогресса

| Шаг | Название | Статус |
|-----|----------|--------|
| 0 | Scaffold проекта | `[done]` |
| 1 | Структура папок | `[done]` |
| 2 | Интеграция Notion | `[done]` |
| 3 | OpenRouter LLM | `[done]` |
| 4 | Telegram сервис и вебхук | `[done]` |
| 5 | RealtyCalendar вебхук | `[done]` |
| 6 | Авито STR API | `[done]` |
| 7 | Middleware и утилиты | `[backlog]` |
| 8 | E2E-тесты (моки) | `[done]` |
| 9 | QA-ревью и README | `[backlog]` |
