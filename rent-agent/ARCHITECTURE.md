# ARCHITECTURE.md — Архитектурная карта AI-агента для посуточной аренды

> **Роль:** Software Architect  
> **Версия:** 2.1 (соответствует SPECIFICATION.md v2.1)  
> **Дата:** 23 мая 2026  
> **Стек:** Node.js 18+ · Express · CommonJS · @notionhq/client · axios · node-telegram-bot-api · dotenv

---

## 1. Принципы архитектуры

### 1.1 Thin routes / Fat services

Роуты — тонкие оркестраторы: принимают HTTP-запрос, немедленно отвечают `200 OK`, запускают async-pipeline. Вся бизнес-логика, маппинг данных и обращения к внешним API — в сервисах. Роуты не знают деталей Notion API, формата Авито или формата Telegram.

```
routes/*      ← только: 200 OK + вызовы сервисов в правильном порядке
services/*    ← вся логика: запросы к API, маппинг, кеш, форматирование
```

### 1.2 Fire-and-forget webhooks

Все вебхуки отвечают `200 OK` **до** начала обработки. Тяжёлая работа — в немедленно вызываемой async-функции `(async () => { ... })()`. Это соответствует требованиям всех трёх источников (Telegram, Авито, RealtyCalendar).

```
async function webhook(req, res) {
  res.sendStatus(200);          // ← всегда первым
  (async () => {
    // pipeline
  })();
}
```

### 1.3 Изолированные шаги, независимые try/catch

Каждый внешний вызов в pipeline обёрнут в отдельный `try/catch`. Ошибка на шаге 2 не прерывает шаг 3. Ошибки логируются через `console.error('[module] ...')`.

### 1.4 Секреты только в .env

Все ключи, токены, ID — в `rent-agent/.env`. Ни один секрет не попадает в код или git. Сервисы читают `process.env` только **один раз при загрузке модуля** — в начале файла. В production проверка на отсутствие обязательных переменных даёт явный `console.warn` при старте.

### 1.5 Сервисы не зависят друг от друга

Принцип из оригинальной архитектуры сохраняется. Каждый сервис зависит только от npm-пакетов + утилит. Оркестрация — только в роутах. Исключение: `services/telegram.js` → `utils/formatDate.js` (разрешено).

```
routes/telegram      → services/{notion, llm, telegram}
routes/realtycalendar → services/{notion, avito, telegram}
routes/avito         → services/{avito, llm, notion}      ← notion добавляется
```

### 1.6 Минимальное вторжение

Новая функциональность добавляется в существующие файлы только когда неизбежно. Новые сервисы — отдельными файлами. Существующее поведение не ломается — расширяется ветками `if/else`.

---

## 2. Структура папок

```
rent-agent/
│
├── index.js                         ← точка входа Express; регистрирует роуты и middleware
│                                      ⚠️ изменяется: dotenv.config({ path }) для GAP-001
│
├── package.json                     ← зависимости проекта (не трогаем)
├── .env                             ← секреты (не в git)  ← ПЕРЕМЕЩАЕТСЯ из корня репо
├── .env.example                     ← шаблон (документация к переменным)
│
├── src/
│   │
│   ├── routes/
│   │   ├── telegram.js              ← POST /webhook/telegram
│   │   │                              ⚠️ изменяется: +callback_query, +contact, +matching
│   │   ├── realtycalendar.js        ← POST /webhook/realtycalendar
│   │   │                              ✅ НЕ ТРОГАЕМ (US-OK-1 работает)
│   │   └── avito.js                 ← POST /webhook/avito
│   │                                  ⚠️ изменяется: +Notion CRM, +контекст LLM
│   │
│   ├── services/
│   │   ├── notion.js                ← CRM: создание/поиск/обновление броней
│   │   │                              ⚠️ изменяется: +3 новых метода поиска, +updateBookingFields
│   │   ├── telegram.js              ← отправка сообщений и уведомлений
│   │   │                              ⚠️ изменяется: +sendWithKeyboard, +notifyOwnerWithActions
│   │   ├── avito.js                 ← OAuth2-токен, blockDates, sendMessage
│   │   │                              ✅ НЕ ТРОГАЕМ (API-контракт не меняется)
│   │   ├── llm.js                   ← генерация ответов через OpenRouter
│   │   │                              ✅ НЕ ТРОГАЕМ (контекст обогащается на уровне роутов)
│   │   └── realtycalendar.js        ← 🆕 НОВЫЙ: исходящий API RC (blockDates)
│   │
│   ├── middleware/
│   │   └── logger.js                ← requestLogger (ISO-время, метод, путь, статус, мс)
│   │                                  ✅ НЕ ТРОГАЕМ
│   │
│   └── utils/
│       └── formatDate.js            ← formatDate, formatDateRange
│                                      ✅ НЕ ТРОГАЕМ
│
└── tests/
    ├── diagnose_notion.js           ← ✅ НЕ ТРОГАЕМ
    ├── diagnose_telegram.js         ← ✅ НЕ ТРОГАЕМ
    ├── test_notion.js               ← ✅ НЕ ТРОГАЕМ (новые методы потребуют новых тестов)
    ├── test_llm.js                  ← ✅ НЕ ТРОГАЕМ
    ├── test_telegram.js             ← ✅ НЕ ТРОГАЕМ
    └── e2e_mock.js                  ← ✅ НЕ ТРОГАЕМ (DEMO_MODE остаётся для CI)
```

