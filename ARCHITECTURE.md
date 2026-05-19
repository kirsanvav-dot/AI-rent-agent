# ARCHITECTURE.md — AI-Агент для посуточной аренды

> **Роль:** Software Architect  
> **Версия:** 1.0  
> **Базируется на:** `SPECIFICATION.md` v1.0

---

## 1. Принципы архитектуры

| Принцип | Реализация |
|---------|------------|
| **Thin routes, fat services** | Роуты только парсят запрос и вызывают сервисы; вся логика — в `src/services/` |
| **Fire-and-forget webhooks** | Все вебхуки отвечают `200 OK` немедленно, тяжёлая обработка — асинхронно |
| **Изоляция интеграций** | Каждая внешняя система инкапсулирована в свой файл; замена сервиса = замена одного файла |
| **Config через env** | Ни одного хардкоженного секрета; только `process.env.*` из `.env` |
| **Явное логирование** | Каждый значимый шаг: `[модуль] действие — результат/ошибка` |

---

## 2. Структура папок

```
rental-ai-agent/
│
├── index.js                        # Точка входа: Express, middleware, маршруты
│
├── src/
│   ├── routes/                     # HTTP-обработчики (тонкий слой)
│   │   ├── telegram.js             # POST /webhook/telegram
│   │   ├── realtycalendar.js       # POST /webhook/realtycalendar
│   │   └── avito.js                # POST /webhook/avito
│   │
│   ├── services/                   # Бизнес-логика и интеграции
│   │   ├── notion.js               # Notion CRM: createBooking, findBookingByChatId, updateBookingStatus
│   │   ├── llm.js                  # OpenRouter: generateReply(message, context)
│   │   ├── telegram.js             # Telegram Bot API: sendMessage, notifyOwner
│   │   └── avito.js                # Авито STR API: getToken, blockDates, sendMessage
│   │
│   ├── middleware/
│   │   └── logger.js               # Логирование входящих запросов (метод, путь, время)
│   │
│   └── utils/
│       └── formatDate.js           # Форматирование дат: ISO → «20 июня 2026»
│
├── tests/
│   ├── test_notion.js              # Smoke-тест подключения к Notion
│   ├── test_llm.js                 # Smoke-тест вызова OpenRouter
│   └── e2e_mock.js                 # Мок-вебхуки для полного прогона pipeline
│
├── .env                            # Секреты (не коммитится)
├── .env.example                    # Шаблон переменных
├── .gitignore
├── package.json
├── SPECIFICATION.md
├── ARCHITECTURE.md                 # (этот файл)
├── TRACKER.md
└── README.md
```

---

## 3. Зависимости между модулями

```
index.js
  ├── src/middleware/logger.js
  ├── src/routes/telegram.js
  │     ├── src/services/notion.js
  │     ├── src/services/llm.js
  │     └── src/services/telegram.js
  ├── src/routes/realtycalendar.js
  │     ├── src/services/notion.js
  │     ├── src/services/avito.js
  │     └── src/services/telegram.js
  └── src/routes/avito.js
        ├── src/services/avito.js
        └── src/services/llm.js
```

**Правило:** сервисы (`services/`) не импортируют друг друга напрямую.  
Оркестрация зависимостей — только на уровне роутов (`routes/`).

---

## 4. Потоки данных

### 4.1 Поток: Новая бронь (RealtyCalendar → Notion + Авито + Telegram)

```
Внешний сервис
    │
    │  POST /webhook/realtycalendar
    │  { action, booking_id, date_from, date_to, guest, property, booking_origin }
    ▼
src/routes/realtycalendar.js
    │
    ├─► res.sendStatus(200)        ← немедленный ответ (< 100 мс)
    │
    └─► (async, fire-and-forget)
          │
          ├─► notion.createBooking(bookingData)
          │       └─► Notion API: INSERT в базу «Брони»
          │
          ├─► avito.blockDates(token, userId, itemId, dateFrom, dateTo)
          │       ├─► avito.getToken()   ← OAuth2, кешируется
          │       └─► Авито API: POST /core/v1/.../bookings
          │
          └─► telegram.notifyOwner(htmlMessage)
                  └─► Telegram API: sendMessage(OWNER_CHAT_ID)
```

### 4.2 Поток: Сообщение от гостя (Telegram)

```
Гость
    │
    │  POST /webhook/telegram
    │  { update_id, message: { chat: { id }, text } }
    ▼
src/routes/telegram.js
    │
    ├─► res.sendStatus(200)        ← немедленный ответ
    │
    └─► (async)
          │
          ├─► notion.findBookingByChatId(chatId)
          │       └─► Notion API: QUERY по полю «Telegram chat_id»
          │           ├─► [найдено]  → context = { guestName, apartment, dateFrom, dateTo, ... }
          │           └─► [не найдено] → context = {}  +  telegram.notifyOwner(alertMessage)
          │
          ├─► llm.generateReply(userMessage, context)
          │       └─► OpenRouter API: POST /chat/completions
          │           Системный промпт «Анна» + контекст брони
          │
          └─► telegram.sendMessage(chatId, reply)
                  └─► Telegram API: sendMessage(chatId)
```

