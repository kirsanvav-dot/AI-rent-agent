# CHANGE_REQUEST.md — Сравнительный анализ AS_IS → TO-BE

> **Роль:** Systems Analyst  
> **Версия:** 1.0  
> **Дата:** 23 мая 2026  
> **Основание:** `AS_IS.md` (снимок 20.05.2026) · `SPECIFICATION.md` v2.1 · `GAP_ANALYSIS.md` (22.05.2026)  
> **Скоуп:** изменения, принятые к реализации. Бэклог (DEFER) — не входит.

---

## 1. Что добавляется

### 1.1 Инфраструктура и конфигурация

#### CR-ADD-01 — Явный путь к `.env` при старте
> **Источник:** GAP-001 (BLOCKING)

- В `index.js`: `require('dotenv').config()` → `require('dotenv').config({ path: require('path').resolve(__dirname, '.env') })`.
- Файл `rent-agent/.env` создаётся на основе `rent-agent/.env.example` (перемещение из корня репозитория `AI-rent-agent/.env`).
- При `NODE_ENV=production` и `DEMO_MODE=true` — `console.warn('[index] ⚠️ DEMO_MODE=true в production!')`.
- При `NODE_ENV=production` и отсутствии обязательных Авито-ключей — агент завершается с ошибкой конфигурации (не уходит в demo-молчание).

#### CR-ADD-02 — Новые переменные окружения для исходящего RC API
> **Источник:** SPEC FR-15, новое (вне GAP)

Добавляются в `rent-agent/.env.example`:

| Переменная | Назначение |
|------------|-----------|
| `REALTYCALENDAR_API_URL` | Base URL исходящего API RealtyCalendar |
| `REALTYCALENDAR_API_TOKEN` | Bearer-токен для исходящих запросов |
| `REALTYCALENDAR_OBJECT_ID` | ID объекта аренды в RC (для одной квартиры) |

---

### 1.2 Telegram: идентификация гостя

#### CR-ADD-03 — Матчинг гостя по коду брони
> **Источник:** GAP-002 (BLOCKING), решение продакта → вариант A (код брони)

В `routes/telegram.js`, ветка «бронь не найдена»: если текст сообщения совпадает с полем `ID Брони` любой записи в Notion (регистронезависимо, нормализация пробелов) — бронь считается найденной, `Telegram chat_id` записывается в Notion.

**Новый метод в `services/notion.js`:** `findBookingByBookingId(bookingId)`.

#### CR-ADD-04 — Матчинг гостя по контакту Telegram
> **Источник:** GAP-002 (BLOCKING), решение продакта → вариант B (телефон через contact)

В `routes/telegram.js`: новая ветка обработки `update.message.contact`. При получении контакта — поиск брони по телефону с нормализацией (только цифры, замена ведущей `8` → `7`, сравнение 10 последних цифр).

**Новые методы в `services/notion.js`:** `findBookingByPhone(phone)`.

#### CR-ADD-05 — Запись `Telegram chat_id` в Notion при успешной привязке
> **Источник:** GAP-002 (BLOCKING)

После успешного матчинга (CR-ADD-03 или CR-ADD-04) агент сохраняет `chat_id` гостя в карточку Notion.

**Новый метод в `services/notion.js`:** `updateBookingFields(pageId, fields)` — обновляет произвольный набор полей (используется и для CR-ADD-05, и для CR-ADD-12, и для CR-ADD-16).

---

### 1.3 Telegram: кнопки управления для владельца

#### CR-ADD-06 — Inline-клавиатура в уведомлениях владельцу
> **Источник:** GAP-004 (BLOCKING, решение → кнопки в Telegram)

Уведомление о новой брони теперь содержит inline-кнопки смены статуса. Структура `callback_data`:

| Кнопка | callback_data | Назначение |
|--------|--------------|------------|
| ✅ Подтверждена | `status_confirmed:{pageId}` | Смена статуса |
| 🏠 Заехал | `status_checkedin:{pageId}` | Смена статуса |
| 🎉 Завершена | `status_completed:{pageId}` | Смена статуса |
| ❌ Отменена | `status_cancelled:{pageId}` | Смена статуса |
| 🔒 Подтвердить бронь | `confirm_booking:{pageId}` | Триггер синхронизации с RC (только для Авито-лидов) |

**Новые функции в `services/telegram.js`:**
- `sendMessageWithKeyboard(chatId, text, inlineKeyboard)`
- `notifyOwnerWithActions(html, inlineKeyboard)`
- `answerCallbackQuery(callbackQueryId, text)`

