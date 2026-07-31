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

# Python нужен для генерации изображений турнирной сетки
pip install -r scripts/requirements.txt
# или: python -m pip install -r scripts/requirements.txt

npm run dev
```

Если `python` / `python3` не в PATH, задайте путь в `.env`:

```env
PYTHON_PATH=C:\Path\To\python.exe
```

Production:

```bash
npm run build
npm start
```

## Генерация турнирной сетки

Картинка сетки строится тем же Python-пакетом, что и в TennisBot (`scripts/bracket/lib` — порт `utils/bracket`).

```bash
pip install -r scripts/requirements.txt
# или: python -m pip install -r scripts/requirements.txt

# проверка вручную
python scripts/bracket/generate_bracket.py --input bracket.json --output bracket.png
```

## Docker

Сборка и запуск:

```bash
docker build -t tennisbotmax .
docker run -d --name tennisbotmax --env-file .env -v tennisbot_data:/app/data tennisbotmax
```

Управление контейнером:

```bash
# статус
docker ps -a --filter name=tennisbotmax

# логи (в реальном времени)
docker logs -f tennisbotmax

# последние N строк логов
docker logs --tail 100 tennisbotmax

# остановить
docker stop tennisbotmax

# запустить снова
docker start tennisbotmax

# перезапустить
docker restart tennisbotmax

# войти в контейнер
docker exec -it tennisbotmax sh

# удалить контейнер (данные в volume tennisbot_data сохранятся)
docker rm -f tennisbotmax

# пересобрать и перезапустить
docker build -t tennisbotmax .
docker rm -f tennisbotmax
docker run -d --name tennisbotmax --env-file .env -v tennisbot_data:/app/data tennisbotmax
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