### 4.3 Поток: Сообщение в чате Авито

```
Гость (Авито)
    │
    │  POST /webhook/avito
    │  { payload: { type, author_id, chat_id, content } }
    ▼
src/routes/avito.js
    │
    ├─► res.sendStatus(200)        ← немедленный ответ
    │
    └─► (async)
          │  Проверка: payload.type === 'message' && author_id !== AVITO_USER_ID
          │
          ├─► avito.getToken()
          │
          ├─► llm.generateReply(userMessage, {})
          │       └─► OpenRouter API: POST /chat/completions
          │
          └─► avito.sendMessage(token, userId, chatId, reply)
                  └─► Авито API: POST /messenger/v1/.../messages
```

---

## 5. Внешние зависимости (npm)

| Пакет | Версия | Назначение |
|-------|--------|------------|
| `express` | ^4.21 | HTTP-сервер, роутинг |
| `dotenv` | ^16.4 | Загрузка `.env` |
| `axios` | ^1.7 | HTTP-клиент для OpenRouter и Авито |
| `@notionhq/client` | ^2.2 | Официальный SDK Notion |
| `node-telegram-bot-api` | ^0.66 | Telegram Bot API (режим webhook) |
| `nodemon` | ^3.1 | Dev-сервер с hot-reload |

---

## 6. Схема переменных окружения по модулям

```
.env
  │
  ├── PORT, NODE_ENV
  │     └── index.js
  │
  ├── NOTION_TOKEN, NOTION_DATABASE_ID
  │     └── src/services/notion.js
  │
  ├── OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_SITE_URL, OPENROUTER_APP_NAME
  │     └── src/services/llm.js
  │
  ├── TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_CHAT_ID
  │     └── src/services/telegram.js
  │
  ├── AVITO_CLIENT_ID, AVITO_CLIENT_SECRET, AVITO_USER_ID
  │     └── src/services/avito.js
  │
  └── REALTYCALENDAR_WEBHOOK_SECRET
        └── src/routes/realtycalendar.js  (верификация подписи, опционально)
```

---

## 7. Принципы обработки ошибок

```
┌─────────────────────────────────────────────────────────┐
│  Роут (routes/)                                         │
│    try { res.sendStatus(200); processAsync(); }         │
│    catch (e) { log(e); res.sendStatus(500); }           │
└────────────────────────┬────────────────────────────────┘
                         │ async (fire-and-forget)
          ┌──────────────┼───────────────┐
          │              │               │
     ┌────▼───┐    ┌─────▼────┐   ┌─────▼────┐
     │ Notion │    │  Авито   │   │ Telegram │
     │try/catch│   │ try/catch│   │ try/catch│
     │  log   │   │   log    │   │   log    │
     └────────┘   └──────────┘   └──────────┘
          │              │               │
          └──────────────┴───────────────┘
     Ошибка одного шага НЕ останавливает остальные
```

---

## 8. Деплой

### Локальная разработка

```bash
npm run dev          # nodemon index.js — hot-reload
ngrok http 3000      # публичный HTTPS-URL для регистрации вебхуков
```

### Production — VPS + pm2 + Nginx

**Стек:**
- **pm2** — менеджер процессов Node.js (автозапуск, перезапуск при падении, логи)
- **Nginx** — reverse proxy для Node.js + раздача статики (если появится фронт)

**Запуск приложения через pm2:**

```bash
# Установить pm2 глобально (один раз)
npm install -g pm2

# Запустить агента
pm2 start index.js --name rental-agent

# Автозапуск при перезагрузке сервера
pm2 startup
pm2 save

# Полезные команды
pm2 status                   # статус процессов
pm2 logs rental-agent        # стриминг логов
pm2 restart rental-agent     # перезапуск
pm2 reload rental-agent      # zero-downtime перезапуск
```

**Конфигурация Nginx** (`/etc/nginx/sites-available/rental-agent`):

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Статика (фронт, если появится)
    location /static/ {
        root /var/www/rental-agent;
        expires 30d;
    }

    # Reverse proxy → Node.js / pm2
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Подключить конфиг и перезапустить Nginx
ln -s /etc/nginx/sites-available/rental-agent /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# HTTPS через Let's Encrypt (certbot)
certbot --nginx -d your-domain.com
```

**Переменные окружения на сервере:**

```bash
# Скопировать .env на сервер и задать права
scp .env user@server:/var/www/rental-agent/.env
chmod 600 /var/www/rental-agent/.env
```

### Регистрация вебхука Telegram (один раз после деплоя)

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-domain.com/webhook/telegram"
```

---

*Следующий шаг: выполнять шаги по порядку из `TRACKER.md`.*