#### CR-ADD-07 — Обработчик callback_query в routes/telegram.js
> **Источник:** GAP-004 (BLOCKING)

Новая ветка `update.callback_query` в `routes/telegram.js`:
1. Проверка, что `from.id === TELEGRAM_OWNER_CHAT_ID` — иначе `answerCallbackQuery("Нет доступа")`.
2. Парсинг `action` и `pageId` из `callback_data`.
3. Для `status_*` → валидация допустимого перехода → `notion.updateBookingStatus(pageId, status)` → `answerCallbackQuery`.
4. Для `confirm_booking` → пайплайн синхронизации с RC (см. CR-ADD-14).

**Допустимые переходы статусов (таблица):**

| Из \ В | Подтверждена | Заехал | Завершена | Отменена |
|--------|-------------|--------|-----------|----------|
| Ожидает подтверждения | ✅ | — | — | ✅ |
| Подтверждена | — | ✅ | — | ✅ |
| Заехал | — | — | ✅ | ✅ |
| Завершена | — | — | — | — |
| Отменена | — | — | — | — |

Нарушение перехода: `console.error` + `answerCallbackQuery` с текстом ошибки.

---

### 1.4 Авито: реальная интеграция и CRM

#### CR-ADD-08 — Поиск лида по Авито chat_id в Notion
> **Источник:** GAP-006 (BLOCKING), GAP-007 (BLOCKING)

В `routes/avito.js` перед вызовом LLM — поиск записи в Notion.

**Новый метод в `services/notion.js`:** `findBookingByAvitoChatId(chatId)`.

#### CR-ADD-09 — Создание черновой брони при первом сообщении в Авито
> **Источник:** GAP-006 (BLOCKING), решение продакта — создавать черновик/лид

Если запись не найдена, `routes/avito.js` создаёт черновую бронь:

| Поле | Значение |
|------|---------|
| `ID Брони` | `AVITO-{chatId}` (стабильный ID для дедупликации) |
| `Источник` | `Авито` |
| `Статус` | `Ожидает подтверждения` |
| `Авито chat_id` | ID чата из payload |
| `Авито item_id` | ID объявления (если есть в payload) |
| `Имя клиента` / `Телефон` | из payload если доступно, иначе пусто |

Дедупликация: повторные вызовы с тем же `chatId` возвращают существующую запись (существующий `createBooking` дедуплицирует по `ID Брони`).

#### CR-ADD-10 — Контекст из Notion для LLM в Авито-роуте
> **Источник:** GAP-007 (BLOCKING)

`llm.generateReply(text, {})` → `llm.generateReply(text, context)`, где `context` заполняется из найденной/созданной записи Notion.

Объект `context` дополняется полем `status` (для черновиков Анна знает, что гость ещё не забронировал).

#### CR-ADD-11 — Регистрация Webhook URL в кабинете Авито
> **Источник:** SPEC FR-18, GAP-006

Одноразовое инфраструктурное действие: `POST <PUBLIC_URL>/webhook/avito` прописывается в личном кабинете/API Авито для получения событий Messenger. Документируется в `README.md` (runbook). Не является кодом агента — является обязательным условием работы канала.

---

### 1.5 Двунаправленная синхронизация календарей

#### CR-ADD-12 — Новый сервис `services/realtycalendar.js`
> **Источник:** SPEC FR-15, новое (вне GAP)

Новый файл. Экспортирует один метод:

`blockDates({ objectId, dateFrom, dateTo, externalRef })` → POST в API RealtyCalendar для блокировки дат; возвращает `{ rcBookingId }`.

Логирование по конвенции: `[realtycalendar] blockDates: objectId=... ${dateFrom}→${dateTo}`.

#### CR-ADD-13 — Поле `Синхронизировано с RC` в схеме Notion
> **Источник:** SPEC FR-17, новое (вне GAP)

Новое поле типа **checkbox** в базе «Брони» в Notion:
- `false` по умолчанию для всех записей (старых и новых).
- Устанавливается в `true` после успешного вызова RC API.
- Используется для идемпотентности: повторное нажатие кнопки `Подтвердить бронь` не создаёт второй блок в RC.

#### CR-ADD-14 — Пайплайн подтверждения брони → RC
> **Источник:** SPEC FR-16, US-CHG-6, новое (вне GAP)

В `routes/telegram.js`, ветка `callback_data = confirm_booking:{pageId}`:

1. Загрузить запись Notion по `pageId`.
2. Проверить `source` ∉ `{'Яндекс Аренда', 'ЦИАН'}` — защита от петли (NFR-8).
3. Проверить `rcSynced !== true` — идемпотентность (FR-17).
4. Проверить наличие `dateFrom` и `dateTo`.
5. Вызвать `realtycalendar.blockDates(...)`.
6. Вызвать `notion.updateBookingFields(pageId, { status: 'Подтверждена', rcSynced: true })`.
7. `answerCallbackQuery("Даты заблокированы в ЦИАН и Яндексе ✓")` + `notifyOwner`.

При ошибке RC API: поле `rcSynced` остаётся `false`, владельцу — алерт, повтор безопасен.

---

### 1.6 Новые значения в схеме Notion

#### CR-ADD-15 — Новые опции select-поля `Статус`
> **Источник:** SPEC §5.3

Добавить в Notion select-поле `Статус`:
- `Ожидает подтверждения` — для черновиков Авито (CR-ADD-09)
- `Заехал` — для управления жизненным циклом (CR-ADD-07)

---

## 2. Что изменяется

### CR-CHG-01 — `index.js`: dotenv с явным путём
> **Источник:** GAP-001 (BLOCKING)

| Было (AS-IS) | Станет (TO-BE) |
|-------------|---------------|
| `require('dotenv').config()` ← ищет `.env` в `cwd` | `require('dotenv').config({ path: require('path').resolve(__dirname, '.env') })` |
| `.env` лежит в корне репозитория `AI-rent-agent/` | `.env` лежит в `rent-agent/` рядом с `index.js` |

Больше ничего в `index.js` не меняется.

---

### CR-CHG-02 — `routes/telegram.js`: три новые ветки обработки

| Ветка | Было (AS-IS) | Станет (TO-BE) |
|-------|-------------|---------------|
| `message.text` — гость не найден | `notifyOwner + консультация` | + попытка матчинга по коду брони → по телефону → если не нашли: консультация + подсказка (CR-ADD-03) |
| `message.contact` | не обрабатывается (early return) | `findBookingByPhone` → `updateBookingFields` → ответ гостю (CR-ADD-04, CR-ADD-05) |
| `callback_query` | не обрабатывается (early return) | обработчик смены статуса и подтверждения брони (CR-ADD-07, CR-ADD-14) |

**Что не меняется:** fire-and-forget паттерн, `res.sendStatus(200)` первым, фильтр `update.message?.text`, путь «бронь найдена → generateReply с контекстом → sendMessage».

---

### CR-CHG-03 — `routes/avito.js`: добавление Notion CRM

| Шаг pipeline | Было (AS-IS) | Станет (TO-BE) |
|--------------|-------------|---------------|
| До LLM | — | `findBookingByAvitoChatId` → `createBooking` (если нет) |
| LLM-вызов | `generateReply(text, {})` | `generateReply(text, context)` с контекстом из Notion |
| После LLM | — | — (sendMessage не меняется) |

**Добавляется зависимость:** `routes/avito.js` → `services/notion.js`.

**Что не меняется:** `res.sendStatus(200)` первым, фильтр `payload.type === 'message'`, фильтр `author_id !== AVITO_USER_ID`, `avito.getToken()`, `avito.sendMessage()`, обработка ошибок.

---

### CR-CHG-04 — `routes/realtycalendar.js`: уведомление с кнопками

| Было (AS-IS) | Станет (TO-BE) |
|-------------|---------------|
| `telegram.notifyOwner(html)` | `telegram.notifyOwnerWithActions(html, statusKeyboard)` |

Кнопки: `Заехал`, `Завершена`, `Отменена` (кнопка `Подтвердить бронь` здесь не добавляется — брони из RC уже подтверждены).

**Это единственное изменение в этом файле.** Весь остальной pipeline — без изменений.

---

### CR-CHG-05 — `services/notion.js`: новые методы и расширение маппинга

**Новые публичные методы** (не меняют существующих):

| Метод | Описание |
|-------|---------|
| `findBookingByBookingId(bookingId)` | Поиск по полю `ID Брони` (title) |
| `findBookingByPhone(phone)` | Поиск по нормализованному `Телефон` |
| `findBookingByAvitoChatId(chatId)` | Поиск по `Авито chat_id` |
| `updateBookingFields(pageId, fields)` | Обновляет произвольный набор полей (chat_id, rcSynced, имя...) |

**`buildNotionProperties`** — добавляется опциональная ветка для `rcSynced`:
```
if (data.rcSynced !== undefined) → props['Синхронизировано с RC'] = { checkbox: Boolean(data.rcSynced) }
```