---

## 3. Описание модулей

### 3.1 `index.js` — точка входа

**Назначение:** поднять Express, подключить middleware и роуты, запустить сервер.

**Изменения в TO-BE:**
- `require('dotenv').config()` → `require('dotenv').config({ path: require('path').resolve(__dirname, '.env') })` — явный путь, не зависит от `cwd` (GAP-001, NFR-1).
- При `NODE_ENV=production` и `DEMO_MODE=true` — `console.warn('[index] ⚠️ DEMO_MODE=true в production!')`.

**Конвенция логирования:** `[index] message`.

---

### 3.2 `routes/telegram.js` — вебхук Telegram

**Назначение:** обработка апдейтов от Telegram Bot API.

**Текущий pipeline (AS-IS):**
```
message.text → findBookingByChatId → generateReply → sendMessage
```

**Целевой pipeline (TO-BE):**

*Ветка 1 — `update.message.text` (текстовое сообщение гостя):*
```
chat_id → findBookingByChatId
  ├─ найдено → generateReply(text, context) → sendMessage          [US-CHG-2]
  └─ не найдено →
       tryMatchByBookingId(text)                                    [FR-2]
         ├─ совпало → updateBookingFields(pageId, {telegramChatId})
         │            → generateReply(text, context) → sendMessage
         └─ не совпало →
              tryMatchByPhone(text)  ← если text похож на номер    [FR-3]
                ├─ совпало → updateBookingFields → generateReply → sendMessage
                └─ не совпало → consultationReply + hint + notifyOwner
```

*Ветка 2 — `update.message.contact` (гость поделился контактом):*
```
contact.phone_number → findBookingByPhone                          [FR-3]
  ├─ найдено → updateBookingFields(pageId, {telegramChatId})
  │            → sendMessage("Привязка выполнена!")
  └─ не найдено → sendMessage("Бронь по номеру не найдена") + notifyOwner
```

*Ветка 3 — `update.callback_query` (нажатие inline-кнопки владельцем):*
```
callback_query.from.id → валидация === TELEGRAM_OWNER_CHAT_ID      [FR-11]
  ├─ не владелец → answerCallbackQuery("Нет доступа"), return
  └─ владелец →
       parse action + pageId из callback_data
       ├─ action = 'status_*' → updateBookingStatus(pageId, status) [FR-8]
       │                         → answerCallbackQuery("Статус обновлён ✓")
       └─ action = 'confirm_booking' → confirmAndSync(pageId)       [FR-16]
```

**Зависимости:** `services/{notion, llm, telegram}`.

**Конвенция логирования:** `[webhook/telegram] ...`.

---

### 3.3 `routes/realtycalendar.js` — вебхук RealtyCalendar

**Назначение:** приём броней из Яндекс Путешествий и ЦИАН. **Не меняется.**

**Pipeline:**
```
action=create_booking → createBooking(Notion) → blockDates(Авито) → notifyOwner(Telegram)
```

**Зависимости:** `services/{notion, avito, telegram}`.

**Конвенция логирования:** `[webhook/realtycalendar] ...`.

---

