# Rental AI Agent

AI-агент для посуточной аренды квартир. Принимает вебхуки от **Telegram**, **RealtyCalendar** и **Авито**, ведёт CRM в **Notion**, отвечает гостям через LLM (OpenRouter).

**Стек:** Node.js 18+ · Express · Notion · OpenRouter · Telegram Bot API · Авито STR API · RealtyCalendar API.

Связанные документы: [`SPECIFICATION.md`](SPECIFICATION.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`TRACKER.md`](TRACKER.md) · [`CHANGE_REQUEST.md`](CHANGE_REQUEST.md).

---

## Быстрый старт

```bash
git clone <URL-репозитория>
cd rent-agent
npm install
cp .env.example .env
# Заполните .env — см. раздел «Переменные окружения» ниже
node index.js
```

Проверка:

```bash
curl -s http://localhost:3000/health
# {"status":"ok","uptime":...}
```

Альтернатива с автоперезапуском: `npm run dev` (nodemon).

При успешном старте в логах: `Rental AI Agent запущен на http://localhost:3000`.

### Telegram proxy (RU-серверы)

Если с VPS нет прямого доступа к `api.telegram.org` (ошибка `ETIMEDOUT 149.154.x.x`), входящий webhook работает через nginx, но **исходящие** вызовы Bot API (`sendMessage`, `answerCallbackQuery`) нужно пустить через локальный Xray:

1. На сервере: Xray **mixed** inbound на `127.0.0.1:10808`, outbound на VPN exit (NL).
2. В `.env`:

```env
TELEGRAM_PROXY=socks5://127.0.0.1:10808
```

3. Проверка:

```bash
curl -x socks5h://127.0.0.1:10808 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
node tests/diagnose_telegram.js
```

Без блокировки `TELEGRAM_PROXY` не задавайте — агент ходит в Telegram напрямую.

---

## Переменные окружения

Шаблон — [`.env.example`](.env.example). Файл `rent-agent/.env` **не коммитится** в git.