**`parseNotionPage`** — добавляется одна строка:
```
rcSynced: p['Синхронизировано с RC']?.checkbox ?? false
```

**Что не меняется:** `createBooking`, `findBookingByChatId`, `updateBookingStatus`, `buildNotionProperties` (существующие ветки), `parseNotionPage` (существующие поля), логика дедупликации.

---

### CR-CHG-06 — `services/telegram.js`: три новых функции

Добавляются (не меняют существующих):

| Функция | Описание |
|---------|---------|
| `sendMessageWithKeyboard(chatId, text, inlineKeyboard)` | Отправляет сообщение с inline-кнопками через `bot.sendMessage(..., { reply_markup: { inline_keyboard } })` |
| `notifyOwnerWithActions(html, inlineKeyboard)` | Уведомление владельцу с inline-кнопками |
| `answerCallbackQuery(callbackQueryId, text)` | Подтверждение нажатия кнопки |

**Что не меняется:** `sendMessage`, `notifyOwner`, `formatBookingNotification`, экспорт `bot`, `ownerChatId`.

---

### CR-CHG-07 — `rent-agent/.env.example`: новые переменные

Добавляются три строки для RC API (CR-ADD-02) и уточняется комментарий к `DEMO_MODE`:

| Переменная | До | После |
|------------|----|----|
| `DEMO_MODE` | `# true — для тестов` | `# true — ТОЛЬКО для локальной разработки и CI. В production ВСЕГДА false` |
| `REALTYCALENDAR_API_URL` | нет | добавляется |
| `REALTYCALENDAR_API_TOKEN` | нет | добавляется |
| `REALTYCALENDAR_OBJECT_ID` | нет | добавляется |

---

## 3. Что удаляется

### CR-DEL-01 — ARCHITECTURE.md: устаревшее имя корня `rental-ai-agent/`
> **Источник:** GAP-011 (OBSOLETE)

**Действие:** заменить все вхождения `rental-ai-agent/` → `rent-agent/` в `ARCHITECTURE.md`.  
**Статус:** фактически закрыто — новый `ARCHITECTURE.md` v2.1 написан с правильным именем корня.

---

### CR-DEL-02 — ARCHITECTURE.md: ложное утверждение о `REALTYCALENDAR_WEBHOOK_SECRET`
> **Источник:** GAP-012 (OBSOLETE в текущем скоупе)

Старый `ARCHITECTURE.md` §6 содержал: `REALTYCALENDAR_WEBHOOK_SECRET → routes/realtycalendar.js (верификация подписи, опционально)`. В коде этого нет; верификация — вне скоупа (GAP-003, DEFER).

**Действие:** в новом `ARCHITECTURE.md` v2.1 секрет описан как «зарезервировано для будущей верификации», без ложных утверждений.  
**Статус:** закрыто новым `ARCHITECTURE.md`.

---

### CR-DEL-03 — TRACKER.md: Шаг 7 в статусе `[backlog]`
> **Источник:** GAP-010 (OBSOLETE)

Шаг 7 (middleware + utils) реализован и работает. Статус `[backlog]` вводит в заблуждение.

**Действие:** в `TRACKER.md` Шаг 7 → `[done]`.

---

### CR-DEL-04 — Использование `DEMO_MODE` как основного режима Авито в production
> **Источник:** SPEC NFR-10, US-OK-2 удалён из TO-BE сценариев

AS-IS: при отсутствии ключей `AVITO_CLIENT_ID/SECRET` агент молча уходит в demo-режим в production.  
TO-BE: в `NODE_ENV=production` с неполными ключами — явная ошибка конфигурации.

**Действие:** добавить проверку в `index.js` (CR-ADD-01). Поведение `isDemoMode` в `services/avito.js` **не меняется** — demo остаётся для CI/тестов.

---

### CR-DEL-05 — Пустой `ARCHITECTURE.md` (placeholder)
> **Источник:** файл содержал `_PLACEHOLDER_`

**Действие:** заменён новым `ARCHITECTURE.md` v2.1 (уже выполнено).

---

## 4. Что остаётся как есть

Явный перечень — защита от случайных правок.

### Файлы — полный запрет на изменения в этом релизе