### 3.4 `routes/avito.js` — вебхук Авито

**Назначение:** обработка входящих сообщений из Messenger Авито.

**Текущий pipeline (AS-IS):**
```
message → getToken → generateReply({}) → sendMessage
```

**Целевой pipeline (TO-BE):**
```
payload.type=message, author ≠ userId →
  getToken(Авито)
  findBookingByAvitoChatId(chatId)                                  [FR-13]
    ├─ найдено → обогащаем context из записи Notion
    └─ не найдено → createBooking(черновик) → context из нового pageId [FR-12]
  generateReply(text, context)                                      [FR-14]
  sendMessage(token, userId, chatId, reply)
```

**Зависимости:** `services/{avito, llm, notion}` — добавляется `notion`.

**Конвенция логирования:** `[webhook/avito] ...`.

---

### 3.5 `services/notion.js` — Notion CRM

**Назначение:** единственный модуль, работающий с Notion API. Инкапсулирует маппинг `BookingData ↔ Notion properties`.

**Существующие функции (не трогаем контракт):**

| Функция | Что делает |
|---------|-----------|
| `createBooking(data)` | Создаёт запись; дедуп по `ID Брони` |
| `findBookingByChatId(chatId)` | Поиск по `Telegram chat_id` |
| `updateBookingStatus(pageId, status)` | Обновляет поле `Статус` — **теперь вызывается из production** |

**Новые функции (добавляются):**

| Функция | Что делает | Для |
|---------|-----------|-----|
| `findBookingByBookingId(bookingId)` | Поиск по полю `ID Брони` (text) | FR-2, FR-7 |
| `findBookingByPhone(phone)` | Поиск по нормализованному `Телефон` | FR-3, FR-7 |
| `findBookingByAvitoChatId(chatId)` | Поиск по `Авито chat_id` | FR-13 |
| `updateBookingFields(pageId, fields)` | Обновляет произвольный набор полей (chat_id, rc_synced, статус, имя...) | FR-4, FR-17 |

**Норма нормализации телефона** (в `findBookingByPhone`): убрать всё кроме цифр; заменить ведущую `8` на `7`; проверять совпадение 10 последних цифр.

**Конвенция логирования:** `[notion] functionName: details`.

---

### 3.6 `services/telegram.js` — Telegram Bot API

**Назначение:** отправка сообщений гостям и уведомлений владельцу. Обёртка над `node-telegram-bot-api`.

**Существующие функции (не трогаем контракт):**

| Функция | Что делает |
|---------|-----------|
| `sendMessage(chatId, text)` | Отправляет HTML-сообщение гостю |
| `notifyOwner(html)` | Отправляет уведомление владельцу |
| `formatBookingNotification(booking)` | Форматирует HTML-уведомление о брони |

**Новые функции (добавляются):**

| Функция | Что делает | Для |
|---------|-----------|-----|
| `sendMessageWithKeyboard(chatId, text, inlineKeyboard)` | Отправляет сообщение с inline-кнопками | FR-10 |
| `notifyOwnerWithActions(html, inlineKeyboard)` | Уведомление владельцу + кнопки действий | FR-10, FR-16 |
| `answerCallbackQuery(callbackQueryId, text)` | Подтверждение нажатия кнопки (убирает "часики") | FR-11 |

**Inline-клавиатура уведомления о брони (структура `callback_data`):**

```
status_confirmed:{pageId}      → Статус = Подтверждена
status_checkedin:{pageId}      → Статус = Заехал
status_completed:{pageId}      → Статус = Завершена
status_cancelled:{pageId}      → Статус = Отменена
confirm_booking:{pageId}       → триггер синхронизации с RC (US-CHG-6)
```

Кнопки `status_*` показываются на уведомлениях о бронях из RC (US-OK-1).  
Кнопка `confirm_booking` — на уведомлениях о черновиках из Авито/Telegram (US-CHG-3).

**Конвенция логирования:** `[telegram] functionName: details`.

---

### 3.7 `services/avito.js` — Авито STR API ✅ не трогаем

**Назначение:** OAuth2, блокировка дат, отправка сообщений в Мессенджер Авито.

Контракт `getToken / blockDates / sendMessage / isDemoMode / userId` не меняется.  
`isDemoMode` по-прежнему определяется на старте модуля: `DEMO_MODE === 'true' || !AVITO_CLIENT_ID || !AVITO_CLIENT_SECRET`.