| Группа | Переменные | Где взять |
|--------|-----------|-----------|
| Сервер | `PORT`, `NODE_ENV`, `DEMO_MODE` | `PORT` по умолчанию 3000; в production `DEMO_MODE=false` |
| Notion CRM | `NOTION_TOKEN`, `NOTION_DATABASE_ID` | [notion.so/my-integrations](https://www.notion.so/my-integrations) |
| LLM | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, … | [openrouter.ai/keys](https://openrouter.ai/keys) |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID`, `TELEGRAM_PROXY` (опц.) | @BotFather; chat_id — через `/start` и логи бота; proxy — см. ниже |
| Авито | `AVITO_CLIENT_ID`, `AVITO_CLIENT_SECRET`, `AVITO_USER_ID` | [developers.avito.ru](https://developers.avito.ru) → приложение → ключи |
| RC (входящий) | `REALTYCALENDAR_WEBHOOK_SECRET` | Опционально; верификация подписи — вне текущего скоупа |
| RC (исходящий) | `REALTYCALENDAR_API_URL`, `REALTYCALENDAR_API_TOKEN`, `REALTYCALENDAR_OBJECT_ID` | Кабинет RealtyCalendar → API / Объекты |

### Миграция `.env` (CHANGE_REQUEST §7.4)

Если раньше `.env` лежал в корне репозитория:

1. Скопируйте `AI-rent-agent/.env` → `rent-agent/.env`.
2. Добавьте три переменные RC (исходящий API) из `.env.example`.
3. Убедитесь, что `rent-agent/.env` в `.gitignore`.
4. Старый корневой `.env` агент больше не читает — можно удалить.

---

## Notion-миграция

> **⚠️ Выполнить ДО деплоя нового кода.**  
> Иначе агент не сможет записывать `Синхронизировано с RC` и статусы лидов Авито (риск R-01 в `CHANGE_REQUEST.md`).

Пошаговый чек-лист (из `CHANGE_REQUEST.md` §7.2):

- [ ] **Шаг 1.** Открыть базу «Брони» в Notion.
- [ ] **Шаг 2.** Добавить поле **`Синхронизировано с RC`** — тип **Checkbox** («+ New property» → Checkbox). Старые записи получат `false` — это нормально.
- [ ] **Шаг 3.** В поле **`Статус`** (Select) добавить опцию **`Ожидает подтверждения`** (Edit property → Add option).
- [ ] **Шаг 4.** В поле **`Статус`** добавить опцию **`Заехал`**.
- [ ] **Шаг 5.** Проверить, что интеграция Notion имеет право **Update content** (Settings → Connections → Integration permissions). Без этого `updateBookingFields` вернёт 403.
- [ ] **Шаг 6.** Задеплоить новый код.

**Откат:** удалить поле `Синхронизировано с RC`, убрать новые опции из `Статус`, откатить коммит агента.

Подробнее о схеме: `ARCHITECTURE.md` §5.3, §10.

---

## Регистрация вебхука Telegram

Telegram Bot API принимает только **HTTPS** URL. После деплоя (или через ngrok локально) зарегистрируйте вебхук:

```bash
export TELEGRAM_BOT_TOKEN="<ваш-токен-из-BotFather>"
export PUBLIC_URL="https://your-app.example.com"

curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${PUBLIC_URL}/webhook/telegram"
```

Ожидаемый ответ: `{"ok":true,...}`.

Проверка:

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
# В поле "url" должен быть ${PUBLIC_URL}/webhook/telegram
```

Напишите боту `/start` — в логах агента появится `[webhook/telegram] ...`.

---

## Регистрация вебхука Авито (FR-18, CR-ADD-11)

Агент слушает **`POST /webhook/avito`**. URL для регистрации:

```
<PUBLIC_URL>/webhook/avito
```

Пример: `https://your-app.example.com/webhook/avito`.

### Способ A — через API (рекомендуется)

1. Получите OAuth2-токен (Client Credentials), как в `services/avito.js`:

```bash
export AVITO_CLIENT_ID="<client_id>"
export AVITO_CLIENT_SECRET="<client_secret>"
export PUBLIC_URL="https://your-app.example.com"

TOKEN=$(curl -s -X POST "https://api.avito.ru/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=${AVITO_CLIENT_ID}&client_secret=${AVITO_CLIENT_SECRET}" \
  | jq -r '.access_token')

curl -s -X POST "https://api.avito.ru/messenger/v3/webhook" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${PUBLIC_URL}/webhook/avito\"}"
```

2. Проверьте подписку:

```bash
curl -s "https://api.avito.ru/messenger/v1/subscriptions" \
  -H "Authorization: Bearer ${TOKEN}"
```

В ответе должен быть ваш URL.

### Способ B — через кабинет Авито

1. Войдите в [developers.avito.ru](https://developers.avito.ru) под аккаунтом с доступом к **Messenger API**.
2. Откройте зарегистрированное приложение (тот же `AVITO_CLIENT_ID`).
3. В разделе **Messenger / Webhooks** (или «Подписки на события») укажите URL: `<PUBLIC_URL>/webhook/avito`.
4. Сохраните. Убедитесь, что endpoint доступен из интернета и отвечает **200 OK** на POST (агент отвечает сразу, до обработки).

> Если в UI кабинета нет поля webhook — используйте **Способ A** (API `messenger/v3/webhook`). Документация: [developers.avito.ru/api-catalog/messenger](https://developers.avito.ru/api-catalog/messenger/documentation).

### Проверка боевым сообщением

1. Убедитесь: `DEMO_MODE=false`, в `.env` заполнены `AVITO_CLIENT_ID`, `AVITO_CLIENT_SECRET`, `AVITO_USER_ID`.
2. Откройте объявление на Авито **с другого аккаунта** (не `AVITO_USER_ID`) и отправьте сообщение в чат.
3. В логах агента должна появиться строка:

```
[webhook/avito] Новое сообщение в чате <chat_id>: "..."
```

4. В Notion — новая запись с `ID Брони` = `AVITO-{chat_id}`, статус `Ожидает подтверждения`.
5. В Telegram владельцу — уведомление с кнопками «Подтвердить бронь» / «Отменена».

Если сообщение не приходит: проверьте `get subscriptions`, доступность HTTPS URL, firewall хостинга и что webhook зарегистрирован на **тот же** `PUBLIC_URL`, где крутится агент.

---

## RealtyCalendar (исходящий API)

Переменные для блокировки дат в ЦИАН/Яндекс через RC (US-CHG-6):

| Переменная | Где взять |
|------------|-----------|
| `REALTYCALENDAR_API_URL` | Документация / поддержка RC; в `.env.example` — `https://realtycalendar.ru/api/v2` |
| `REALTYCALENDAR_API_TOKEN` | Кабинет RealtyCalendar → настройки API / интеграции |
| `REALTYCALENDAR_OBJECT_ID` | Кабинет RC → **Объекты** → ID нужной квартиры |

> **Контракт API:** точный endpoint может отличаться (риск R-04). Текущая реализация: `POST /objects/{objectId}/block`. Уточните у поддержки RC при первом подключении.

### Тест блокировки одной даты

1. Заполните три переменные RC в `.env`, перезапустите агента.
2. Создайте тестовую запись в Notion (источник `Авито`, заполнены `Даты`, `rcSynced=false`) или дождитесь Авито-лида.
3. В Telegram нажмите **«Подтвердить бронь»**.
4. В логах: `[realtycalendar] blockDates: objectId=...`.
5. В Notion: `Синхронизировано с RC` = ✓, `Статус` = `Подтверждена`.
6. В календаре RC (и подключённых агрегаторах) — даты заняты.

Unit-smoke без реального RC:

```bash
node tests/test_realtycalendar.js
```

---

## Локальный тест через ngrok

Внешние сервисы (Telegram, Авито, RealtyCalendar) не видят `localhost`. Для отладки:

```bash
# Терминал 1
cd rent-agent && node index.js

# Терминал 2
ngrok http 3000
# Скопируйте HTTPS URL, например https://abc123.ngrok-free.app
export PUBLIC_URL="https://abc123.ngrok-free.app"
```

Далее:

1. `setWebhook` для Telegram → `${PUBLIC_URL}/webhook/telegram`
2. Подписка Авито → `${PUBLIC_URL}/webhook/avito`
3. В кабинете RealtyCalendar укажите входящий webhook → `${PUBLIC_URL}/webhook/realtycalendar`

Проверка health через ngrok:

```bash
curl -s "${PUBLIC_URL}/health"
```

E2E без ngrok (in-process, без внешних API):

```bash
node tests/e2e_full_flow.js
node tests/e2e_mock.js   # требует запущенный node index.js на :3000
```

---

## Деплой (Railway / Render)

Агент — обычное Node.js-приложение. **Секреты задаются через UI платформы**, файл `.env` на сервере не обязателен (NFR-1, риск R-05).

### Общие шаги

1. Подключите репозиторий; **Root Directory** = `rent-agent`.
2. **Build:** `npm install`
3. **Start:** `node index.js` (или `npm start`)
4. **Node:** 18+
5. Скопируйте все переменные из `.env.example` в Environment Variables платформы.
6. Обязательно в production:
   - `NODE_ENV=production`
   - `DEMO_MODE=false`
   - Реальные `AVITO_CLIENT_ID`, `AVITO_CLIENT_SECRET`, `AVITO_USER_ID`
7. После деплоя — `GET https://<ваш-домен>/health` → `{"status":"ok",...}`.
8. Зарегистрируйте три вебхука (Telegram, Авито, RealtyCalendar) на публичный URL.

### Railway

- New Project → Deploy from GitHub → выберите репо, root `rent-agent`.
- Settings → Variables → добавьте env.
- Settings → Networking → сгенерируйте домен или привяжите свой.

### Render

- New → Web Service → root `rent-agent`.
- Environment → добавьте env.
- Health Check Path: `/health`.

При первом старте проверьте логи: не должно быть `[index] ⚠️ DEMO_MODE=true в production!` (NFR-10).

---

## HTTP-эндпоинты

Полный список TO-BE (`ARCHITECTURE.md` §12):

| Метод | Путь | Модуль | Ответ |
|-------|------|--------|-------|
| `GET` | `/health` | `index.js` | Сразу JSON `{ status, uptime }` |
| `POST` | `/webhook/telegram` | `routes/telegram.js` | `200 OK` сразу (fire-and-forget) |
| `POST` | `/webhook/realtycalendar` | `routes/realtycalendar.js` | `200 OK` сразу |
| `POST` | `/webhook/avito` | `routes/avito.js` | `200 OK` сразу |

---

## Чек-лист релиза TO-BE

Критерии из `SPECIFICATION.md` §6.3. Отмечайте по мере выполнения на production.

- [x] US-OK-1, 3, 4, 6 регрессионно зелёные (`node tests/test_regression.js` — 37/37, Шаг 13).
- [x] US-CHG-1…6 и FR-1…FR-18 приняты по чек-листу §2.2 (регрессия + `node tests/e2e_full_flow.js` — 6/6).
- [ ] Webhook URL прописан в кабинете Авито (FR-18) — проверено **боевым** сообщением в Messenger.
- [ ] В production `DEMO_MODE=false`, реальные Авито-ключи валидны; в логах нет warning'ов NFR-10.
- [ ] Двунаправленная синхронизация проверена end-to-end: бронь Яндекс → Авито (US-OK-1) и подтверждённая бронь Авито → ЦИАН/Яндекс (US-CHG-6).
- [x] На каждое входящее сообщение Авито в Notion появляется/обновляется запись (BG-4) — код-путь покрыт e2e; на production проверить боевым сообщением.
- [ ] Метрики BG-1…BG-5 измеряются после выката на публичный URL (отдельный этап).

### Инфраструктурные шаги (CHANGE_REQUEST §7.5)

| Шаг | Ответственный | Когда |
|-----|--------------|-------|
| Зарегистрировать Webhook URL в кабинете Авито (FR-18) | Владелец | До или сразу после деплоя |
| `DEMO_MODE=false` в production | Разработчик | При деплое |
| Реальные `AVITO_CLIENT_ID/SECRET` | Владелец | До деплоя |
| `REALTYCALENDAR_API_URL / TOKEN / OBJECT_ID` | Владелец (с RC) | До деплоя US-CHG-6 |

---

## Известные ограничения

Явно отложенные решения и GAP — **полный список в [`SPECIFICATION.md` §6.1](SPECIFICATION.md#61-явно-отложено-решения-продакта--gap)**. Не дублируем здесь.

Кратко для эксплуатации:

- **`DEMO_MODE`** — только dev/CI; в production всегда `false` (NFR-10).
- **Одна квартира** — один `REALTYCALENDAR_OBJECT_ID`; несколько объектов — в бэклоге (`SPECIFICATION.md` §6.2).
- **Верификация подписей вебхуков** (Telegram secret, Авито, RC HMAC) — вне текущего релиза (§6.1).

---

## Тесты

```bash
# Регрессия (изолированные unit/route-тесты)
node tests/test_regression.js

# Полный TO-BE flow in-process
node tests/e2e_full_flow.js

# E2E с HTTP (сервер должен быть запущен)
node index.js &
node tests/e2e_mock.js
```

Интеграционные (нужен заполненный `.env`):

```bash
node tests/test_notion.js
node tests/diagnose_notion.js
node tests/test_llm.js
```

---

## Структура проекта

```
rent-agent/
├── index.js              # Express, роуты, /health
├── .env.example          # Шаблон секретов
├── src/
│   ├── routes/           # telegram, realtycalendar, avito
│   ├── services/         # notion, llm, telegram, avito, realtycalendar
│   └── middleware/       # logger
└── tests/                # регрессия и e2e
```

Подробная архитектура — [`ARCHITECTURE.md`](ARCHITECTURE.md).
