# TRACKER.md — Пошаговый план реализации change request

> **Роль:** Tech Lead
> **Версия:** 3.0 (brownfield delta, соответствует `CHANGE_REQUEST.md` v1.0)
> **Дата:** 23 мая 2026
> **Скоуп:** SPECIFICATION.md v2.1 (US-CHG-1…6, FR-1…FR-18, NFR-1, NFR-10).
> **Основание:** `AS_IS.md`, `SPECIFICATION.md`, `ARCHITECTURE.md`, `CHANGE_REQUEST.md`, `GAP_ANALYSIS.md`.

> **Принципы плана:**
> - **Один шаг = один модуль или одна интеграция.** Никаких «попутных» правок.
> - **От простого к сложному:** сначала каркас и baseline, затем общие сервисы, потом роуты, потом сквозная бизнес-логика.
> - **Минимальное вторжение в существующий код.** В шагах явно перечислены файлы, к которым нельзя прикасаться (см. `CHANGE_REQUEST.md` §4).
> - **Обязательная регрессия после каждого шага.** Шаг не считается завершённым, пока все базовые тесты не зелёные.
> - **Каждый шаг привязан к CR-id из `CHANGE_REQUEST.md`** — чтобы трассировать изменение до бизнес-решения.

---

## Статусы

- `[backlog]` — ещё не начато
- `[in-progress]` — в работе прямо сейчас
- `[blocked]` — заблокировано внешней причиной (нет ключа RC, не открыт доступ к Notion и т.п.)
- `[done]` — выполнено, регрессия зелёная, проверка пройдена

Старый трекер (греенфилд-этап Шагов 0–9) считается завершённым: каркас, базовые сервисы, RealtyCalendar-вебхук, базовый Авито-роут — всё уже в коде. План ниже — это **дельта** до TO-BE.

---

## Регрессионный набор (используется на каждом шаге)

| Команда | Что проверяет |
|---------|---------------|
| `node tests/diagnose_notion.js` | Подключение к Notion, схема базы |
| `node tests/diagnose_telegram.js` | Бот доступен, `getMe` отвечает |
| `node tests/test_notion.js` | 5 smoke-тестов CRUD по Notion |
| `node tests/test_llm.js` | 5 тестов LLM-сервиса + fallback |
| `node tests/test_telegram.js` | 3 теста Telegram-сервиса |
| `node tests/e2e_mock.js` | 5 e2e-сценариев (RC / Telegram / Авито + два edge-case) |

Любой шаг считается **не завершённым**, пока хотя бы один из этих тестов красный или не запущен. Если шаг намеренно ломает один из старых тестов (это означает breaking change!), нужно либо переписать тест в рамках того же шага, либо **остановиться и пересмотреть план**.

---

## Шаг 1 — Baseline: проверка каркаса и регрессия `[done]`

**Цель:** Зафиксировать рабочее AS-IS-состояние и убедиться, что регрессионный набор зелёный **до** любых изменений.

**Связь с CR:** baseline для всех последующих CR; косвенно касается `CHANGE_REQUEST.md` §7.4 (миграция `.env`) — здесь только диагностика, без правок.

**Задачи:**
- [ ] Запустить `npm install` в `rent-agent/` (проверить, что `node_modules` валидны)
- [ ] Проверить, что `node index.js` стартует **из обоих** мест:
  - [ ] `cd rent-agent && node index.js` (ожидается warning об отсутствии переменных — это и есть GAP-001)
  - [ ] `node rent-agent/index.js` из корня репо (должен подхватывать корневой `.env`)
- [ ] `GET http://localhost:3000/health` → `{ status: 'ok', uptime: ... }`
- [ ] Прогнать весь регрессионный набор (см. таблицу выше) **из корня репо**, чтобы `.env` ещё подхватывался — записать вывод в `tests/baseline.log` для последующего сравнения
- [ ] Зафиксировать в логе: какие тесты падают сейчас, какие зелёные (это эталон, к которому возвращаемся при проблемах)
- [ ] **Регрессия:** baseline-run сам по себе — это регрессия; никаких изменений кода не делается

**Файлы (только чтение, ничего не меняем):**
- `rent-agent/index.js`
- `rent-agent/tests/*.js`
- `rent-agent/package.json`

**Как проверить:**
- На экране — список тестов с пометками PASS/FAIL, эквивалентный текущему AS-IS.
- Создан файл `rent-agent/tests/baseline.log` с полным выводом регрессии (для сравнения после каждого следующего шага).
- На `GET /health` приходит `200`.

**Промпт для Cursor:**
> Контекст: `@TRACKER.md` `@AS_IS.md` `@rent-agent/index.js` `@rent-agent/tests`
>
> Мы выполняем Шаг 1 из `TRACKER.md` — baseline. Никаких правок кода и документации.
> 1. Выполни `npm install` в `rent-agent/`.
> 2. Запусти сервер двумя способами (`cd rent-agent && node index.js` и `node rent-agent/index.js` из корня) — для каждого зафиксируй, загрузились ли переменные окружения. Это диагностика GAP-001, фиксы — позже.
> 3. Прогони `node tests/diagnose_notion.js`, `node tests/diagnose_telegram.js`, `node tests/test_notion.js`, `node tests/test_llm.js`, `node tests/test_telegram.js`, `node tests/e2e_mock.js` из той директории, где `.env` находится сейчас.
> 4. Сохрани полный stdout/stderr в `rent-agent/tests/baseline.log`.
> 5. Кратко перечисли, какие тесты PASS / FAIL и почему — это эталон, к которому будем возвращаться.

---

## Шаг 2 — Очистка устаревших упоминаний `[done]` [from gap analysis]

**Цель:** Снять OBSOLETE-разрывы из `GAP_ANALYSIS.md` (GAP-010, GAP-011, GAP-012), которые искажают документацию, но не требуют изменений кода.

**Связь с CR:** `CR-DEL-01`, `CR-DEL-02`, `CR-DEL-03`, `CR-DEL-05`.
**Источник в GAP_ANALYSIS:** GAP-010 (OBSOLETE-часть про Шаг 7), GAP-011 (старое имя корня `rental-ai-agent/`), GAP-012 (ложное упоминание `REALTYCALENDAR_WEBHOOK_SECRET` как используемого).

**Задачи:**
- [ ] Проверить `ARCHITECTURE.md` v2.1 — что упоминаний `rental-ai-agent/` нет (CR-DEL-01)
- [ ] Проверить `ARCHITECTURE.md` v2.1 — что секрет описан как «зарезервировано для будущей верификации», без ложных утверждений о подключении к роуту (CR-DEL-02)
- [ ] Проверить `ARCHITECTURE.md` v2.1 — что нет placeholder'ов вроде `_PLACEHOLDER_` (CR-DEL-05)
- [ ] В **новом** `TRACKER.md` (этом файле) **не переносим** старый статус «Шаг 7 [backlog]» — фиксируем для истории, что Шаг 7 (middleware + utils) старого трекера уже реализован и работает (CR-DEL-03)
- [ ] Сделать `grep -rni 'rental-ai-agent' rent-agent/` и `grep -rni 'PLACEHOLDER' rent-agent/` — оба должны вернуть пусто
- [ ] **Регрессия:** прогнать весь набор из таблицы выше — изменения только документационные, тесты обязаны оставаться зелёными как в Шаге 1

**Файлы:**
- `rent-agent/ARCHITECTURE.md` (только если найдутся остатки `rental-ai-agent/` / `_PLACEHOLDER_` / ложное упоминание secret)
- `rent-agent/TRACKER.md` (этот файл, эту правку уже несёт само переписывание трекера)

**Как проверить:**
- `grep -rni 'rental-ai-agent' rent-agent/` пусто.
- `grep -rni 'PLACEHOLDER' rent-agent/` пусто.
- В `ARCHITECTURE.md` упоминание `REALTYCALENDAR_WEBHOOK_SECRET` явно помечено как «зарезервировано / verification вне скоупа».
- Регрессионный набор зелёный, идентичен baseline из Шага 1.