---

### 3.8 `services/llm.js` — OpenRouter LLM ✅ не трогаем

**Назначение:** генерация ответов от лица «Анны» через OpenRouter.

Контракт `generateReply(text, context)` / `buildSystemPrompt(context)` не меняется.  
Обогащение контекста для Авито и Telegram происходит в роутах — `llm.js` получает уже готовый объект `context`.

---

### 3.9 `services/realtycalendar.js` — 🆕 исходящий API RealtyCalendar

**Назначение:** блокировка дат в RealtyCalendar для распространения на ЦИАН и Яндекс (обратное направление синхронизации, US-CHG-6).

**Функции:**

| Функция | Что делает | Для |
|---------|-----------|-----|
| `blockDates({ objectId, dateFrom, dateTo, externalRef })` | POST в RC API; возвращает `{ rcBookingId }` | FR-15 |

**Защита от петли:** вызывается только если `booking.source` ∉ `['Яндекс Аренда', 'ЦИАН']` (NFR-8). Проверка — в роуте `telegram.js` перед вызовом, не внутри сервиса.

**Конвенция логирования:** `[realtycalendar] blockDates: objectId=... ${dateFrom}→${dateTo}`.

---

### 3.10 `middleware/logger.js` ✅ не трогаем

Формат: `[ISO] METHOD path statusCode — Xms  (ip)`.

---

### 3.11 `utils/formatDate.js` ✅ не трогаем

`formatDate(iso)` → `'20 июня 2026'`  
`formatDateRange(from, to)` → `'20–22 июня 2026'`

---

## 4. Потоки данных по сценариям

### 4.1 US-OK-1 — Бронь через RealtyCalendar (без изменений)

```
Яндекс/ЦИАН → RC → POST /webhook/realtycalendar
  │
  ├─ [notion] createBooking → Notion DB (status=Подтверждена)
  ├─ [avito]  getToken → blockDates(itemId, dates) → Авито STR API
  └─ [telegram] formatBookingNotification + notifyOwnerWithActions(+кнопки статусов)
                                           ↑ изменяется: добавляются inline-кнопки
```

---

### 4.2 US-CHG-1+2 — Идентификация и диалог гостя в Telegram

```
Гость → POST /webhook/telegram (message.text)
  │
  ├─ [notion] findBookingByChatId(chatId)
  │     ├─ [найдено] → context = {guestName, apartment, dates, totalPrice, source}
  │     │              → [llm] generateReply(text, context) → [telegram] sendMessage
  │     │
  │     └─ [не найдено] →
  │           ├─ [notion] findBookingByBookingId(text)  ← если текст похож на ID брони
  │           │     ├─ [совпало] → [notion] updateBookingFields(pageId, {telegramChatId})
  │           │     │              → [llm] generateReply(text, context) → sendMessage
  │           │     └─ [нет] → следующая попытка ↓
  │           │
  │           ├─ [notion] findBookingByPhone(normalize(text))  ← если текст = телефон
  │           │     ├─ [совпало] → updateBookingFields → generateReply → sendMessage
  │           │     └─ [нет] → ↓
  │           │
  │           └─ [не идентифицирован] → [llm] generateReply(text, {}) ← консультация
  │                                     → [telegram] sendMessage (с подсказкой про привязку)
  │                                     → [telegram] notifyOwner("⚠️ Неизвестный гость")

Гость → POST /webhook/telegram (message.contact)
  │
  └─ [notion] findBookingByPhone(contact.phone_number)
        ├─ [найдено] → updateBookingFields(pageId, {telegramChatId})
        │              → sendMessage("Готово, теперь я вас знаю 👍")
        └─ [не найдено] → sendMessage("Не нашла вашу бронь...") + notifyOwner
```

---

### 4.3 US-CHG-3 — Первый контакт в Авито: Messenger → CRM

