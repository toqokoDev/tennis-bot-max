# Tennis-Play Bot for MAX

Sport Partner Bot для мессенджера **MAX** — порт Telegram-бота Tennis-Play.

## Возможности

- Регистрация профиля (14 видов спорта, ru/en)
- Поиск партнёров по фильтрам
- Создание и просмотр предложений игр
- Турниры (олимпийская / круговая система)
- Внесение счёта и пересчёт рейтинга (ELO)
- PRO-подписка (Tinkoff / YooKassa)
- Реферальная программа (5 друзей = 1 месяц PRO)
- Туры / отпуск
- Конкурс красоты
- Админ-панель

## Быстрый старт

```bash
cp .env.example .env
# Заполните BOT_TOKEN, ADMIN_ID, BOT_USERNAME

npm install
npm run dev
```

Production:

```bash
npm run build
npm start
```

Docker:

```bash
docker build -t tennisbotmax .
docker run -d --env-file .env -v tennisbot_data:/app/data tennisbotmax
```

## Deep links

`https://max.ru/{BOT_USERNAME}?start={payload}`

| Payload | Действие |
|---------|----------|
| `ref_{userId}` | Реферал |
| `profile_{userId}` | Профиль |
| `web_{domain}_{id}` | Авто-регистрация с сайта |
| `join_tournament_{id}` | Запись в турнир |

## Данные

JSON в `./data`: users, games, tournaments, sessions и др.