| Файл | Почему не трогаем |
|------|------------------|
| `src/routes/realtycalendar.js` | US-OK-1 работает; единственное допустимое изменение — строка `notifyOwner` → `notifyOwnerWithActions` (CR-CHG-04) |
| `src/services/avito.js` | Контракт `getToken / blockDates / sendMessage / isDemoMode / userId` не меняется |
| `src/services/llm.js` | Контракт `generateReply(text, context)` стабилен; обогащение контекста — в роутах |
| `src/middleware/logger.js` | Работает |
| `src/utils/formatDate.js` | Работает |
| `tests/diagnose_notion.js` | Диагностика |
| `tests/diagnose_telegram.js` | Диагностика |
| `tests/test_notion.js` | Регрессия по существующим методам |
| `tests/test_llm.js` | Регрессия |
| `tests/test_telegram.js` | Регрессия |
| `tests/e2e_mock.js` | DEMO_MODE остаётся для CI |
| `package.json` | Новых зависимостей нет; `axios` уже есть для RC-сервиса |

### Поведение — не меняется

| Поведение | Где реализовано |
|-----------|----------------|
| `res.sendStatus(200)` первым на всех вебхуках | Все роуты |
| Fire-and-forget `(async () => { ... })()` | Все роуты |
| In-memory OAuth2 кеш токена Авито | `services/avito.js` |
| Fallback LLM при ошибке OpenRouter | `services/llm.js` |
| `GET /health` → `{ status: 'ok', uptime }` | `index.js` |
| Дедупликация броней RC по `booking_id` | `services/notion.js`, `createBooking` |
| Блокировка дат на Авито при RC-брони | `routes/realtycalendar.js` |
| Уведомление владельцу при неизвестном госте | `routes/telegram.js` (ветка «не найдено, не совпало») |
| LLM системный промпт «Анна» | `services/llm.js` |
| Паттерн логирования `[module] message: detail` | Все модули |

---

## 5. Анализ влияния (blast radius)

### CR-ADD-01 / CR-CHG-01 — dotenv path

| Модуль | Влияние | Тип |
|--------|---------|-----|
| `index.js` | Прямая правка | Изменение |
| `services/notion.js` | Читает `process.env` на старте — будет подхватывать правильный `.env` | Позитивное исправление |
| `services/avito.js` | То же | Позитивное исправление |
| `services/llm.js` | То же | Позитивное исправление |
| `services/telegram.js` | То же | Позитивное исправление |
| `tests/*` | Тесты запускаются из `rent-agent/` — теперь `.env` будет найден | Позитивное исправление |

**Риск:** если хостинг деплоит из корня репозитория и уже находит `.env` там — после переноса нужно убедиться, что на хостинге тоже обновлён путь. Переменные окружения на Railway/Render задаются через UI, а не через `.env`-файл — риск минимален.

---

### CR-CHG-02 — routes/telegram.js (три новые ветки)

| Модуль | Влияние | Тип |
|--------|---------|-----|
| `services/notion.js` | Вызовы 3 новых методов | Требует CR-CHG-05 |
| `services/telegram.js` | Вызов 3 новых функций | Требует CR-CHG-06 |
| `services/realtycalendar.js` | Вызов `blockDates` из ветки `confirm_booking` | Требует CR-ADD-12 |
| `routes/realtycalendar.js` | Не затрагивается | — |
| `routes/avito.js` | Не затрагивается | — |
| Существующий путь Telegram (`message.text`, бронь найдена) | Не меняется — новый код в `else`-ветках | Нулевой |

**⚠️ Тонкий риск:** формат `callback_data` производится в `services/telegram.js` (новая `notifyOwnerWithActions`) и потребляется в `routes/telegram.js` (новый обработчик `callback_query`). Если форматы разойдутся — кнопки будут игнорироваться без видимой ошибки.

---

### CR-CHG-03 — routes/avito.js (добавление Notion)

| Модуль | Влияние | Тип |
|--------|---------|-----|
| `services/notion.js` | Вызовы `findBookingByAvitoChatId`, `createBooking` | Требует CR-CHG-05 |
| `services/avito.js` | Не затрагивается | — |
| `services/llm.js` | Аргумент `context` теперь не пустой — расширяет промпт | Позитивное |

**⚠️ Новая зависимость:** если Notion API недоступен, Авито-пайплайн частично деградирует (нет записи в CRM), но ответ гостю всё равно отправляется (try/catch защищает). Это допустимо.

---

### CR-CHG-04 — routes/realtycalendar.js (кнопки в уведомлении)

| Модуль | Влияние | Тип |
|--------|---------|-----|
| `services/telegram.js` | Вызов `notifyOwnerWithActions` вместо `notifyOwner` | Требует CR-CHG-06 |
| Весь остальной pipeline RC | Не меняется | Нулевой |

**⚠️ Регрессионный риск:** это единственное изменение в файле, который сейчас работает корректно (US-OK-1). Нужно проверить, что старые тесты `e2e_mock.js` по-прежнему зелёные.