```
Гость → POST /webhook/avito (payload.type=message, author≠userId)
  │
  ├─ [avito] getToken (OAuth2, in-memory кеш)
  │
  ├─ [notion] findBookingByAvitoChatId(chatId)
  │     ├─ [найдено] → context = {guestName, apartment, dates, source, status}
  │     │              [если в payload пришло имя/телефон] → updateBookingFields(...)
  │     │
  │     └─ [не найдено] → [notion] createBooking({
  │                           bookingId: `AVITO-{chatId}`,
  │                           source: 'Авито',
  │                           avitoChatId: chatId,
  │                           avitoItemId: payload.item_id || null,
  │                           status: 'Ожидает подтверждения',
  │                           ...данные из payload если есть
  │                        })
  │                        → context = {source: 'Авито', status: 'Ожидает подтверждения'}
  │
  ├─ [llm] generateReply(text, context)
  │
  └─ [avito] sendMessage(token, userId, chatId, reply)
```

---

### 4.4 US-CHG-4 — Владелец меняет статус брони (кнопки Telegram)

```
Владелец нажимает кнопку → POST /webhook/telegram (callback_query)
  │
  ├─ validate: from.id === TELEGRAM_OWNER_CHAT_ID  → иначе answerCallbackQuery("Нет доступа")
  │
  ├─ parse callback_data: "status_{value}:{pageId}"
  │
  ├─ validate status ∈ ALLOWED_TRANSITIONS[currentStatus]
  │     └─ нарушение → answerCallbackQuery("Недопустимый переход") + console.error
  │
  ├─ [notion] updateBookingStatus(pageId, status)
  │
  └─ [telegram] answerCallbackQuery(id, "Статус: {status} ✓")
                editMessageReplyMarkup — убрать кнопку смены статуса (опционально)
```

**Допустимые переходы:**
```
Ожидает подтверждения → Подтверждена, Отменена
Подтверждена          → Заехал, Отменена
Заехал                → Завершена, Отменена
Завершена             → (нет исходящих переходов)
Отменена              → (нет исходящих переходов)
```

---

### 4.5 US-CHG-6 — Подтверждение брони → блокировка ЦИАН/Яндекс через RC

```
Владелец нажимает "Подтвердить бронь" → callback_data: "confirm_booking:{pageId}"
  │
  ├─ validate owner (from.id === TELEGRAM_OWNER_CHAT_ID)
  │
  ├─ [notion] updateBookingFields(pageId) → получить booking.source, booking.rcSynced
  │
  ├─ guard: source ∈ ['Яндекс Аренда', 'ЦИАН'] → answerCallbackQuery("Бронь уже из RC, синхронизация не нужна")
  │
  ├─ guard: rcSynced === true → answerCallbackQuery("Уже синхронизировано ✓")
  │
  ├─ validate: dateFrom + dateTo заполнены → иначе answerCallbackQuery("Укажите даты в CRM")
  │
  ├─ [realtycalendar] blockDates({ objectId: RC_OBJECT_ID, dateFrom, dateTo, externalRef: pageId })
  │     └─ ошибка → console.error + answerCallbackQuery("Ошибка RC, попробуйте ещё раз")
  │
  ├─ [notion] updateBookingFields(pageId, { status: 'Подтверждена', rcSynced: true })
  │
  └─ [telegram] answerCallbackQuery("Даты заблокированы в ЦИАН и Яндексе ✓")
                notifyOwner("✅ Бронь подтверждена, ЦИАН и Яндекс обновлены")
```

---

## 5. Структура данных

### 5.1 BookingData — внутренний объект агента

Используется для передачи данных между роутами и `services/notion.js`.  
Поля с пометкой `🆕` — добавляются в TO-BE.

```
{
  bookingId:       string         — уникальный ID ('RC-12345', 'AVITO-{chatId}')
  guestName:       string
  phone:           string         — в формате '+79001234567' или '79001234567'
  dateFrom:        string | null  — 'YYYY-MM-DD'
  dateTo:          string | null  — 'YYYY-MM-DD'
  apartment:       string
  source:          string         — 'Авито' | 'Яндекс Аренда' | 'ЦИАН' | 'Telegram' | 'Другое'
  totalPrice:      number | null
  status:          string         — см. §5.3
  telegramChatId:  number | null
  avitoItemId:     string | null
  avitoChatId:     string | null
  notes:           string
  rcSynced:        boolean  🆕    — true если даты зарегистрированы в RC
}
```

### 5.2 LLM context — объект для generateReply