**Промпт для Cursor:**
> Контекст: `@TRACKER.md` `@GAP_ANALYSIS.md` (GAP-010, 011, 012) `@CHANGE_REQUEST.md` (CR-DEL-01, 02, 03, 05) `@rent-agent/ARCHITECTURE.md`
>
> Мы выполняем Шаг 2 из `TRACKER.md` — очистка устаревших упоминаний (OBSOLETE-гэпы). Только документация, к коду не прикасаемся.
> 1. Найди все вхождения `rental-ai-agent` в `rent-agent/` и замени на `rent-agent` (CR-DEL-01).
> 2. Найди упоминания `_PLACEHOLDER_` в `ARCHITECTURE.md` — удали (CR-DEL-05).
> 3. Убедись, что `REALTYCALENDAR_WEBHOOK_SECRET` в `ARCHITECTURE.md` описан как «зарезервировано, верификация вне скоупа», без ложного утверждения «подключён к роуту» (CR-DEL-02).
> 4. Сделай контрольные `grep` (`rental-ai-agent`, `PLACEHOLDER`) — должны быть пустые.
> 5. Прогони регрессионный набор из таблицы в `TRACKER.md` — должен совпасть с `tests/baseline.log`.

---

## Шаг 3 — `.env` в `rent-agent/` + явный путь в `dotenv` `[done]` [from gap analysis]

**Цель:** Закрыть GAP-001: агент должен корректно стартовать из каталога `rent-agent/`, не теряя переменных окружения; добавить новые RC-переменные в шаблон.

**Связь с CR:** `CR-ADD-01`, `CR-ADD-02`, `CR-CHG-01`, `CR-CHG-07`, `CR-DEL-04` (production-валидация Авито-ключей).
**Источник в GAP_ANALYSIS:** GAP-001 (BLOCKING).

**Задачи:**
- [ ] В `index.js` заменить `require('dotenv').config()` на `require('dotenv').config({ path: require('path').resolve(__dirname, '.env') })` (CR-CHG-01)
- [ ] При `NODE_ENV=production` и `DEMO_MODE=true` — `console.warn('[index] ⚠️ DEMO_MODE=true в production!')` (CR-ADD-01 / NFR-10)
- [ ] При `NODE_ENV=production` и отсутствии `AVITO_CLIENT_ID` / `AVITO_CLIENT_SECRET` — завершить процесс с ошибкой конфигурации (`console.error` + `process.exit(1)`), а не молча уходить в demo (CR-DEL-04 / NFR-10)
- [ ] Скопировать корневой `.env` → `rent-agent/.env` (если корневой существует) и убедиться, что `rent-agent/.env` в `.gitignore`
- [ ] Обновить `rent-agent/.env.example` (CR-CHG-07, CR-ADD-02):
  - [ ] Уточнить комментарий к `DEMO_MODE` («только для разработки/CI; в production ВСЕГДА false»)
  - [ ] Добавить блок «RealtyCalendar (исходящий API)» с переменными `REALTYCALENDAR_API_URL`, `REALTYCALENDAR_API_TOKEN`, `REALTYCALENDAR_OBJECT_ID`