---

### CR-CHG-05 — services/notion.js (новые методы)

| Модуль | Влияние | Тип |
|--------|---------|-----|
| `tests/test_notion.js` | Существующие 5 тестов не затрагиваются | — |
| `routes/telegram.js` | Потребитель новых методов | Требует CR-CHG-02 |
| `routes/avito.js` | Потребитель `findBookingByAvitoChatId` | Требует CR-CHG-03 |
| `parseNotionPage` / `buildNotionProperties` | Расширяются без изменения существующих полей | Безопасно |

---

### CR-ADD-12 — services/realtycalendar.js (новый файл)

| Модуль | Влияние | Тип |
|--------|---------|-----|
| `routes/telegram.js` | Вызов `blockDates` из нового обработчика | Требует CR-CHG-02 |
| Все остальные модули | Не затрагиваются | — |

---

### Матрица влияния (сводная)

| Изменяемый модуль | Влияет на | Затрагивает рабочий код? |
|-------------------|-----------|------------------------|
| `index.js` | Все сервисы (env) | ⚠️ Да, но только позитивно |
| `routes/telegram.js` | notion.js, telegram.js, realtycalendar.js | ⚠️ Да (новые ветки) |
| `routes/avito.js` | notion.js | ⚠️ Да (новая зависимость) |
| `routes/realtycalendar.js` | telegram.js | ⚠️ Да (одна строка) |
| `services/notion.js` | routes/telegram.js, routes/avito.js | Только аддитивно |
| `services/telegram.js` | routes/realtycalendar.js | Только аддитивно |
| `services/realtycalendar.js` (новый) | routes/telegram.js | Новый файл |

---

## 6. Риски и компенсирующие меры

### R-01 — Notion schema не обновлена до деплоя
> **Вероятность:** Высокая (легко забыть) · **Влияние:** Высокое

**Симптом:** `createBooking` с `status='Ожидает подтверждения'` упадёт с ошибкой Notion API (недопустимое значение select). Все Авито-вебхуки начнут давать ошибки в Notion-шаге.

**Компенсация:** выполнить §7 (план миграции) **до** деплоя нового кода. Порядок строгий: сначала Notion, потом код.

---

### R-02 — Регрессия US-OK-1 из-за CR-CHG-04
> **Вероятность:** Низкая · **Влияние:** Высокое (RC-брони перестанут нотифицировать)

**Симптом:** `notifyOwnerWithActions` не работает (ошибка в новой функции) → владелец перестаёт получать уведомления о бронях из Яндекса/ЦИАН.

**Компенсация:** 
1. Функция `notifyOwner` (старая) не удаляется — при ошибке новой можно быстро откатить одну строку.
2. Прогнать `tests/e2e_mock.js` после деплоя.
3. Сделать тестовый RC-вебхук вручную и проверить уведомление.

---

### R-03 — Рассинхрон формата callback_data
> **Вероятность:** Средняя · **Влияние:** Среднее (кнопки не работают, но ничего не ломается)

**Симптом:** нажатие inline-кнопки Telegram не обрабатывается агентом (нет ответа на `callback_query`), пользователь видит «часики».

**Компенсация:** 
1. Формат `callback_data` задокументирован в одном месте (`ARCHITECTURE.md` §3.6).
2. При первом деплое — проверить вручную нажатие каждого типа кнопки.
3. Добавить `console.log('[webhook/telegram] callback_query: action=... pageId=...')` для диагностики.

---

### R-04 — RC API: неизвестный контракт
> **Вероятность:** Высокая · **Влияние:** Высокое (US-CHG-6 не работает)

**Симптом:** `services/realtycalendar.js` отправляет POST, но формат тела, заголовков или endpoint не соответствует документации RC.

**Компенсация:**
1. До написания сервиса — изучить документацию API RealtyCalendar и проверить тестовым вызовом.
2. Реализовать fallback: при ошибке RC API статус брони остаётся `Ожидает подтверждения`, поле `rcSynced` — `false`, кнопка доступна для повтора.
3. Идемпотентность (CR-ADD-13) защищает от двойного блока при повторе.

---

### R-05 — dotenv path на хостинге
> **Вероятность:** Низкая · **Влияние:** Критическое (агент стартует без переменных)

**Симптом:** после деплоя сервисы получают `undefined` вместо токенов и сразу логируют `console.warn`.