```
{
  guestName:   string   — имя для обращения
  apartment:   string   — объект аренды
  dateFrom:    string   — локализованная дата ('20 июня 2026')
  dateTo:      string
  totalPrice:  number
  source:      string
  status:      string  🆕  — передаём для черновиков Авито (Анна знает контекст)
}
```

При пустом объекте `{}` — режим первичной консультации (поведение AS-IS).

### 5.3 Notion «Брони» — схема базы данных

| Поле Notion | Тип | Используется в TO-BE |
|-------------|-----|---------------------|
| `ID Брони` | title | Ключ дедупликации; поиск по коду брони (FR-2) |
| `Имя клиента` | rich_text | LLM-контекст, уведомление |
| `Телефон` | phone_number | Матчинг с Telegram (FR-3) |
| `Квартира` | rich_text | LLM-контекст |
| `Источник` | select | Защита от петли RC (NFR-8); LLM-контекст |
| `Сумма` | number | Уведомление |
| `Статус` | select | Управляется кнопками (FR-8), создаётся для лидов |
| `Даты` | date (range) | Передаётся в RC.blockDates, LLM-контекст |
| `Telegram chat_id` | number | Привязка гостя (FR-4) |
| `Авито item_id` | rich_text | Блокировка дат Авито (US-OK-1) |
| `Авито chat_id` | rich_text | Дедуп/поиск лидов Авито (FR-13) |
| `Заметки` | rich_text | Ручное поле владельца (не автозаполняется) |
| `Синхронизировано с RC` | **checkbox** 🆕 | Идемпотентность FR-17 |
| `Дата создания` | created_time | Авто, Notion |

**Допустимые значения `Статус`:**

| Значение | Кто создаёт |
|----------|------------|
| `Ожидает подтверждения` | Агент (черновик Авито/лид) |
| `Подтверждена` | RC-вебхук; владелец кнопкой `confirm_booking` |
| `Заехал` | Владелец кнопкой |
| `Завершена` | Владелец кнопкой |
| `Отменена` | Владелец кнопкой |

**Допустимые значения `Источник`:**

`Авито` · `Яндекс Аренда` · `ЦИАН` · `Telegram` · `RealtyCalendar` · `Другое`

---

## 6. Обработка ошибок и логирование

### 6.1 Паттерн обработки ошибок

Каждый шаг pipeline — отдельный `try/catch`. Конвенция для **всех** модулей:

```
try {
  result = await someService.action(params);
  console.log(`[module] action: success — detail`);
} catch (err) {
  console.error(`[module] Ошибка action: ${err.message}`);
  // pipeline продолжается
}
```

Для критических шагов (нет смысла продолжать pipeline без результата):

```
try {
  token = await avito.getToken();
} catch (err) {
  console.error(`[webhook/avito] Ошибка получения токена: ${err.message}`);
  return;  // ← выход из IIFE
}
```

### 6.2 Конвенция логирования

| Паттерн | Уровень | Пример |
|---------|---------|--------|
| `[module] action: detail` | log | `[notion] createBooking: AVITO-12345` |
| `[module] Ошибка action: msg` | error | `[notion] Ошибка findBookingByPhone: ...` |
| `[module] ⚠️ warning` | warn | `[avito] ⚠️ DEMO_MODE в production!` |
| `[ISO] METHOD path status — Xms (ip)` | log | middleware/logger.js |

**Правило:** имя модуля в скобках — всегда нижний регистр, совпадает с именем файла. Метки вида `[webhook/avito]`, `[notion]`, `[llm]`, `[telegram]`, `[avito]`, `[realtycalendar]`.

### 6.3 Обработка ошибок LLM

Fallback-текст при недоступности OpenRouter — хранится в `services/llm.js` (не трогаем):

- Telegram: `'Анна сейчас недоступна — отвечу вам в течение часа 😊'`
- Авито: `'Здравствуйте! Уточню детали и отвечу вам в ближайшее время 😊'`

### 6.4 Обработка ошибок RC API

При ошибке `realtycalendar.blockDates`:
- Поле `Синхронизировано с RC` остаётся `false`
- Владелец получает алерт через `notifyOwner`
- Повторное нажатие `Подтвердить бронь` безопасно (идемпотентно)

### 6.5 Глобальный error handler

```javascript
app.use((err, _req, res, _next) => {
  console.error('[index] Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});
```

