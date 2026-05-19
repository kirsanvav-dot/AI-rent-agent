# Rental AI Agent

AI-агент для посуточной аренды квартир.  
Принимает вебхуки от Авито и RealtyCalendar, ведёт CRM в Notion, общается с гостями через Telegram.

> README будет дополнен в Шаге 9 TRACKER.md.

## Быстрый старт (заполняется в Шаге 9)

```bash
git clone <repo>
cd rental-ai-agent
npm install
cp .env.example .env
# Заполнить .env своими ключами
npm run dev
```

## Эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/health` | Health-check |
| POST | `/webhook/telegram` | Апдейты от Telegram Bot |
| POST | `/webhook/realtycalendar` | Брони от RealtyCalendar |
| POST | `/webhook/avito` | События от Авито |
# AI-rent-agent