**Компенсация:**
1. На Railway/Render переменные окружения задаются через UI платформы — `.env`-файл не используется в production.
2. `require('path').resolve(__dirname, '.env')` даёт абсолютный путь относительно `index.js` — поведение детерминировано.
3. Проверить первый старт по логу: `Rental AI Agent запущен на http://localhost:3000`.

---

### R-06 — Авито webhook не зарегистрирован (FR-18)
> **Вероятность:** Высокая (легко пропустить) · **Влияние:** Высокое (весь Авито-канал не работает)

**Симптом:** сообщения гостей в Авито не доходят до агента; в Notion не создаются черновики.

**Компенсация:**
1. Внести пункт «зарегистрировать Webhook URL в Авито» в чек-лист релиза.
2. Проверить успех: отправить тестовое сообщение в Авито → убедиться, что в логах появляется `[webhook/avito] Новое сообщение`.
3. Документировать инструкцию в `README.md` (runbook).

---

### R-07 — Новая Notion-зависимость в routes/avito.js при недоступности Notion
> **Вероятность:** Низкая · **Влияние:** Частичное (запись в CRM не происходит)

**Симптом:** Notion API недоступен → `findBookingByAvitoChatId` бросает ошибку → try/catch → context = `{}` → Авито-ответ всё равно отправляется.

**Компенсация:** архитектурно приемлемо — try/catch уже в паттерне проекта. Факт: ответ гостю не прерывается; лид в CRM потеряется. Логируется `console.error`.

---

## 7. Стратегия миграции данных

### 7.1 Хранилище

Единственное персистентное хранилище — **Notion**. Реляционная база данных, файлы, кеш не используются. Миграция сводится к изменению схемы Notion-базы «Брони» и перемещению `.env`.

### 7.2 Схема Notion — план миграции

**Обязательно выполнить ДО деплоя нового кода (иначе R-01):**

| Шаг | Действие | Как | Риск отката |
|-----|---------|-----|------------|
| 1 | Открыть базу «Брони» в Notion | Интерфейс Notion | — |
| 2 | Добавить поле `Синхронизировано с RC` типа **Checkbox** | «+ New property» → Checkbox | Безопасно: старые записи получают `false` |
| 3 | В поле `Статус` (Select) добавить опцию `Ожидает подтверждения` | Клик по полю → Edit property → Add option | Безопасно: существующие записи не меняются |
| 4 | В поле `Статус` добавить опцию `Заехал` | То же | Безопасно |
| 5 | Проверить, что у интеграции Notion есть право **Update content** | Settings → Connections → Integration permissions | Без этого `updateBookingFields` будет падать с 403 |
| 6 | Задеплоить новый код | — | — |

**Откат:** если что-то пошло не так, удалить поле `Синхронизировано с RC` и убрать новые опции из `Статус`. Код откатить к предыдущему коммиту.

### 7.3 Совместимость старых записей

| Изменение | Влияние на старые записи |
|-----------|-------------------------|
| Новое поле `Синхронизировано с RC` | Все старые записи автоматически получают `false` — корректно |
| Новые опции `Ожидает подтверждения`, `Заехал` | Старые записи не затрагиваются — их статус не меняется |
| Новые Notion-методы (`findBookingByAvitoChatId` и др.) | Чтение только — существующие записи не изменяются |

**Нет ломающих изменений для существующих данных.**

### 7.4 Миграция `.env`

| Шаг | Действие |
|-----|---------|
| 1 | Скопировать `AI-rent-agent/.env` → `rent-agent/.env` |
| 2 | Добавить в `rent-agent/.env` три новые переменные RC (CR-ADD-02) |
| 3 | Убедиться, что `rent-agent/.env` добавлен в `.gitignore` |
| 4 | Старый `AI-rent-agent/.env` можно удалить или оставить (агент его больше не читает) |

### 7.5 Инфраструктурные шаги (не код, но обязательны)

| Шаг | Ответственный | Когда |
|-----|--------------|-------|
| Зарегистрировать Webhook URL в кабинете Авито (FR-18) | Владелец | До или сразу после деплоя |
| Убедиться `DEMO_MODE=false` в production | Разработчик | При деплое |
| Убедиться в наличии реальных `AVITO_CLIENT_ID/SECRET` | Владелец | До деплоя |
| Подготовить `REALTYCALENDAR_API_URL / TOKEN / OBJECT_ID` | Владелец (с RC) | До деплоя US-CHG-6 |

---

## Сводная таблица изменений