Ловит только синхронные ошибки middleware. Async-pipeline'ы отвечают `200` до начала работы — их ошибки логируются через `console.error` и видны в `pm2 logs` / stdout хостинга. Агрегация в alert-канал — бэклог (GAP-015).

---

## 7. .env.example

```dotenv
# ─── Сервер ────────────────────────────────────────────────────────────────────
PORT=3000
NODE_ENV=development               # production | development

# ─── Notion CRM ────────────────────────────────────────────────────────────────
NOTION_TOKEN=secret_xxx            # Integration Token из notion.so/my-integrations
NOTION_DATABASE_ID=xxx             # ID базы «Брони» (32 символа из URL страницы)

# ─── LLM / OpenRouter ──────────────────────────────────────────────────────────
OPENROUTER_API_KEY=sk-or-xxx
OPENROUTER_MODEL=openai/gpt-4o-mini   # необязательно; default: openai/gpt-4o-mini
OPENROUTER_SITE_URL=https://your-domain.com
OPENROUTER_APP_NAME=Rental AI Agent

# ─── Telegram Bot ──────────────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=123456:ABCxxx   # из @BotFather
TELEGRAM_OWNER_CHAT_ID=123456789   # ваш chat_id (узнать: написать боту /start, проверить лог)

# ─── Авито STR API ─────────────────────────────────────────────────────────────
AVITO_CLIENT_ID=xxx
AVITO_CLIENT_SECRET=xxx
AVITO_USER_ID=xxx                  # числовой ID вашего аккаунта Авито
DEMO_MODE=false                    # true — только для разработки/CI; в production ВСЕГДА false

# ─── RealtyCalendar (входящий вебхук) ──────────────────────────────────────────
REALTYCALENDAR_WEBHOOK_SECRET=     # зарезервировано для будущей верификации подписи HMAC-SHA256

# ─── RealtyCalendar (исходящий API) — блокировка дат в ЦИАН/Яндекс ─────────────
REALTYCALENDAR_API_URL=https://api.realtycalendar.ru   # уточнить в документации RC
REALTYCALENDAR_API_TOKEN=xxx       # Bearer-токен / API-ключ для исходящих запросов
REALTYCALENDAR_OBJECT_ID=xxx       # ID объекта аренды в RC (для одной квартиры)
```

---

## 8. Принцип минимального вторжения

### 8.1 Модули, которые НЕ трогаем

| Модуль | Причина |
|--------|---------|
| `src/routes/realtycalendar.js` | US-OK-1 работает корректно |
| `src/services/avito.js` | API-контракт не меняется; DEMO_MODE остаётся |
| `src/services/llm.js` | Контракт `generateReply(text, context)` стабилен; контекст обогащается снаружи |
| `src/middleware/logger.js` | Работает |
| `src/utils/formatDate.js` | Работает |
| `tests/*` | Регрессия должна проходить; новые тесты — отдельными файлами |

### 8.2 Модули, которые изменяются минимально

| Модуль | Что меняется | Что НЕ меняется |
|--------|-------------|-----------------|
| `index.js` | `dotenv.config({ path })` + warn при DEMO_MODE в prod | Регистрация роутов, health-check, порт |
| `src/routes/telegram.js` | Добавляются ветки `contact` и `callback_query`; обогащается ветка `message.text` | Fire-and-forget паттерн, 200 OK сразу |
| `src/routes/avito.js` | Добавляется вызов `notion.*`; `llm.generateReply` получает контекст вместо `{}` | OAuth2, demo-guard, фильтр автора |
| `src/services/notion.js` | Добавляются 4 новых метода; `buildNotionProperties` расширяется полем `rcSynced` | Существующие функции, `parseNotionPage`, логика дедупликации |
| `src/services/telegram.js` | Добавляются 3 новых функции | `sendMessage`, `notifyOwner`, `formatBookingNotification` |

### 8.3 Новые файлы

| Файл | Размер изменений |
|------|-----------------|
| `src/services/realtycalendar.js` | Новый сервис (~60 строк) |

---

## 9. Точки интеграции с существующим кодом

### 9.1 `routes/telegram.js` → `services/notion.js`