- [ ] **Регрессия:**
  - [ ] `cd rent-agent && node index.js` теперь должен видеть `.env` (нет warning'ов про отсутствие токенов)
  - [ ] `node tests/diagnose_notion.js`, `diagnose_telegram.js`, `test_notion.js`, `test_llm.js`, `test_telegram.js`, `e2e_mock.js` — все зелёные, **запускаются из `rent-agent/`**
  - [ ] Сравнить вывод с `baseline.log` — список PASS/FAIL должен быть не хуже

**Файлы:**
- `rent-agent/index.js` (минимальная правка — две ветки и одна строка `dotenv.config`)
- `rent-agent/.env` (новый, не в git)
- `rent-agent/.env.example` (расширение)
- `.gitignore` (проверить, что `rent-agent/.env` исключён)

**Файлы, к которым НЕ прикасаемся:**
- Все `services/*.js`
- Все `routes/*.js`
- `tests/*.js`

**Как проверить:**
- `cd rent-agent && node index.js` стартует без warning'ов про токены.
- `cd rent-agent && node tests/e2e_mock.js` — 5/5 зелёные.
- `grep -E '(REALTYCALENDAR_API|DEMO_MODE)' rent-agent/.env.example` показывает все четыре новых/изменённых строки.

**Промпт для Cursor:**
> Контекст: `@TRACKER.md` `@CHANGE_REQUEST.md` (CR-ADD-01, 02; CR-CHG-01, 07; CR-DEL-04) `@SPECIFICATION.md` (FR-1, NFR-1, NFR-10) `@rent-agent/index.js` `@rent-agent/.env.example`
>
> Мы выполняем Шаг 3 из `TRACKER.md` — фикс GAP-001. Не трогаем сервисы и роуты.
> 1. В `rent-agent/index.js`:
>    - Замени `require('dotenv').config()` на `require('dotenv').config({ path: require('path').resolve(__dirname, '.env') })`.
>    - Добавь после загрузки env: при `process.env.NODE_ENV === 'production' && process.env.DEMO_MODE === 'true'` — `console.warn('[index] ⚠️ DEMO_MODE=true в production!')`.
>    - Добавь: при `process.env.NODE_ENV === 'production' && (!process.env.AVITO_CLIENT_ID || !process.env.AVITO_CLIENT_SECRET)` — `console.error('[index] Production без AVITO_CLIENT_ID/SECRET — выход')` и `process.exit(1)`.
> 2. Создай `rent-agent/.env` из корневого `.env` (если есть) или из `.env.example`. Проверь `.gitignore`.
> 3. Обнови `rent-agent/.env.example`:
>    - Поправь комментарий к `DEMO_MODE`.
>    - Добавь секцию «RealtyCalendar (исходящий API)» с `REALTYCALENDAR_API_URL`, `REALTYCALENDAR_API_TOKEN`, `REALTYCALENDAR_OBJECT_ID` и пояснениями.
> 4. Запусти `cd rent-agent && node index.js` (должен стартовать) и весь регрессионный набор из `TRACKER.md`. Сравни вывод с `tests/baseline.log`.

---

## Шаг 4 — Миграция схемы Notion (без кода) `[done]`

**Цель:** Подготовить Notion-базу «Брони» под новые поля и значения **до** деплоя кода, который их использует (защита от R-01 в `CHANGE_REQUEST.md` §6).

**Связь с CR:** `CR-ADD-13` (checkbox `Синхронизировано с RC`), `CR-ADD-15` (новые опции select `Статус`). См. `CHANGE_REQUEST.md` §7.2.
**Источник:** SPEC §5.3, FR-17.

**Задачи (выполняются в интерфейсе Notion владельцем):**
- [ ] Открыть базу «Брони» в Notion
- [ ] Добавить поле `Синхронизировано с RC` типа **Checkbox** (CR-ADD-13) — старые записи получают `false` автоматически
- [ ] В select-поле `Статус` добавить опцию `Ожидает подтверждения` (CR-ADD-15)
- [ ] В select-поле `Статус` добавить опцию `Заехал` (CR-ADD-15)
- [ ] Проверить, что у интеграции Notion есть право **Update content** (Settings → Connections), иначе `updateBookingFields` упадёт с 403
- [ ] **Регрессия:**
  - [ ] `node tests/diagnose_notion.js` — добавление поля/опций не должно ничего сломать; проверяем, что схема узнаётся и все поля на месте
  - [ ] `node tests/test_notion.js` — 5/5 зелёные (никаких изменений кода не было)
  - [ ] Прогнать весь регрессионный набор — должен совпадать с baseline (никаких новых регрессов)

**Файлы:**
- Никаких изменений в репозитории. Это **инфраструктурный шаг** в Notion.
- Опционально: обновить `rent-agent/ARCHITECTURE.md` §10.3 «Порядок миграции» с фактическими датами/исполнителями (если решите вести лог миграций).

**Как проверить:**
- В Notion в базе «Брони» видно новое поле `Синхронизировано с RC` (checkbox), все старые записи показывают пустой/false.
- В select `Статус` среди опций есть `Ожидает подтверждения` и `Заехал`.
- `node tests/diagnose_notion.js` выводит обновлённую схему без ошибок.

**Промпт для Cursor:**
> Контекст: `@TRACKER.md` `@SPECIFICATION.md` (§5.3) `@CHANGE_REQUEST.md` (CR-ADD-13, 15; §7.2) `@ARCHITECTURE.md` (§10) `@rent-agent/tests/diagnose_notion.js`
>
> Мы выполняем Шаг 4 — миграция Notion. Кодовых правок нет, только запуск диагностики.
> 1. Прочитай `ARCHITECTURE.md` §10 и `CHANGE_REQUEST.md` §7.2 — это чеклист для владельца.
> 2. Сгенерируй короткую пошаговую инструкцию (5–6 пунктов) для владельца: что добавить в Notion-схему (поле `Синхронизировано с RC` checkbox + опции `Ожидает подтверждения`, `Заехал` в `Статус`), как проверить права интеграции.
> 3. После того как я подтвержу, что миграция в Notion выполнена, прогони `node tests/diagnose_notion.js` и весь регрессионный набор из `TRACKER.md`. Если что-то красное — стоп.

---

## Шаг 5 — `services/notion.js`: новые методы поиска и обновления `[done]`

**Цель:** Расширить Notion-сервис четырьмя методами (`findBookingByBookingId`, `findBookingByPhone`, `findBookingByAvitoChatId`, `updateBookingFields`) и поддержкой поля `rcSynced` — без изменения существующих публичных функций.

**Связь с CR:** `CR-CHG-05`. Используется в `CR-ADD-03`, `CR-ADD-04`, `CR-ADD-05`, `CR-ADD-08`, `CR-CHG-02`, `CR-CHG-03`, `CR-ADD-14`.

**Задачи:**
- [ ] Добавить `findBookingByBookingId(bookingId)` — query Notion по полю `ID Брони` (title), регистронезависимо, с нормализацией пробелов (SPEC FR-2, FR-7)
- [ ] Добавить `findBookingByPhone(phone)` с нормализацией: только цифры, ведущая `8` → `7`, сравнение последних 10 цифр (SPEC FR-3, FR-7)
- [ ] Добавить `findBookingByAvitoChatId(chatId)` — query по `Авито chat_id` (SPEC FR-13)
- [ ] Добавить `updateBookingFields(pageId, fields)` — обновляет произвольный набор полей (telegramChatId, avitoChatId, name, phone, status, rcSynced, ...); строит `properties` через **тот же** `buildNotionProperties`, не дублируя маппинг (SPEC FR-4, FR-17)
- [ ] В `buildNotionProperties` добавить опциональную ветку: `if (data.rcSynced !== undefined) props['Синхронизировано с RC'] = { checkbox: Boolean(data.rcSynced) }`
- [ ] В `parseNotionPage` добавить одну строку: `rcSynced: p['Синхронизировано с RC']?.checkbox ?? false`
- [ ] **Контракт существующих функций (`createBooking`, `findBookingByChatId`, `updateBookingStatus`) НЕ меняется**
- [ ] Логирование строго в формате `[notion] functionName: detail` (ARCH §6.2)
- [ ] Расширить `tests/test_notion.js` четырьмя новыми сценариями (по одному на метод) — **аддитивно**, не трогая старые 5 тестов
- [ ] **Регрессия:**
  - [ ] `node tests/test_notion.js` — 5 старых + 4 новых = 9 PASS
  - [ ] `node tests/e2e_mock.js` — 5/5 PASS (роуты ещё не зовут новые методы — поведение не должно поменяться)
  - [ ] Весь регрессионный набор зелёный

**Файлы:**
- `rent-agent/src/services/notion.js` (только добавления)
- `rent-agent/tests/test_notion.js` (только добавления)

**Файлы, к которым НЕ прикасаемся:**
- `rent-agent/src/routes/*.js` (будут менять следующие шаги)
- `rent-agent/src/services/{telegram,llm,avito}.js`

**Как проверить:**
- В консоли логи вида `[notion] findBookingByBookingId: id=RC-12345 found pageId=...`
- Новые тесты PASS, старые — без изменений.
- В Notion появилась тестовая запись с `Синхронизировано с RC = true`, прочитанная обратно `parseNotionPage` имеет `rcSynced: true`.

**Промпт для Cursor:**
> Контекст: `@TRACKER.md` `@CHANGE_REQUEST.md` (CR-CHG-05) `@SPECIFICATION.md` (FR-2, 3, 4, 7, 13, 17) `@ARCHITECTURE.md` (§3.5, §9.4) `@rent-agent/src/services/notion.js` `@rent-agent/tests/test_notion.js`
>
> Мы выполняем Шаг 5 — расширение `services/notion.js`. Никаких изменений в роутах и других сервисах.
> 1. Добавь функции `findBookingByBookingId`, `findBookingByPhone` (с нормализацией: только цифры, 8→7, сравнение последних 10 цифр), `findBookingByAvitoChatId`, `updateBookingFields(pageId, fields)`.
> 2. В `buildNotionProperties` добавь опциональную ветку для `rcSynced` (checkbox). В `parseNotionPage` — одну строку `rcSynced: p['Синхронизировано с RC']?.checkbox ?? false`.
> 3. **Не трогай** `createBooking`, `findBookingByChatId`, `updateBookingStatus` — их контракт стабилен.
> 4. Используй существующий формат логов `[notion] functionName: detail`.
> 5. В `tests/test_notion.js` добавь 4 новых теста (по одному на новый метод) — **не правя** старые 5.
> 6. Прогони `node tests/test_notion.js` и весь регрессионный набор. Все зелёные → коммитим.

---

## Шаг 6 — `services/telegram.js`: inline-кнопки и callback `[done]`

**Цель:** Добавить в Telegram-сервис три функции (`sendMessageWithKeyboard`, `notifyOwnerWithActions`, `answerCallbackQuery`) — без изменения существующих.

**Связь с CR:** `CR-ADD-06`, `CR-CHG-06`. Используется в `CR-CHG-04`, `CR-ADD-07`, `CR-ADD-14`.

**Задачи:**
- [ ] Добавить `sendMessageWithKeyboard(chatId, text, inlineKeyboard)` — обёртка над `bot.sendMessage(..., { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } })`
- [ ] Добавить `notifyOwnerWithActions(html, inlineKeyboard)` — `sendMessageWithKeyboard(ownerChatId, html, inlineKeyboard)`
- [ ] Добавить `answerCallbackQuery(callbackQueryId, text)` — через `bot.answerCallbackQuery(id, { text })`
- [ ] Не удалять и не менять `sendMessage`, `notifyOwner`, `formatBookingNotification`, экспорт `bot`/`ownerChatId` (страховка от регрессии по US-OK-1)
- [ ] Структура `callback_data` зафиксирована в ARCH §3.6 / SPEC §2.2 — соблюдать формат `status_*:{pageId}` и `confirm_booking:{pageId}` (важно для Шага 9 и Шага 10!)
- [ ] Логирование `[telegram] sendMessageWithKeyboard: ...`
- [ ] Расширить `tests/test_telegram.js` тестом «отправить сообщение с двумя инлайн-кнопками владельцу» (можно через `TELEGRAM_OWNER_CHAT_ID`, проверка визуальная)
- [ ] **Регрессия:**
  - [ ] `node tests/test_telegram.js` — старые 3 + 1 новый PASS
  - [ ] `node tests/e2e_mock.js` — 5/5 PASS (роуты ещё не используют новые функции)

**Файлы:**
- `rent-agent/src/services/telegram.js` (только добавления)
- `rent-agent/tests/test_telegram.js` (только добавления)

**Файлы, к которым НЕ прикасаемся:**
- `rent-agent/src/routes/*.js`
- `rent-agent/src/services/{notion,llm,avito}.js`

**Как проверить:**
- Запустить новый тест → в Telegram владельцу приходит сообщение с двумя кнопками.
- Нажатие на кнопку → пока никем не обрабатывается (обработчик появится в Шаге 9–10), но `callback_query` виден в логах Telegram через `https://api.telegram.org/bot<TOKEN>/getUpdates` (опциональная проверка вручную).

**Промпт для Cursor:**
> Контекст: `@TRACKER.md` `@CHANGE_REQUEST.md` (CR-ADD-06, CR-CHG-06) `@SPECIFICATION.md` (FR-10) `@ARCHITECTURE.md` (§3.6) `@rent-agent/src/services/telegram.js` `@rent-agent/tests/test_telegram.js`
>
> Мы выполняем Шаг 6 — расширение `services/telegram.js`. Роуты не трогаем.
> 1. Добавь три функции: `sendMessageWithKeyboard(chatId, text, inlineKeyboard)`, `notifyOwnerWithActions(html, inlineKeyboard)`, `answerCallbackQuery(callbackQueryId, text)`.
> 2. Не меняй `sendMessage`, `notifyOwner`, `formatBookingNotification`, экспорт `bot`/`ownerChatId`.
> 3. Логи строго `[telegram] functionName: detail`.
> 4. В `tests/test_telegram.js` — один новый тест: отправить владельцу сообщение с двумя инлайн-кнопками. Старые 3 теста не трогать.
> 5. Прогони регрессионный набор. Все зелёные → коммит.

---

## Шаг 7 — Новый сервис `services/realtycalendar.js` (исходящий API) `[backlog]`

**Цель:** Создать новый сервис с единственным методом `blockDates`, который умеет блокировать даты в RealtyCalendar (для дальнейшего проброса в ЦИАН и Яндекс).

**Связь с CR:** `CR-ADD-12`, `CR-ADD-02` (env-переменные уже в `.env.example` после Шага 3).
**Источник:** SPEC FR-15, US-CHG-6.

**Задачи:**
- [ ] Создать `rent-agent/src/services/realtycalendar.js` (~60 строк, по образцу `services/avito.js`)
- [ ] Реализовать `blockDates({ objectId, dateFrom, dateTo, externalRef })`:
  - [ ] Чтение `REALTYCALENDAR_API_URL`, `REALTYCALENDAR_API_TOKEN` из `process.env` **на старте модуля** (как в других сервисах)
  - [ ] POST в RC API (точный путь и формат — уточнить по документации RC; до уточнения — заглушка с TODO и развернутыми логами; **не блокировать остальные шаги**)
  - [ ] Возвращает `{ rcBookingId }` или бросает ошибку
  - [ ] Таймаут 15 сек (как в `services/avito.js`)
  - [ ] Логи `[realtycalendar] blockDates: objectId=... ${dateFrom}→${dateTo}` (ARCH §3.9)
- [ ] Гард от петли — **в роуте**, не в сервисе (ARCH §3.9), но прокомментировать в JSDoc, что сервис ничего не проверяет про `source`
- [ ] Никакой зависимости от других сервисов (принцип «сервисы независимы»)
- [ ] Опционально: тест `tests/test_realtycalendar.js` с моком axios (если ключей RC ещё нет — отметить шаг `[blocked]` на проверке боевым вызовом)
- [ ] **Регрессия:**
  - [ ] Весь регрессионный набор — ничего не должно сломаться (сервис ещё нигде не подключён)
  - [ ] Если есть `tests/test_realtycalendar.js` — он тоже PASS

**Файлы:**
- `rent-agent/src/services/realtycalendar.js` (новый)
- `rent-agent/tests/test_realtycalendar.js` (новый, опционально)

**Файлы, к которым НЕ прикасаемся:**
- Все существующие `services/*.js`, `routes/*.js`, `index.js`

**Как проверить:**
- `node -e "require('./rent-agent/src/services/realtycalendar.js').blockDates({objectId:'TEST', dateFrom:'2026-06-01', dateTo:'2026-06-03', externalRef:'manual'}).then(console.log).catch(console.error)"` — увидеть либо успешный ответ RC, либо понятную ошибку (например, 401 — значит запрос ушёл).
- `grep -rn 'realtycalendar' rent-agent/src/routes/` — пусто (роуты ещё не подключены).

**Промпт для Cursor:**
> Контекст: `@TRACKER.md` `@CHANGE_REQUEST.md` (CR-ADD-12) `@SPECIFICATION.md` (FR-15, NFR-8) `@ARCHITECTURE.md` (§3.9, §6.4) `@rent-agent/src/services/avito.js` (как образец)
>
> Мы выполняем Шаг 7 — новый сервис `services/realtycalendar.js`. Никаких изменений в роутах.
> 1. Создай `rent-agent/src/services/realtycalendar.js` по образцу `services/avito.js`: чтение env на старте, axios с таймаутом 15 сек, единственный экспортируемый метод `blockDates({ objectId, dateFrom, dateTo, externalRef })`.
> 2. Логи строго `[realtycalendar] blockDates: ...` / `[realtycalendar] Ошибка blockDates: ...`.
> 3. Сервис ничего не знает про Notion и не проверяет `source` — это ответственность роута (NFR-8).
> 4. Если точный путь/формат RC API не определён — оставь TODO с заметным комментом и реализуй заглушку, которая делает реальный POST на `<API_URL>/objects/<objectId>/block` с `{ date_from, date_to, external_ref }` (это гипотеза, потом уточним).
> 5. Опционально добавь `tests/test_realtycalendar.js` (один тест с моком axios или реальным вызовом, если ключи есть).
> 6. Прогони регрессионный набор — все зелёные.

---

## Шаг 8 — `routes/avito.js`: реальная интеграция Авито → Notion CRM `[backlog]` [from gap analysis]

**Цель:** Закрыть GAP-006 и GAP-007 — Авито-роут начинает писать каждый чат в Notion и обогащать LLM-контекстом из CRM.

**Связь с CR:** `CR-ADD-08`, `CR-ADD-09`, `CR-ADD-10`, `CR-CHG-03`. Реализует US-CHG-3.
**Источник в GAP_ANALYSIS:** GAP-006 (BLOCKING), GAP-007 (BLOCKING).

**Задачи:**
- [ ] В `routes/avito.js` после `avito.getToken()` и **до** `llm.generateReply`:
  - [ ] Вызвать `notion.findBookingByAvitoChatId(chatId)` (CR-ADD-08)
  - [ ] Если не найдено — `notion.createBooking({ bookingId: 'AVITO-${chatId}', source: 'Авито', avitoChatId: chatId, avitoItemId: payload.item_id || null, status: 'Ожидает подтверждения', name: ..., phone: ... })` (CR-ADD-09)
  - [ ] Если найдено и в payload пришли новые имя/телефон — `notion.updateBookingFields(pageId, { name, phone })` (CR-CHG-03)
  - [ ] Сформировать `context = { guestName, apartment, dateFrom, dateTo, totalPrice, source, status }` из записи Notion
- [ ] Заменить `llm.generateReply(text, {})` → `llm.generateReply(text, context)` (CR-ADD-10, SPEC FR-14)
- [ ] Каждый из новых вызовов — в **отдельном `try/catch`**: ошибка Notion не должна ломать отправку ответа гостю (NFR-3 + R-07 в `CHANGE_REQUEST.md` §6)
- [ ] `res.sendStatus(200)` остаётся **первым** действием
- [ ] Фильтры `payload.type === 'message'` и `author_id !== AVITO_USER_ID` не трогать
- [ ] Логи `[webhook/avito] findBookingByAvitoChatId: chatId=... found/created pageId=...`
- [ ] Расширить `tests/e2e_mock.js` сценарием «новый Авито-чат → в Notion появилась запись с `ID Брони = AVITO-{chatId}` и `Статус = Ожидает подтверждения`»; и сценарием «повторное сообщение в том же чате → нет дубликата»
- [ ] **Регрессия:**
  - [ ] `node tests/e2e_mock.js` — старые 5 + 2 новых PASS
  - [ ] Старый сценарий «собственное сообщение Авито игнорируется» — PASS
  - [ ] Боевой тест (если есть Авито-ключи): отправить сообщение в тестовый Авито-чат, проверить в Notion появление лида
  - [ ] Весь регрессионный набор зелёный

**Файлы:**
- `rent-agent/src/routes/avito.js` (минимальные правки: один новый блок между getToken и generateReply + один аргумент в generateReply)
- `rent-agent/tests/e2e_mock.js` (только аддитивно)

**Файлы, к которым НЕ прикасаемся:**
- `rent-agent/src/services/avito.js` (контракт стабилен — `CHANGE_REQUEST.md` §4)
- `rent-agent/src/services/llm.js`
- `rent-agent/src/routes/realtycalendar.js`, `routes/telegram.js`

**Как проверить:**
- В тесте отправляется mock-payload Авито с новым `chatId` → в Notion появляется запись с `ID Брони = AVITO-12345`, `Источник = Авито`, `Статус = Ожидает подтверждения`.
- Повторный mock-payload с тем же `chatId` → запись одна (дедуп через `createBooking` по `ID Брони`).
- В логах: `[webhook/avito] findBookingByAvitoChatId: chatId=... created pageId=...` (первый раз) и `... found pageId=...` (второй раз).
- LLM-ответ генерируется с непустым контекстом.

**Промпт для Cursor:**
> Контекст: `@TRACKER.md` `@SPECIFICATION.md` (US-CHG-3, FR-12, 13, 14) `@CHANGE_REQUEST.md` (CR-ADD-08, 09, 10; CR-CHG-03) `@ARCHITECTURE.md` (§3.4, §4.3, §9.2) `@GAP_ANALYSIS.md` (GAP-006, 007) `@rent-agent/src/routes/avito.js` `@rent-agent/src/services/notion.js`
>
> Мы выполняем Шаг 8 — реальная интеграция Авито с Notion CRM (GAP-006, GAP-007).
> 1. В `routes/avito.js` между `avito.getToken()` и `llm.generateReply(...)` вставь блок:
>    - `try { const found = await notion.findBookingByAvitoChatId(chatId); ... } catch (...)`
>    - Если не найдено — `notion.createBooking({ bookingId: \`AVITO-\${chatId}\`, source: 'Авито', avitoChatId: chatId, avitoItemId: payload.item_id || null, status: 'Ожидает подтверждения', ... })`.
>    - Если найдено и в payload есть имя/телефон — `notion.updateBookingFields(pageId, { name, phone })`.
>    - Собери `context = { guestName, apartment, dateFrom, dateTo, totalPrice, source, status }` из записи.
> 2. Замени `llm.generateReply(text, {})` → `llm.generateReply(text, context)`.
> 3. Каждый новый вызов — в отдельном try/catch; ошибка Notion не должна мешать отправке ответа гостю.
> 4. `res.sendStatus(200)` — по-прежнему первое действие. Фильтры `payload.type` и `author_id` не трогать. `services/avito.js` не трогать.
> 5. В `tests/e2e_mock.js` добавь два теста: «новый Авито-чат → лид создан» и «повторное сообщение в том же чате → нет дубликата».
> 6. Прогони регрессионный набор — все зелёные.

---

## Шаг 9 — `routes/telegram.js`: идентификация гостя (код брони + contact) `[backlog]` [from gap analysis]

**Цель:** Закрыть GAP-002 — реализовать матчинг гостя по коду брони (вариант A) и по `message.contact` (вариант B); записать `Telegram chat_id` в Notion при успешном матчинге.

**Связь с CR:** `CR-ADD-03`, `CR-ADD-04`, `CR-ADD-05`, `CR-CHG-02` (ветка `message.text` и новая ветка `message.contact`). Реализует US-CHG-1 и US-CHG-2.
**Источник в GAP_ANALYSIS:** GAP-002 (BLOCKING).

**Задачи:**
- [ ] В `routes/telegram.js` (ветка `update.message?.text`), внутри блока «бронь не найдена по chatId»:
  - [ ] Попытка 1: `notion.findBookingByBookingId(text.trim())` → если найдено → `notion.updateBookingFields(pageId, { telegramChatId: chatId })` → `generateReply(text, context)` → `sendMessage` (CR-ADD-03, CR-ADD-05)
  - [ ] Попытка 2 (если попытка 1 пуста): если `text` похож на телефон (≥10 цифр) → `notion.findBookingByPhone(text)` → как выше (CR-ADD-04)
  - [ ] Если обе попытки пусты → текущий fallback (consultationReply + однократная подсказка про привязку + notifyOwner)
- [ ] Новая ветка обработки `update.message?.contact`:
  - [ ] `notion.findBookingByPhone(contact.phone_number)` → если найдено → `updateBookingFields(pageId, { telegramChatId: chatId })` → `sendMessage(chatId, 'Готово, теперь я вас узнаю 👍')` (CR-ADD-04, CR-ADD-05)
  - [ ] Если не найдено → `sendMessage(chatId, 'Не нашла вашу бронь по этому номеру...')` + `notifyOwner`
- [ ] `res.sendStatus(200)` — первым действием
- [ ] Существующая успешная ветка (бронь найдена по `chatId`) **не меняется** (SPEC FR-5)
- [ ] Логи `[webhook/telegram] match by bookingId/phone/contact: ...`
- [ ] Расширить `tests/e2e_mock.js`:
  - [ ] Сценарий «гость прислал код брони» → запись Notion обновляется `Telegram chat_id`
  - [ ] Сценарий «гость прислал `contact`» → то же
  - [ ] Сценарий «второй раз тот же chatId → бронь находится сразу» (регресс на SPEC §2.2 критерий приёмки)
- [ ] **Регрессия:**
  - [ ] `node tests/e2e_mock.js` — старые + новые тесты PASS
  - [ ] Сценарий «неизвестный гость» (US-OK-4) — по-прежнему уведомляет владельца
  - [ ] Весь регрессионный набор зелёный

**Файлы:**
- `rent-agent/src/routes/telegram.js` (две новые ветки: ещё две попытки в `message.text` и новая ветка `message.contact`)
- `rent-agent/tests/e2e_mock.js` (только аддитивно)

**Файлы, к которым НЕ прикасаемся:**
- `rent-agent/src/services/{notion,llm,telegram}.js` (всё нужное добавлено в Шагах 5–6)
- `rent-agent/src/routes/{avito,realtycalendar}.js`

**Как проверить:**
- Отправить боту в Telegram строку с реальным `ID Брони` → бот отвечает контекстным сообщением, в Notion появилось `Telegram chat_id`.
- Отправить контакт через кнопку — то же.
- Второе сообщение в том же чате — обрабатывается через `findBookingByChatId`, без повторной привязки.
- Незнакомый текст — старое поведение «консультация + уведомление владельцу».

**Промпт для Cursor:**
> Контекст: `@TRACKER.md` `@SPECIFICATION.md` (US-CHG-1, US-CHG-2, FR-2, 3, 4, 5, 6) `@CHANGE_REQUEST.md` (CR-ADD-03, 04, 05; CR-CHG-02) `@ARCHITECTURE.md` (§3.2, §4.2) `@GAP_ANALYSIS.md` (GAP-002) `@rent-agent/src/routes/telegram.js`
>
> Мы выполняем Шаг 9 — идентификация гостя в Telegram (GAP-002).
> 1. В ветке `update.message?.text`, внутри блока «бронь по chatId не найдена», добавь две попытки матчинга:
>    - `notion.findBookingByBookingId(text.trim())` (регистронезависимо — нормализация в сервисе уже есть);
>    - если пусто и `text` похож на телефон (≥10 цифр после нормализации) — `notion.findBookingByPhone(text)`.
>    - При успешном матчинге: `notion.updateBookingFields(pageId, { telegramChatId: chatId })`, затем `generateReply` с контекстом и `sendMessage`.
>    - Если обе пусты — оставь текущий fallback + добавь однократную подсказку гостю.
> 2. Добавь новую ветку `update.message?.contact`: `findBookingByPhone(contact.phone_number)` → `updateBookingFields(pageId, { telegramChatId: chatId })` → `sendMessage('Готово...')`. Если не найдено — `sendMessage('Не нашла бронь...')` + `notifyOwner`.
> 3. `res.sendStatus(200)` — первым действием. Существующую ветку «бронь найдена по chatId» **не трогай**.
> 4. Логи `[webhook/telegram] match by bookingId/phone/contact: ...`.
> 5. В `tests/e2e_mock.js` — три новых сценария (код брони, contact, повторный chatId).
> 6. Прогони регрессионный набор. Зелёный — коммит.

---

## Шаг 10 — `routes/telegram.js` + `routes/realtycalendar.js`: смена статуса владельцем `[backlog]` [from gap analysis]

**Цель:** Закрыть GAP-004 — владелец меняет статусы броней inline-кнопками в Telegram; RC-уведомление обзаводится клавиатурой.

**Связь с CR:** `CR-ADD-07`, `CR-CHG-04`, `CR-ADD-06` (фактически — потребление в роуте). Реализует US-CHG-4.
**Источник в GAP_ANALYSIS:** GAP-004 (BLOCKING, accepted в скоуп).

**Задачи:**
- [ ] В `routes/telegram.js` — новая ветка `update.callback_query`:
  - [ ] Гард: `callback_query.from.id === Number(process.env.TELEGRAM_OWNER_CHAT_ID)`. Иначе `telegram.answerCallbackQuery(id, 'Нет доступа')`, выход (SPEC FR-11)
  - [ ] Парсинг `callback_data` формата `action:{pageId}`. Для action ∈ {`status_confirmed`, `status_checkedin`, `status_completed`, `status_cancelled`}:
    - [ ] Валидация допустимого перехода по таблице из `CHANGE_REQUEST.md` §1.3 (CR-ADD-07). Недопустимый переход → `console.error` + `answerCallbackQuery('Недопустимый переход')`
    - [ ] `notion.updateBookingStatus(pageId, status)` (SPEC FR-8, FR-9)
    - [ ] `telegram.answerCallbackQuery(id, 'Статус обновлён ✓')`
  - [ ] Action `confirm_booking:{pageId}` — отложить на Шаг 11; пока — `answerCallbackQuery(id, 'TODO Шаг 11')`
- [ ] В `routes/realtycalendar.js` заменить **одну строку**: `telegram.notifyOwner(html)` → `telegram.notifyOwnerWithActions(html, statusKeyboard)`, где `statusKeyboard` — `[[Заехал, Завершена], [Отменена]]` с `callback_data` формата `status_*:{pageId}` (CR-CHG-04). **Больше в этом файле ничего не меняется** (защита от регрессии US-OK-1 — R-02)
- [ ] Логи `[webhook/telegram] callback_query: action=... pageId=...`
- [ ] Расширить `tests/e2e_mock.js`:
  - [ ] Сценарий «не-владелец нажал кнопку → 'Нет доступа'»
  - [ ] Сценарий «валидный переход → Notion-статус обновился, `answerCallbackQuery` вызван»
  - [ ] Сценарий «недопустимый переход → ошибка, статус не меняется»
- [ ] **Регрессия:**
  - [ ] `node tests/e2e_mock.js` (старые + новые) — PASS
  - [ ] **US-OK-1 регресс:** ручной тест — отправить mock RC-вебхук, проверить, что в Telegram пришло уведомление **с кнопками** (R-02 в `CHANGE_REQUEST.md` §6)
  - [ ] Весь регрессионный набор зелёный

**Файлы:**
- `rent-agent/src/routes/telegram.js` (новая ветка `callback_query`)
- `rent-agent/src/routes/realtycalendar.js` (**одна строка**: `notifyOwner` → `notifyOwnerWithActions`)
- `rent-agent/tests/e2e_mock.js` (только аддитивно)

**Файлы, к которым НЕ прикасаемся:**
- `rent-agent/src/services/*.js`
- `routes/avito.js`

**Как проверить:**
- Реальный mock RC-вебхук → в Telegram уведомление с кнопками `Заехал | Завершена | Отменена`.
- Нажатие на кнопку владельцем → в Notion `Статус` меняется, в чате появляется «часики уходят» + текст подтверждения.
- Нажатие на кнопку другим аккаунтом → «Нет доступа».
- Недопустимый переход (например, из `Отменена` куда-то) → ошибка, статус не меняется.

**Промпт для Cursor:**
> Контекст: `@TRACKER.md` `@SPECIFICATION.md` (US-CHG-4, FR-8, 9, 10, 11) `@CHANGE_REQUEST.md` (CR-ADD-07; CR-CHG-04; таблица переходов §1.3) `@ARCHITECTURE.md` (§3.2 ветка 3, §4.4) `@GAP_ANALYSIS.md` (GAP-004) `@rent-agent/src/routes/telegram.js` `@rent-agent/src/routes/realtycalendar.js`
>
> Мы выполняем Шаг 10 — кнопки статусов владельца (GAP-004).
> 1. В `routes/telegram.js` добавь ветку `update.callback_query`:
>    - Гард `from.id === Number(process.env.TELEGRAM_OWNER_CHAT_ID)`, иначе `answerCallbackQuery('Нет доступа')`.
>    - Парсинг `callback_data` формата `action:pageId`. Для `status_*` — валидация перехода (используй таблицу из `CHANGE_REQUEST.md` §1.3 как константу `ALLOWED_TRANSITIONS`), `notion.updateBookingStatus`, `answerCallbackQuery`.
>    - Для `confirm_booking` — пока заглушка `answerCallbackQuery('TODO Шаг 11')`.
> 2. В `routes/realtycalendar.js` замени `telegram.notifyOwner(html)` на `telegram.notifyOwnerWithActions(html, statusKeyboard)`. **Это единственная правка в этом файле**, остальное не трогать (риск R-02).
> 3. Сформируй `statusKeyboard` — массив рядов кнопок с `callback_data` формата `status_*:{pageId}`. Формат строго совпадает с `ARCHITECTURE.md` §3.6.
> 4. В `tests/e2e_mock.js` — три новых сценария (не-владелец, валидный переход, недопустимый).
> 5. Прогони регрессионный набор. **Дополнительно вручную:** mock RC-вебхук → проверь, что уведомление пришло с кнопками. Если красное — стоп, см. раздел «Что делать, если шаг не получается».

---

## Шаг 11 — `routes/telegram.js`: confirm_booking → `realtycalendar.blockDates` `[backlog]`

**Цель:** Реализовать обратное направление двунаправленной синхронизации (US-CHG-6): по нажатию `Подтвердить бронь` агент блокирует даты в RC, что пробрасывается в ЦИАН/Яндекс.

**Связь с CR:** `CR-ADD-14` (главное), использует `CR-ADD-12` (сервис из Шага 7) и `CR-CHG-05` (методы Notion из Шага 5).
**Источник:** SPEC FR-15, FR-16, FR-17, NFR-8, NFR-9, US-CHG-6.

**Задачи:**
- [ ] В `routes/telegram.js`, в ветке `callback_query`, action `confirm_booking:{pageId}` (заглушка из Шага 10):
  - [ ] Гард owner — уже есть из Шага 10
  - [ ] Загрузить запись Notion (новый метод — например, `notion.findBookingByPageId(pageId)` — добавить в `services/notion.js` если ещё нет; либо переиспользовать существующий)
  - [ ] **Гард от петли:** если `booking.source ∈ {'Яндекс Аренда', 'ЦИАН'}` → `answerCallbackQuery('Бронь уже из RC, синхронизация не нужна')`, выход (NFR-8)
  - [ ] **Гард идемпотентности:** если `booking.rcSynced === true` → `answerCallbackQuery('Уже синхронизировано ✓')`, выход (FR-17)
  - [ ] Валидация: `dateFrom` и `dateTo` заполнены, иначе `answerCallbackQuery('Укажите даты в CRM')` (см. ARCH §4.5)
  - [ ] `realtycalendar.blockDates({ objectId: process.env.REALTYCALENDAR_OBJECT_ID, dateFrom, dateTo, externalRef: pageId })`
  - [ ] При успехе: `notion.updateBookingFields(pageId, { status: 'Подтверждена', rcSynced: true })` + `answerCallbackQuery('Даты заблокированы в ЦИАН и Яндексе ✓')` + `notifyOwner('✅ Бронь подтверждена, ЦИАН и Яндекс обновлены')`
  - [ ] При ошибке RC: `console.error`, оставить `rcSynced=false`, `answerCallbackQuery('Ошибка RC, попробуйте ещё раз')`
- [ ] **Где появляется кнопка `confirm_booking`?** При создании Авито-черновика (Шаг 8) уведомления владельцу пока нет. Расширить Шаг 8 не будем — вместо этого: добавить в `routes/avito.js` отправку владельцу `notifyOwnerWithActions(...)` с кнопками `Подтвердить бронь` + `Отменена` для нового лида. Это **аддитивная правка** одной строки в `routes/avito.js` (CR-CHG-03 уже разрешает её)
- [ ] Логи `[webhook/telegram] confirm_booking: pageId=... source=... rcSynced=...`
- [ ] Расширить `tests/e2e_mock.js`:
  - [ ] Сценарий «бронь с source=Авито, dates присутствуют → blockDates вызван, rcSynced=true»
  - [ ] Сценарий «бронь с source=ЦИАН → blockDates НЕ вызван (защита от петли)»
  - [ ] Сценарий «повторное нажатие на уже синхронизированной → blockDates НЕ вызван (идемпотентность)»
- [ ] **Регрессия:**
  - [ ] Все тесты PASS
  - [ ] Ручной тест (если есть боевые ключи RC) — реальная бронь, реальный блок дат

**Файлы:**
- `rent-agent/src/routes/telegram.js` (расширение ветки `confirm_booking`)
- `rent-agent/src/routes/avito.js` (добавить `notifyOwnerWithActions` для нового лида — одна строка)
- `rent-agent/src/services/notion.js` (если нужен `findBookingByPageId` — добавить минимальную функцию, иначе использовать `notion.pages.retrieve` через существующий `parseNotionPage`)
- `rent-agent/tests/e2e_mock.js` (только аддитивно)

**Файлы, к которым НЕ прикасаемся:**
- `rent-agent/src/services/realtycalendar.js` (контракт из Шага 7 уже стабилен)
- `rent-agent/src/services/{avito,llm,telegram}.js`

**Как проверить:**
- В Telegram владельцу приходит уведомление о новом Авито-лиде с кнопкой `Подтвердить бронь`.
- Нажатие → в логах `[realtycalendar] blockDates: ...`, в Notion `Синхронизировано с RC = true`, `Статус = Подтверждена`, владельцу подтверждение.
- Повторное нажатие — мгновенное `Уже синхронизировано ✓`, реального вызова RC нет.
- Сценарий с `source=ЦИАН` — кнопка не появляется (или появляется, но вызов отбивается гардом).

**Промпт для Cursor:**
> Контекст: `@TRACKER.md` `@SPECIFICATION.md` (US-CHG-6, FR-15, 16, 17, NFR-8, 9) `@CHANGE_REQUEST.md` (CR-ADD-14) `@ARCHITECTURE.md` (§4.5, §3.9) `@rent-agent/src/routes/telegram.js` `@rent-agent/src/routes/avito.js` `@rent-agent/src/services/realtycalendar.js`
>
> Мы выполняем Шаг 11 — confirm_booking → blockDates (US-CHG-6).
> 1. В `routes/telegram.js`, ветка `callback_query`, action `confirm_booking:{pageId}`:
>    - Загрузи запись Notion по pageId (добавь `findBookingByPageId` в `services/notion.js`, если такого нет).
>    - Гард: source ∈ {'Яндекс Аренда','ЦИАН'} → `answerCallbackQuery('Бронь уже из RC...')`.
>    - Гард: rcSynced === true → `answerCallbackQuery('Уже синхронизировано ✓')`.
>    - Гард: dateFrom/dateTo пусты → `answerCallbackQuery('Укажите даты в CRM')`.
>    - `realtycalendar.blockDates({ objectId: process.env.REALTYCALENDAR_OBJECT_ID, dateFrom, dateTo, externalRef: pageId })`.
>    - При успехе: `updateBookingFields(pageId, { status: 'Подтверждена', rcSynced: true })`, `answerCallbackQuery`, `notifyOwner`.
>    - При ошибке: console.error + `answerCallbackQuery('Ошибка RC...')`.
> 2. В `routes/avito.js` после создания/обновления Notion-записи — отправляй владельцу `notifyOwnerWithActions(html, [[ Подтвердить бронь, Отменена ]])` с `callback_data` `confirm_booking:{pageId}` и `status_cancelled:{pageId}`.
> 3. В `tests/e2e_mock.js` — три сценария: успех, гард-петля, идемпотентность.
> 4. Прогони регрессионный набор. Зелёный — коммит.

---

## Шаг 12 — Сквозной end-to-end тест (предпоследний) `[backlog]`

**Цель:** Один интеграционный сценарий, прогоняющий **весь** TO-BE цикл: бронь по RC → блок Авито → уведомление с кнопками → гость в Telegram опознан → новый Авито-лид создан → владелец подтверждает → RC.blockDates вызван → Notion обновлён. Это финальный гейт перед документацией.

**Связь с CR:** проверяет совокупность всех CR-ADD/CR-CHG; покрывает SPEC §6.3 «Критерий готовности релиза TO-BE».

**Задачи:**
- [ ] Создать `tests/e2e_full_flow.js`. Пять последовательных шагов (моки, никаких реальных RC/Авито):
  1. POST `/webhook/realtycalendar` с `action=create_booking` → проверить, что в Notion появилась запись и владельцу пришло уведомление с кнопками `status_*`
  2. POST `/webhook/telegram` с `message.text = ID Брони` от нового `chat_id` → проверить, что `Telegram chat_id` записан, ответ ушёл с контекстом
  3. POST `/webhook/avito` с новым `chat_id` → проверить, что в Notion создан `AVITO-{chatId}` лид со статусом `Ожидает подтверждения`, владельцу — уведомление с кнопкой `Подтвердить бронь`
  4. POST `/webhook/telegram` с `callback_query` `confirm_booking:{pageId}` от владельца → проверить, что `realtycalendar.blockDates` вызван (через моки/spy), `rcSynced=true`, `Статус=Подтверждена`
  5. POST `/webhook/telegram` с тем же `confirm_booking` повторно → проверить, что `blockDates` **не** вызван второй раз (идемпотентность)
- [ ] Все вебхуки получают `200 OK` ≤ 100 мс (NFR-2)
- [ ] Сценарий 4 при `source='ЦИАН'` тоже должен отбиваться гардом (NFR-8) — добавить отдельный мини-сценарий
- [ ] **Регрессия:**
  - [ ] `node tests/e2e_full_flow.js` — все сценарии PASS
  - [ ] Полный регрессионный набор + `e2e_full_flow.js` зелёный
  - [ ] Сравнить вывод регрессии с `tests/baseline.log` — список изначально зелёных тестов должен остаться зелёным (либо иметь зафиксированное в коммите объяснение почему изменился)

**Файлы:**
- `rent-agent/tests/e2e_full_flow.js` (новый, чисто тестовый)
- `rent-agent/src/*` — **не трогаем** (любая правка прод-кода на этом шаге — сигнал, что Шаги 8–11 что-то упустили)

**Как проверить:**
- Один файл, пять сценариев, все PASS. В Notion видны:
  - Бронь от RC (Статус `Подтверждена`, `Синхронизировано с RC = false` — её владелец не подтверждал отдельно)
  - Лид от Авито (Статус `Подтверждена`, `Синхронизировано с RC = true` — после Шага 4 теста)
  - У RC-брони и Авито-лида заполнено `Telegram chat_id` / `Авито chat_id` соответственно
- В логах нет необработанных `console.error` (кроме намеренных гардов).

**Промпт для Cursor:**
> Контекст: `@TRACKER.md` `@SPECIFICATION.md` (§6.3 «Критерий готовности релиза») `@CHANGE_REQUEST.md` `@ARCHITECTURE.md` `@rent-agent/tests/e2e_mock.js` `@rent-agent/src/routes` `@rent-agent/src/services`
>
> Мы выполняем Шаг 12 — сквозной e2e-тест. Прод-код не трогаем.
> 1. Создай `rent-agent/tests/e2e_full_flow.js`. Используй supertest или axios + поднятие приложения как в `e2e_mock.js`.
> 2. Реализуй 5 последовательных шагов (RC → TG match → Avito лид → confirm_booking → повторный confirm_booking) с моками внешних API (Notion, axios для OpenRouter/Avito/RC). Спросом моки делай через `sinon` или ручную подмену (как удобнее в проекте — посмотри `e2e_mock.js`).
> 3. Между шагами читай состояние Notion через `notion.findBookingByBookingId` / `findBookingByAvitoChatId` и проверяй ожидаемые значения полей.
> 4. Добавь мини-сценарий «бронь с source=ЦИАН → confirm_booking отбивается гардом».
> 5. Прогони весь регрессионный набор + `e2e_full_flow.js`. Сравни с `tests/baseline.log` — должно быть строго не хуже. Зелёное → переходим к Шагу 13.

---

## Шаг 13 — README + runbook (последний) `[backlog]`

**Цель:** Превратить `README.md` в рабочую инструкцию по развёртыванию, настройке вебхуков и эксплуатации TO-BE-системы.

**Связь с CR:** `CR-ADD-11` (документация регистрации Авито-вебхука), плюс пункты из `CHANGE_REQUEST.md` §7.4–7.5 (миграция `.env`, инфраструктурные шаги).

**Задачи:**
- [ ] В `rent-agent/README.md` написать разделы:
  - [ ] **Быстрый старт:** `git clone` → `cd rent-agent && npm install` → `cp .env.example .env` → заполнить → `node index.js`
  - [ ] **Notion-миграция** (`CHANGE_REQUEST.md` §7.2): чек-лист из 5 шагов с предупреждением «выполнить ДО деплоя»
  - [ ] **Регистрация вебхука Telegram:** `curl` к `setWebhook` с `<PUBLIC_URL>/webhook/telegram`
  - [ ] **Регистрация вебхука Авито (FR-18, CR-ADD-11):** как прописать URL в кабинете Авито или через API подписки на события Messenger; проверка боевым сообщением
  - [ ] **RealtyCalendar (исходящий API):** где взять `REALTYCALENDAR_API_URL/TOKEN/OBJECT_ID`; тест блокировки одной даты
  - [ ] **Локальный тест через ngrok**
  - [ ] **Деплой:** Railway / Render — переменные окружения через UI платформы (NFR-1, риск R-05)
  - [ ] **Эндпоинты:** таблица из `ARCHITECTURE.md` §12
  - [ ] **Чек-лист релиза:** из `SPECIFICATION.md` §6.3
  - [ ] **Известные ограничения:** `DEMO_MODE`, одна квартира на один `REALTYCALENDAR_OBJECT_ID`, верификация подписей вне скоупа (см. SPEC §6.1)
- [ ] Сделать grep-проверку: в README нет хардкоженных токенов / личных chat_id / реальных URL аккаунта
- [ ] **Регрессия:**
  - [ ] Полный регрессионный набор + `e2e_full_flow.js` зелёный (никаких изменений кода не было; запускаем для уверенности)
  - [ ] Перепрочитать README глазами «нового разработчика»: после клона + следования инструкции — система стартует и здоровый ответ `GET /health` приходит

**Файлы:**
- `rent-agent/README.md` (полная переработка)
- `rent-agent/src/*`, `rent-agent/tests/*` — **не трогаем**

**Как проверить:**
- README читается от начала до конца без отсылок «см. где-то ещё» к ненаписанным разделам.
- Все команды из README выполняются на чистой машине без ошибок (включая `npm install`, регистрацию TG-вебхука, health-check).
- В чек-листе релиза галочки можно проставить по итогам Шага 12.

**Промпт для Cursor:**
> Контекст: `@TRACKER.md` `@SPECIFICATION.md` `@ARCHITECTURE.md` (§7, 10, 12) `@CHANGE_REQUEST.md` (CR-ADD-11; §7.2, 7.4, 7.5) `@AS_IS.md` `@rent-agent/README.md` `@rent-agent/.env.example`
>
> Мы выполняем Шаг 13 — финальный README и runbook. Код не трогаем.
> 1. Перепиши `rent-agent/README.md` со всеми разделами из чек-листа Шага 13 в `TRACKER.md`.
> 2. В разделе «Notion-миграция» — пошаговый чек-лист из `CHANGE_REQUEST.md` §7.2 с явным предупреждением «выполнить ДО деплоя».
> 3. В разделе «Регистрация вебхука Авито» — инструкция: где в кабинете Авито прописать `<PUBLIC_URL>/webhook/avito`, как проверить боевым сообщением (CR-ADD-11, FR-18).
> 4. В «Известных ограничениях» сослись на `SPECIFICATION.md` §6.1 — не дублируй текст.
> 5. Запусти регрессионный набор и `e2e_full_flow.js` ещё раз — для финальной уверенности. Зелёное → проставляй галочки в чек-листе релиза `SPECIFICATION.md` §6.3.

---

## Сводка прогресса

| # | Шаг | Категория | Связь с CR / GAP | Статус |
|---|-----|-----------|------------------|--------|
| 1 | Baseline: проверка каркаса и регрессия | Каркас + baseline | — | `[done]` |
| 2 | Очистка устаревших упоминаний | Документация | CR-DEL-01, 02, 03, 05 / GAP-010, 011, 012 (OBSOLETE) | `[done]` [from gap analysis] |
| 3 | `.env` в `rent-agent/` + dotenv path | Инфраструктура | CR-ADD-01, 02; CR-CHG-01, 07; CR-DEL-04 / GAP-001 | `[done]` [from gap analysis] |
| 4 | Миграция схемы Notion (без кода) | Внешняя инфраструктура | CR-ADD-13, 15 | `[done]` |
| 5 | `services/notion.js`: новые методы | Сервис | CR-CHG-05 | `[done]` |
| 6 | `services/telegram.js`: inline-кнопки | Сервис | CR-ADD-06, CR-CHG-06 | `[done]` |
| 7 | Новый сервис `services/realtycalendar.js` | Сервис | CR-ADD-12 | `[backlog]` |
| 8 | `routes/avito.js`: Авито → Notion CRM | Роут / бизнес-логика | CR-ADD-08, 09, 10; CR-CHG-03 / GAP-006, 007 | `[backlog]` [from gap analysis] |
| 9 | `routes/telegram.js`: идентификация гостя | Роут / бизнес-логика | CR-ADD-03, 04, 05; CR-CHG-02 / GAP-002 | `[backlog]` [from gap analysis] |
| 10 | `routes/telegram.js` + RC-роут: смена статуса | Роут / бизнес-логика | CR-ADD-07, CR-CHG-04 / GAP-004 | `[backlog]` [from gap analysis] |
| 11 | `routes/telegram.js`: confirm_booking → blockDates | Роут / бизнес-логика | CR-ADD-14 | `[backlog]` |
| 12 | Сквозной end-to-end тест | Тестирование | проверяет всё | `[backlog]` |
| 13 | README + runbook | Документация | CR-ADD-11 | `[backlog]` |

---

## Что делать, если шаг не получается

Шпаргалка для случаев, когда чек-боксы упрямо не закрываются.

### 1. Регрессия покраснела после шага

1. Сравнить вывод с `tests/baseline.log` (Шаг 1) — какой именно тест добавился в FAIL.
2. Если упал тест, **не связанный** с темой шага — это «попутный сломанный кусок». Откат изменений этого шага через `git stash` и поиск виновника по самой узкой возможной диф-зоне.
3. Если упал тест, **связанный** с темой шага, — значит изменения сломали контракт. Перечитать `CHANGE_REQUEST.md` §4 (что нельзя трогать) и `ARCHITECTURE.md` §8 (минимальное вторжение).
4. Не «чинить тест» подгонкой ожидаемых значений под фактические — это маскирует баг.

### 2. Notion API возвращает 400 / property not found

- Скорее всего пропущен Шаг 4 (миграция схемы) или интеграции не выдали права `Update content`.
- Проверь `node tests/diagnose_notion.js` — он выводит схему. Если поля `Синхронизировано с RC` нет — вернись в Шаг 4.
- Если ошибка `Invalid status select option` — проверь, что в `Статус` действительно добавлены `Ожидает подтверждения` и `Заехал` (CR-ADD-15).

### 3. После Шага 3 переменные окружения всё ещё не подхватываются

- `console.log(process.env.NOTION_TOKEN ? 'OK' : 'MISSING')` в самом начале `index.js` (после `dotenv.config`) — для быстрой диагностики.
- Проверь, что `rent-agent/.env` действительно лежит **рядом** с `index.js` (не в `rent-agent/src/.env`!).
- На Railway/Render `.env` файл вообще не используется — переменные задаются в UI платформы.

### 4. Кнопки Telegram не работают (нет реакции)

- Самая частая причина — рассинхрон формата `callback_data` между Шагом 6 (где формируется) и Шагом 10 (где парсится). Формат **жёстко зафиксирован** в `ARCHITECTURE.md` §3.6 — сверить байт-в-байт.
- Логи `[webhook/telegram] callback_query: action=... pageId=...` должны печататься на каждое нажатие. Если их нет — Telegram даже не доходит до роута (проверь регистрацию вебхука).
- Проверь, что `bot` создан без `polling: true` (иначе кнопки идут в polling, а вебхук молчит).

### 5. `realtycalendar.blockDates` падает с 404 / 401 / непонятным форматом

- Сервис написан на гипотезе об API RC (см. TODO в Шаге 7). Это известный риск R-04 в `CHANGE_REQUEST.md` §6.
- Перевести шаг в `[blocked]`, написать в RC support за документацией.
- В ожидании ответа: мокать `blockDates` (возвращать `{ rcBookingId: 'MOCK' }`) — это позволит продолжить Шаги 11–12 на тестах и не блокировать остальную команду.

### 6. RC-уведомление перестало приходить после Шага 10

- Это R-02 из `CHANGE_REQUEST.md` §6 — самый болезненный регресс.
- Быстрый откат: вернуть в `routes/realtycalendar.js` одну строку `telegram.notifyOwner(html)` (старая функция жива, специально не удалена).
- После отката — отдельно разбираться, что не так с `notifyOwnerWithActions` / `sendMessageWithKeyboard` (Шаг 6).

### 7. Авито в production уходит в demo, хотя ключи есть

- Проверь `NODE_ENV=production` и что Шаг 3 (CR-DEL-04) реально на месте: при пустых `AVITO_CLIENT_ID/SECRET` в production агент **должен падать**, а не молча запускаться.
- `console.log` в самом начале `services/avito.js` — `isDemoMode` value.

### 8. Дублирующиеся лиды Авито в Notion

- Симптом: каждое сообщение в одном чате создаёт новую запись.
- Причина: `createBooking` дедуплицирует по `ID Брони`, а не по `Авито chat_id`. Убедись, что в Шаге 8 `bookingId` строится строго как `AVITO-{chatId}` — иначе дедуп не работает.
- Дополнительно: проверь, что `findBookingByAvitoChatId` ищет по правильному имени поля (`Авито chat_id`, не `avitoChatId`).

### 9. Шаг превратился в «слишком большой»

- Если PR раздувается больше чем на 1 файл реализации + 1 файл тестов — значит шаг не атомарный, и план врёт.
- Остановиться, разбить шаг на 2–3 подшага в `TRACKER.md` (вставкой между нынешними), каждый — со своим CR-id и регрессией.
- Лучше 16 атомарных шагов, чем 13 «почти атомарных», но с непредсказуемыми ревью.

### 10. Не удаётся прогнать регрессию на конкретной машине

- Это инфраструктурная блокировка, **а не** проблема шага.
- Перевести шаг в `[blocked]`, описать в комментарии причину (нет ключа от Notion, нет интернета, сломан Node).
- Не двигаться вперёд: следующие шаги зависят от подтверждённой регрессии предыдущего.

---

*Связанные документы: `AS_IS.md` · `GAP_ANALYSIS.md` · `SPECIFICATION.md` · `ARCHITECTURE.md` · `CHANGE_REQUEST.md`*