| ID | Тип | Файл / Артефакт | Ссылка на GAP | Скоуп |
|----|-----|-----------------|--------------|-------|
| CR-ADD-01 | Добавить | `index.js` | GAP-001 (BLOCKING) | ✅ В релизе |
| CR-ADD-02 | Добавить | `.env.example` | — (новое) | ✅ В релизе |
| CR-ADD-03 | Добавить | `routes/telegram.js`, `services/notion.js` | GAP-002 (BLOCKING) | ✅ В релизе |
| CR-ADD-04 | Добавить | `routes/telegram.js`, `services/notion.js` | GAP-002 (BLOCKING) | ✅ В релизе |
| CR-ADD-05 | Добавить | `routes/telegram.js`, `services/notion.js` | GAP-002 (BLOCKING) | ✅ В релизе |
| CR-ADD-06 | Добавить | `services/telegram.js` | GAP-004 (BLOCKING) | ✅ В релизе |
| CR-ADD-07 | Добавить | `routes/telegram.js` | GAP-004 (BLOCKING) | ✅ В релизе |
| CR-ADD-08 | Добавить | `routes/avito.js`, `services/notion.js` | GAP-006 (BLOCKING) | ✅ В релизе |
| CR-ADD-09 | Добавить | `routes/avito.js` | GAP-006 (BLOCKING) | ✅ В релизе |
| CR-ADD-10 | Добавить | `routes/avito.js` | GAP-007 (BLOCKING) | ✅ В релизе |
| CR-ADD-11 | Добавить | `README.md` (runbook) | GAP-006 | ✅ В релизе |
| CR-ADD-12 | Добавить | `services/realtycalendar.js` (новый файл) | — (новое) | ✅ В релизе |
| CR-ADD-13 | Добавить | Notion schema + `services/notion.js` | — (новое) | ✅ В релизе |
| CR-ADD-14 | Добавить | `routes/telegram.js` | — (новое) | ✅ В релизе |
| CR-ADD-15 | Добавить | Notion schema (select options) | — | ✅ В релизе |
| CR-CHG-01 | Изменить | `index.js` | GAP-001 | ✅ В релизе |
| CR-CHG-02 | Изменить | `routes/telegram.js` | GAP-002, GAP-004 | ✅ В релизе |
| CR-CHG-03 | Изменить | `routes/avito.js` | GAP-006, GAP-007 | ✅ В релизе |
| CR-CHG-04 | Изменить | `routes/realtycalendar.js` | GAP-004 | ✅ В релизе |
| CR-CHG-05 | Изменить | `services/notion.js` | GAP-002, GAP-006 | ✅ В релизе |
| CR-CHG-06 | Изменить | `services/telegram.js` | GAP-004 | ✅ В релизе |
| CR-CHG-07 | Изменить | `.env.example` | GAP-001 | ✅ В релизе |
| CR-DEL-01 | Удалить | `ARCHITECTURE.md` (старое имя `rental-ai-agent/`) | GAP-011 (OBSOLETE) | ✅ Закрыто |
| CR-DEL-02 | Удалить | `ARCHITECTURE.md` §6 (ложное утверждение о webhook secret) | GAP-012 (OBSOLETE) | ✅ Закрыто |
| CR-DEL-03 | Удалить | `TRACKER.md` Шаг 7 `[backlog]` → `[done]` | GAP-010 (OBSOLETE) | ✅ В релизе |
| CR-DEL-04 | Удалить | Demo-режим как production-поведение | GAP-003/NFR-10 | ✅ В релизе |
| CR-DEL-05 | Удалить | `ARCHITECTURE.md` placeholder | — | ✅ Закрыто |

### В бэклоге (вне этого релиза)

| GAP | Краткое описание | Категория |
|-----|-----------------|-----------|
| GAP-003 | Верификация подписей вебхуков | DEFER (до выхода на публичный URL) |
| GAP-005 | Автозаполнение поля `Заметки` | DEFER |
| GAP-008 | Проактивное приветствие гостю после RC-брони | DEFER |
| GAP-009 | Замена `node-telegram-bot-api` на axios | DEFER |
| GAP-010 | README с инструкцией запуска | DEFER |
| GAP-013 | Убрать экспорт `bot` из telegram-сервиса | DEFER |
| GAP-014 | Унификация доступа к `AVITO_USER_ID` | DEFER |
| GAP-015 | Агрегация async-ошибок в alert-канал | DEFER |
| GAP-016 | Избыточная тернарка `total_price` | DEFER (косметика) |

---

*Связанные документы: `AS_IS.md` · `SPECIFICATION.md` · `GAP_ANALYSIS.md` · `ARCHITECTURE.md` · `TRACKER.md`*