Текущий вызов `findBookingByChatId` остаётся на месте. Под ним добавляется `else`-ветка с последовательным вызовом `findBookingByBookingId` / `findBookingByPhone`. Контекст собирается из результата любого успешного поиска — формат объекта `context` не меняется.

### 9.2 `routes/avito.js` → `services/notion.js`

Между шагом `getToken` и шагом `generateReply` вставляется новый блок: `findBookingByAvitoChatId` → `createBooking` (при отсутствии). Результат формирует `context`. Шаг `generateReply(text, {})` меняется на `generateReply(text, context)`. Шаг `sendMessage` не меняется.

### 9.3 `routes/realtycalendar.js` → `services/telegram.js`

Вызов `telegram.notifyOwner(html)` заменяется на `telegram.notifyOwnerWithActions(html, keyboard)`, где `keyboard` содержит кнопки `status_*`. Функция `notifyOwner` по-прежнему существует и используется в других местах без изменений.

### 9.4 `services/notion.js` — новое поле `rcSynced`

`buildNotionProperties` получает опциональную ветку:
```
if (data.rcSynced !== undefined) {
  props['Синхронизировано с RC'] = { checkbox: Boolean(data.rcSynced) };
}
```
`parseNotionPage` получает одну новую строку:
```
rcSynced: p['Синхронизировано с RC']?.checkbox ?? false,
```
Существующий код, читающий `parseNotionPage`, не ломается — новое поле просто игнорируется там, где не используется.

---

## 10. Совместимость данных и план миграции Notion

### 10.1 Что меняется в схеме Notion

| Изменение | Тип | Обратная совместимость |
|-----------|-----|----------------------|
| Добавить поле `Синхронизировано с RC` (checkbox) | Новое поле | ✅ Старые записи: `false` по умолчанию |
| Добавить значение `Заехал` в select `Статус` | Новая опция | ✅ Существующие записи не меняются |
| Добавить значение `Ожидает подтверждения` в select `Статус` | Новая опция | ✅ Используется только для новых лидов |

### 10.2 Что НЕ меняется

- Все существующие поля и их типы — без изменений.
- Существующие записи (`ID Брони`, `Статус`, `Даты` и т.д.) — без изменений.
- API-версия Notion (`2022-06-28`) — без изменений.

### 10.3 Порядок миграции (одноразово, до деплоя TO-BE)

1. В интерфейсе Notion открыть базу «Брони».
2. Добавить поле `Синхронизировано с RC` — тип **Checkbox**.
3. В поле `Статус` (тип Select) добавить опции: `Ожидает подтверждения`, `Заехал` (если их нет).
4. Убедиться, что интеграция Notion имеет права **Update content** (нужно для `updateBookingFields`).
5. Задеплоить новый код — старые записи автоматически получают `Синхронизировано с RC = false`.

### 10.4 Нет ломающих изменений

Существующие записи в Notion не затрагиваются. `createBooking` и `findBookingByChatId` работают с теми же данными. Тесты `test_notion.js` не требуют изменений (новые поля опциональны).

---

## 11. Граф зависимостей модулей (TO-BE)

```
index.js
├── middleware/logger
├── routes/telegram        → services/{notion, llm, telegram}
├── routes/realtycalendar  → services/{notion, avito, telegram}    ← не трогаем
└── routes/avito           → services/{avito, llm, notion}         ← +notion

services/telegram          → utils/formatDate, node-telegram-bot-api
services/notion            → @notionhq/client
services/llm               → axios
services/avito             → axios
services/realtycalendar    → axios                                  ← новый
utils/formatDate           — (нет зависимостей)
```

Принцип «сервисы не зависят друг от друга» **сохранён**.

---

## 12. HTTP-эндпоинты (полный список TO-BE)

| Метод | Путь | Модуль | 200 OK |
|-------|------|--------|--------|
| `GET` | `/health` | inline `index.js` | Сразу |
| `POST` | `/webhook/telegram` | `routes/telegram.js` | Сразу (fire-and-forget) |
| `POST` | `/webhook/realtycalendar` | `routes/realtycalendar.js` | Сразу (fire-and-forget) |
| `POST` | `/webhook/avito` | `routes/avito.js` | Сразу (fire-and-forget) |

---

*Связанные документы: `SPECIFICATION.md` · `AS_IS.md` · `GAP_ANALYSIS.md` · `TRACKER.md`*
