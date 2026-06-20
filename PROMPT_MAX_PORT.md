# Промпт: Sport Partner Bot для MAX (Node.js) — порт Tennis-Play Bot

## Роль и цель

Ты — senior Node.js разработчик. Нужно создать **мессенджер-бота для платформы MAX** (аналог существующего Telegram-бота Tennis-Play), который объединяет спортивное сообщество: поиск партнёров, предложения игр, турниры, учёт счёта, подписки, туры и админку.

**Референс:** Python/Telegram бот TennisBot (aiogram 3, JSON-хранилище, FSM, мультиязычность ru/en).

**Целевой стек:**

- Node.js 18+
- TypeScript (предпочтительно)
- Официальная библиотека `@maxhub/max-bot-api` или `max-bot-ts` (FSM/scenes)
- JSON-файлы для хранения (как в оригинале) или SQLite/PostgreSQL
- dotenv для конфигурации
- axios/fetch для внешних API
- node-cron или setInterval для фоновых задач
- nodemailer для email-уведомлений
- Tinkoff Acquiring / YooKassa для платежей

---

## 1. Общее описание продукта

**Tennis-Play Bot** — мульти-спортивная платформа для:

- регистрации профиля игрока/тренера;
- поиска партнёров по фильтрам;
- публикации предложений игр/встреч в каналы;
- организации турниров (олимпийская система и круговая);
- внесения счёта матчей с пересчётом рейтинга;
- PRO-подписки и реферальной программы;
- туров (поиск партнёра на отдыхе);
- конкурса красоты;
- админ-панели.

Бот работает **только в личных чатах** (не в группах). Забаненные пользователи получают отказ во всех функциях.

---

## 2. Архитектура

```
src/
├── index.ts                 # точка входа, polling/webhook
├── config/
│   ├── env.ts               # TOKEN, ADMIN_ID, цены, API keys
│   ├── profile.ts           # виды спорта, города, уровни NTRP
│   └── tournament.ts        # типы турниров, категории
├── storage/
│   └── jsonStorage.ts       # users, games, tournaments, banned, sessions, languages, beauty_contest
├── i18n/
│   ├── ru.json
│   └── en.json
├── middleware/
│   ├── banCheck.ts
│   ├── privateChatOnly.ts
│   └── session.ts           # FSM state persistence
├── handlers/
│   ├── registration.ts
│   ├── profile.ts
│   ├── searchPartner.ts
│   ├── gameOffers.ts
│   ├── gameOffersMenu.ts    # просмотр чужих предложений
│   ├── enterScore.ts
│   ├── tournament.ts
│   ├── tournamentScore.ts
│   ├── tours.ts
│   ├── payments.ts
│   ├── invite.ts
│   ├── more.ts
│   ├── admin.ts
│   ├── adminEdit.ts
│   └── beautyContest.ts
├── services/
│   ├── channels.ts          # публикация в каналы MAX
│   ├── webApi.ts            # синхронизация с сайтом tennis-play.com
│   ├── payments.ts          # Tinkoff/YooKassa
│   └── email.ts
├── utils/
│   ├── bot.ts               # showProfile, showCurrentMessage
│   ├── game.ts
│   ├── tournamentManager.ts
│   ├── tournamentLifecycle.ts
│   ├── bracket/             # генерация сеток
│   └── notifications.ts
└── jobs/
    ├── subscriptionCheck.ts # каждые 24ч
    └── tournamentJobs.ts    # каждые 15 мин
```

**Паттерны:**

- Router/Composer на модуль
- FSM (сцены) для многошаговых диалогов
- Сессии пользователя сохраняются в `data/sessions/{userId}.json`
- Атомарные операции записи JSON с mutex/lock
- Единая функция `t(key, lang, params)` для i18n
- `showCurrentMessage()` — редактировать предыдущее сообщение бота вместо спама

---

## 3. Переменные окружения

```env
BOT_TOKEN=              # токен MAX бота
ADMIN_ID=               # ID администратора
BOT_USERNAME=           # username бота в MAX (для deep links)
SUBSCRIPTION_PRICE=300  # руб/месяц
TOURNAMENT_ENTRY_FEE=500
CHANNEL_ID=             # основной канал (если один)
SHOP_ID=                # YooKassa
SECRET_KEY=             # YooKassa
TINKOFF_TERMINAL_KEY=
TINKOFF_PASSWORD=
TENNIS_API_URL=https://tennis-play.by/profile/api.php
TENNIS_API_TOKEN=
EMAIL_SMTP_USERNAME=
EMAIL_SMTP_PASSWORD=
EMAIL_ADMIN=
```

---

## 4. Хранилище данных

### 4.1 Файлы

| Файл | Содержимое |
|------|------------|
| `users.json` | `{ [userId: string]: UserProfile }` |
| `games.json` | глобальный список завершённых игр (опционально) |
| `tournaments.json` | `{ [tournamentId: string]: Tournament }` |
| `tournament_applications.json` | заявки |
| `banned_users.json` | `{ [userId: string]: { reason, banned_at } }` |
| `languages.json` | `{ [userId: string]: "ru" \| "en" }` |
| `beauty_contest.json` | `{ applications, votes, user_votes }` |
| `sessions/{userId}.json` | FSM state + prev_msg_id |

### 4.2 Модель UserProfile

```typescript
interface UserProfile {
  max_user_id: number;          // аналог telegram_id
  username?: string;
  first_name: string;
  last_name: string;
  phone: string;
  birth_date: string;           // DD.MM.YYYY
  country: string;              // "🇷🇺 Россия"
  city: string;
  district?: string;            // округ Москвы
  role: "🎯 Игрок" | "👨‍🏫 Тренер";
  sport: SportType;             // см. ниже
  gender: "Мужской" | "Женский";
  player_level?: string;        // NTRP "3.5" или рейтинг наст.тенниса
  rating_points: number;        // 500-2800
  price?: number;               // цена тренировки (для тренеров)
  photo_path?: string;
  games_played: number;
  games_wins: number;
  default_payment?: string;     // "💰 Пополам" и т.д.
  show_in_search: boolean;
  profile_comment?: string;
  referrals_invited: number;
  free_offers_used: number;
  games: GameOffer[];           // активные предложения
  subscription?: {
    active: boolean;
    until: string;              // YYYY-MM-DD
    expired?: boolean;
    last_expired_notification?: string;
  };
  language: "ru" | "en";
  created_at: string;
  // Web sync
  web_user_id?: string;
  web_domain?: string;
  // Vacation/tour
  vacation_tennis?: boolean;
  vacation_start?: string;
  vacation_end?: string;
  vacation_country?: string;
  vacation_city?: string;
  vacation_district?: string;
  vacation_comment?: string;
  // Dating
  dating_goal?: string;
  dating_goal_key?: string;
  dating_interests?: string[];
  dating_interests_keys?: string[];
  dating_additional?: string;
  // Meetings
  meeting_time?: string;
}
```

### 4.3 Модель GameOffer

```typescript
interface GameOffer {
  id: number;
  sport: SportType;
  country: string;
  city: string;
  district?: string;
  date: string;                 // DD.MM или DD.MM.YYYY
  time: string;                 // HH:MM
  game_type?: string;           // Одиночная/Парная/Микст/Тренировка
  payment_type?: string;
  competitive?: boolean;        // игра на счёт
  comment?: string;
  active: boolean;
  dating_goal?: string;
  dating_interests?: string[];
  dating_additional?: string;
  created_at: string;
}
```

### 4.4 Модель Tournament

```typescript
interface Tournament {
  id: string;
  name: string;
  sport: SportType;
  country: string;
  city: string;
  district?: string;
  type: "Олимпийская система" | "Круговая";
  gender?: "Мужчины" | "Женщины" | "Мужская пара" | "Женская пара" | "Микст";
  category: string;             // 1-3 категория, Мастерс, Профи
  level: string;                // "3.5-4.5"
  age_group: "Взрослые" | "Дети";
  duration: string;
  participants_count: number;
  participants: { [userId: string]: ParticipantInfo };
  show_in_list: boolean;
  hide_bracket: boolean;
  comment?: string;
  status: "active" | "started" | "finished" | "cancelled";
  entry_fee: number;
  payments: { [userId: string]: { status: "pending"|"succeeded", payment_id } };
  payment_window?: { active: boolean; deadline_at: string; created_at: string };
  bracket?: object;             // сетка
  round_robin?: object;         // таблица кругового
  created_by: string;
  created_at: string;
}
```

---

## 5. Виды спорта и конфигурация полей

14 видов спорта/активностей (ключи хранятся на русском с эмодзи):

| Sport | Категория | Уровень | Роль | Оплата корта | Тур/отпуск | Особые поля |
|-------|-----------|---------|------|--------------|------------|-------------|
| 🎾Большой теннис | court_sport | NTRP 1.0-7.0 | да | да | да | about_me |
| 🏓Настольный теннис | court_sport | рейтинг (число) | да | да | да | |
| 🏸Бадминтон | court_sport | NTRP | да | да | да | |
| 🏖️Пляжный теннис | court_sport | NTRP | да | да | да | |
| 🎾Падл-теннис | court_sport | NTRP | да | да | да | |
| 🥎Сквош | court_sport | NTRP | да | да | да | |
| 🏆Пиклбол | court_sport | NTRP | да | да | да | |
| ⛳Гольф | outdoor_sport | нет | нет | нет | нет | about_me |
| 🏃‍♂️‍➡️Бег | outdoor_sport | нет | нет | нет | нет | |
| 🏋️‍♀️Фитнес | outdoor_sport | нет | нет | нет | нет | |
| 🚴Вело | outdoor_sport | нет | нет | нет | нет | |
| ☕️Бизнес-завтрак | meeting | нет | нет | нет | нет | meeting_time |
| 🍻По пиву | meeting | нет | нет | нет | нет | meeting_time |
| 🍒Знакомства | dating | нет | нет | нет | нет | goal, interests, additional |

**NTRP уровни** (1.0–7.0) с `rating_points`: 500, 700, 900, 1100, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800.

**Страны и города:** 🇷🇺 Россия (Москва, СПб, Новосибирск, Краснодар, Екатеринбург), 🇧🇾 Беларусь, 🇰🇿 Казахстан, 🇬🇪 Грузия, 🇦🇲 Армения, 🇺🇿 Узбекистан + «Другая страна/город» (ручной ввод).

**Округа Москвы:** ВАО, ЗАО, ЗелАО, САО, СВАО, СЗАО, ЦАО, ЮАО, ЮВАО, ЮЗАО (или Север/Юг/Запад/Восток для турниров).

**Типы игр:** Одиночная, Парная, Микст, Тренировка.

**Типы оплаты:** 💰 Пополам, 💳 Я оплачиваю, 💵 Соперник оплачивает, 🎾 Проигравший оплачивает.

---

## 6. Главное меню (Reply Keyboard)

Постоянная клавиатура из 7 пунктов (2+2+2+1):

```
🎾 Поиск партнера    | ⏱ Предложение игр
🏆 Турниры           | 📝 Внести счет
🔗 Пригласить друга  | 💳 Платежи
🔍 Еще
```

*(✈️ Туры доступны через «Еще»)*

Обработка: `bot.hears()` по тексту кнопки на ru и en (из i18n).

---

## 7. Deep Links / Start-параметры

При `/start` или `bot_started` с payload:

| Payload | Действие |
|---------|----------|
| `ref_{userId}` | Сохранить referral_id в FSM; при завершении регистрации +1 к `referrals_invited` реферера; при 5 — бесплатная подписка на 1 месяц |
| `profile_{userId}` | Показать профиль пользователя |
| `web_{domain}_{webUserId}` | Авто-регистрация с сайта (API tennis-play) |
| `join_tournament_{id}` | Запись в турнир |
| `view_tournament_{id}` | Карточка турнира |
| `pay_tournament_{id}` | Оплата взноса турнира |

**MAX-адаптация:** deep link формата `https://max.ru/{botUsername}?start={payload}` (уточнить по документации MAX).

---

## 8. Регистрация (FSM RegistrationStates)

### Порядок шагов (зависит от sport)

**Общие шаги:**

1. `LANGUAGE` — выбор ru/en
2. `PHONE` — запрос номера (кнопка «Отправить телефон» или текст)
3. `SPORT` — inline-клавиатура 14 видов спорта
4. `FIRST_NAME`, `LAST_NAME`
5. `BIRTH_DATE` — DD.MM.YYYY, валидация
6. `COUNTRY` → `CITY` → `DISTRICT` (если Москва)
7. **Если court_sport:** `ROLE` → (если тренер: `TRAINER_PRICE`) → `PLAYER_LEVEL` → `DEFAULT_PAYMENT`
8. **Если dating:** `DATING_GOAL` → `DATING_INTERESTS` (multi-select) → `DATING_ADDITIONAL`
9. **Если meeting:** `MEETING_TIME`
10. `GENDER`
11. `PROFILE_COMMENT` (/skip)
12. `PHOTO` — загрузка фото или «Без фото»
13. **Если has_vacation:** `VACATION_TENNIS` (да/нет) → country/city/dates/comment

### После регистрации

- Сохранить профиль в `users.json`
- Опубликовать в канал вида спорта (`sendRegistrationNotification`)
- Показать inline-кнопки: «Предложить игру», «Создать тур» (если applicable), «Главное меню»
- Обработать реферал

### Web auto-registration (`web_{domain}_{id}`)

- GET `{domain}/profile/api.php?action=get_user&user_id={id}&token={token}`
- Маппинг полей сайта → профиль бота
- Скачать фото
- Перенести активное предложение игры и тур (если даты в будущем)

---

## 9. Профиль пользователя

### Отображение (showProfile)

HTML-текст + фото + inline-кнопки.

**Поля в карточке:** имя, возраст, роль, уровень/рейтинг, цена тренировки, страна/город/округ, спорт, пол, статистика (сыграно/побед/%), оплата корта, тур на отдых, dating/meeting поля, «О себе».

### Свой профиль — кнопки

- Редактировать профиль
- Найти партнёра на отдых (если has_vacation)
- Мои предложения
- Предложить игру/знакомство/встречу (текст зависит от sport)
- История игр
- Удалить профиль
- Главное меню

### Чужой профиль — кнопки

- **Связаться** (контакты — только с PRO-подпиской, иначе paywall)
- История игр / предложения встреч / анкеты
- Главное меню

### Админ на любом профиле

- Удалить пользователя, снять подписку, забанить, удалить тур

---

## 10. Поиск партнёра (SearchPartnerStates)

**Триггер:** кнопка «🎾 Поиск партнера»

**Фильтры (пошагово):**

1. Вид спорта
2. Страна (+ «Другая»)
3. Город (+ «Другой»)
4. Округ (Москва)
5. **Для court_sport:** пол → уровень (NTRP)
6. **Для dating:** пол → возраст → цель → расстояние
7. Результаты с пагинацией (10 на страницу)

**Фильтрация:**

- `show_in_search === true`
- Не забанен
- Совпадение sport, country, city, district, gender, level
- Для dating: возраст в диапазоне, цель, geo

**Результат:** список inline-кнопок → `showProfile` с `back_button`.

---

## 11. Предложение игр — создание (GameOfferStates)

**Триггеры:** «Предложить игру» из профиля, callback `new_offer`, callback `new_offer_{sport}`

### Paywall перед созданием

- **PRO-подписка** → безлимит
- **Женщины** в «Знакомства» и «По пиву» → безлимит
- **Бесплатно:** 1 предложение (`free_offers_used >= 1` → блок)
- Иначе показать цену подписки + реферальную ссылку

### Flow по категориям (getNextGameStep)

**meeting** (бизнес-завтрак, пиво):

`sport → city → date → time → comment → publish`

**dating:**

`sport → city → date → time → dating_goal → dating_interests → dating_additional → comment → publish`

**outdoor_sport** (бег, вело, гольф, фитнес):

`sport → city → date → time → comment → publish`

**court_sport** (полный):

`sport → country → city → [district] → date → time → game_type → payment_type → competitive (да/нет) → comment → publish`

### После создания

- Добавить в `user.games[]` с `id`, `active: true`
- `free_offers_used++` (если нет подписки)
- Опубликовать в канал вида спорта (`sendGameOfferToChannel`)
- Показать подтверждение + кнопки профиля

### Мои предложения

- Навигация prev/next по активным играм
- Удаление с подтверждением

### Автоочистка (фоновая задача)

Удалять предложения, у которых date+time прошли.

---

## 12. Просмотр предложений игр (BrowseOffersStates)

**Триггер:** «⏱ Предложение игр»

**Flow:**

1. Выбор вида спорта
2. Выбор страны (сортировка: 🇷🇺 первая, остальные по count)
3. Выбор города
4. Список предложений с пагинацией (5 на страницу)
5. Карточка предложения: автор (ссылка на профиль), детали, кнопка «Откликнуться»
6. Отклик → `RespondToOfferStates.ENTER_COMMENT` → уведомление автору

**Сортировка:** по дате (ближайшие первые).

---

## 13. Туры / Vacation (BrowseToursStates, CreateTourStates)

**Раздел «✈️ Туры»** (из «Еще» или профиля):

### Просмотр туров

sport → country → city → список пользователей с `vacation_tennis=true` и актуальными датами.

### Создание тура

- country → city → start_date → end_date → comment
- Сохранить в профиль: `vacation_tennis, vacation_start, vacation_end, vacation_country, vacation_city, vacation_comment`
- Опубликовать в `tour_channel_id`

---

## 14. Турниры (CreateTournamentStates, ViewTournamentsStates, EditTournamentStates)

### Меню «🏆 Турниры»

- Просмотреть список
- Мои турниры
- (Админ) Создать турнир / Редактировать

### Просмотр (5 шагов)

sport → country → city → [district для Москвы] → gender format → type → список → карточка

### Карточка турнира

название, спорт, город, тип, формат, категория/уровень, возраст, даты, участники N/M, взнос, комментарий, сетка (если started).

**Кнопки:** Подать заявку / Оплатить / Покинуть / Просмотр сетки.

### Создание (только админ)

SPORT → COUNTRY → CITY → DISTRICT → TYPE → GENDER → CATEGORY → AGE_GROUP → DURATION → PARTICIPANTS_COUNT → SHOW_IN_LIST → HIDE_BRACKET → COMMENT → CONFIRM

**Авто-название:** `{sport} {city} {level} {gender_suffix} {date}`

### Lifecycle

1. **Набор участников** (`status: active`)
2. При заполнении roster + `entry_fee > 0` → **окно оплаты 24ч** (`payment_window`)
3. Неоплатившие удаляются по истечении 24ч (фоновая задача каждые 15 мин)
4. **Старт турнира** → генерация bracket (олимп.) или round-robin таблицы + картинка
5. Публикация в канал
6. Внесение счёта матчей → продвижение по сетке
7. **Завершение** → начисление рейтинга

### Типы

- **Олимпийская система** — bracket tree, мин. 4 участника
- **Круговая** — round-robin таблица, напоминания о несыгранных матчах

### Deep links

- `join_tournament_{id}` — добавить в participants (проверка level, gender, мест)
- `pay_tournament_{id}` — Tinkoff/YooKassa flow
- `view_tournament_{id}` — карточка

---

## 15. Внесение счёта (AddScoreState)

**Триггер:** «📝 Внести счет» (требует PRO-подписку, кроме админа)

### Flow

1. `selecting_game_type`: Одиночная / Парная / Турнирная
2. **Одиночная:** выбор соперника (поиск по имени + pagination)
3. **Парная:** партнёр → соперник1 → соперник2
4. **Турнирная:** выбор турнира → выбор соперника из participants
5. `selecting_set_score`: inline-клавиатура счёта 0:0–7:6, супертайбрейк 10:8 и т.д.
6. `adding_another_set`: добавить сет / завершить
7. `adding_media`: фото/видео матча (опционально)
8. `confirming_score`: подтверждение

### После подтверждения

- Сохранить Game в `games.json` и историю пользователей
- Пересчитать `rating_points` (ELO-подобная формула `calculateNewRatings`)
- Обновить `games_played`, `games_wins`, `player_level` из points
- Опубликовать результат в канал (`sendGameNotificationToChannel`)
- Для турнира: обновить bracket, проверить следующий раунд

---

## 16. Платежи и подписка (PaymentStates)

**Триггер:** «💳 Платежи»

### PRO-подписка Tennis-Play

- Цена: `SUBSCRIPTION_PRICE` руб/месяц
- **Преимущества PRO:**
  - Безлимитные предложения игр
  - Внесение счёта
  - Просмотр контактов в профилях
  - «Все игроки» / «Найти тренера»
  - История игр других игроков
  - 2 голоса в конкурсе красоты (вместо 1)

### Flow оплаты

1. `WAITING_EMAIL` — ввод email для чека
2. Генерация ссылки Tinkoff (`generateTinkoffPaymentLink`)
3. Inline: «Перейти к оплате» (url) + «Подтвердить оплату»
4. `CONFIRM_PAYMENT` — polling статуса (`checkTinkoffPaymentStatus`)
5. При success: `subscription.active=true`, `until=+30 days`, email админу

### Реферальная подписка

При `referrals_invited >= 5` → автоматически +1 месяц PRO.

### Фоновые задачи (24ч)

- Проверка истечения подписок → `active=false`, уведомление
- Напоминания за 3 дня и 1 день до истечения
- Очистка прошедших game offers

---

## 17. Пригласить друга (invite)

**Триггер:** «🔗 Пригласить друга»

Показать:

- Счётчик `{referral_count}/5`
- Реферальная ссылка `?start=ref_{userId}`
- Кнопка «Поделиться» (в MAX — копирование или share API)

---

## 18. Раздел «Еще» (more)

Inline-меню:

- ✈️ Туры
- 👥 Все игроки (PRO) / 🎓 Найти тренера (PRO)
- 💃 Конкурс красоты
- ℹ️ О проекте / 📞 Контакты
- 🏆 Многодневные турниры (url) / Weekend турниры (url)
- 👤 Мой профиль / 🌐 На сайт
- 🌐 Язык (ru/en)

---

## 19. Конкурс красоты (BeautyContestStates)

- Пользователь подаёт заявку (фото из профиля)
- Голосование по полу (М/Ж)
- **Лимиты голосов:** 1+1 без PRO, 2+2 с PRO
- Просмотр анкет по одной с кнопками «Голосовать» / «Пропустить»
- Админ: модерация, удаление анкет

---

## 20. Админ-панель

**Доступ:** `userId === ADMIN_ID` или список админов.

**Команды:**

- `/admin` — главное меню админки
- `/banned_users` — список забаненных
- `/unban_user {id}` — разбан

**Функции (inline):**

- 📊 Статистика пользователей
- 📢 Рассылка (AdminBroadcastStates): переслать сообщение ИЛИ ручное (media → text → confirm → broadcast всем)
- 🎾 Управление играми (редактирование счёта, медиа, победитель)
- 🏆 Создание/редактирование/удаление турниров
- 👤 Редактирование чужого профиля (admin_edit)
- 🚫 Ban/unban/delete user/delete subscription
- 💃 Управление конкурсом красоты
- Внесение счёта турнирного матча

---

## 21. Публикация в каналы (services/channels)

Для **каждого вида спорта** свой channel_id (массив для большого тенниса: основной + СПб).

**Типы публикаций:**

1. `sendRegistrationNotification` — новый игрок/тренер
2. `sendGameOfferToChannel` — новое предложение игры
3. `sendGameNotificationToChannel` — результат матча
4. `sendTourToChannel` — новый тур на отдых
5. `sendTournamentCreatedToChannel` — новый турнир
6. `sendTournamentApplicationToChannel` — заявка на турнир
7. `sendTournamentStartedToChannel` — старт + картинка сетки

**MAX-адаптация:** использовать MAX Bot API для отправки в каналы/чаты (`ctx.api` или raw API). Уточнить формат markdown/HTML.

---

## 22. Интеграция с сайтом (Web API)

```
GET {domain}/profile/api.php?action=get_user&user_id={id}&token={token}
```

Домены: com, by, kz, padeltennis, tabletennis, tournaments.

Маппинг: name→first/last, birthdate, sex, game_type→sport, role, court→payment, game_level, country_name, city_name, district_name, photo_url_large, public_offer*.

---

## 23. i18n

Файлы `ru.json` / `en.json` с ключами:

- `registration.*`, `main.*`, `game_offers.*`, `profile.*`, `menu.*`, `payments.*`, `invite.*`, `tournament.*`, `enter_invoice.*`, `admin.*`, `more.*`, `beauty_contest.*`, `channels.*`, `config.*`, `common.*`

Функция: `t(key, language, params?)` с интерполяцией `{name}`.

Язык хранится в `languages.json` + дублируется в профиле.

---

## 24. Callback Data — полный каталог

```
# Профиль
edit_profile, main_menu, my_offers, new_offer, new_offer_{sport}
createTour, create_tour, 1delete_profile
profile_contact:{userId}, game_history:{userId}, partner_back_to_results

# Game offers
gamesport_{sport}, gamecountry_{country}, gamecity_{city}
gamedistrict_{district}, gamedate_{date}, gametime_{time}
gametype_{type}, paytype_{payment}, gamecomp_{yes|no}
datinggoal_{goal}, datinginterest_{interest}, datinginterests_done
delete_offer_{id}, confirm_delete_{id}, delete_no, offer_prev, offer_next

# Browse offers
offersport_{sport}, offercountry_{country}, offercity_{city}
offerpage_{n}, viewoffer_{userId}_{gameId}, respond_offer_{...}

# Search partner
partner_sport_{sport}, partner_search_country_{country}
partner_search_city_{city}, partner_district_{district}
partner_gender_{gender}, partner_level_{level}
partner_age_{range}, partner_dating_goal_{goal}, partner_distance_{km}
partner_show_profile_{userId}, partner_page_{n}
partner_back_to_sport, partner_back_to_countries, partner_back_to_cities
partner_back_to_level, partner_back_to_results

# Score
game_type:single|double|tournament
select_opponent:{id}, select_partner:{id}
set_score:{setNum}_{score}, add_another_set:{n}
supertiebreak:{n}, finish_score, confirm:{gameId}
media:skip|photo|video, nav:{action}:{page}, back

# Tournament
view_tournament:{id}, join_tournament:{id}, leave_tournament:{id}
pay_tournament:{id}, tournamentpage_{n}, create_tournament
admin_* (множество admin callbacks)

# Payments
buy_subscription, confirm_payment

# More
about, contacts, all_players, find_coach, beauty_contest
select_language, set_language_ru|en, back_to_main, profile

# Admin
admin_select_user:{id}, admin_ban_user:{id}
admin_edit_profile:{id}, admin_delete_tournament:{id}
... (см. handlers/admin.py)
```

---

## 25. FSM States — полный список

### RegistrationStates

LANGUAGE, REGISTRATION_START, PHONE, FIRST_NAME, LAST_NAME, BIRTH_DATE, COUNTRY, CITY, ROLE, TRAINER_PRICE, SPORT, GENDER, PLAYER_LEVEL, PHOTO, SHOW_IN_SEARCH, VACATION_TENNIS, VACATION_START, VACATION_END, VACATION_COMMENT, COUNTRY_INPUT, CITY_INPUT, PROFILE_COMMENT, DEFAULT_PAYMENT, VACATION_COUNTRY, VACATION_COUNTRY_INPUT, VACATION_CITY, VACATION_CITY_INPUT, DATING_GOAL, DATING_INTERESTS, DATING_ADDITIONAL, MEETING_TIME, TABLE_TENNIS_RATING

### GameOfferStates

GAME_SPORT, GAME_COUNTRY, GAME_COUNTRY_INPUT, GAME_CITY, GAME_CITY_INPUT, GAME_DISTRICT, GAME_DATE, GAME_DATE_MANUAL, GAME_TIME, GAME_TYPE, PAYMENT_TYPE, GAME_COMPETITIVE, GAME_REPEAT, GAME_COMMENT, DATING_GOAL, DATING_INTERESTS, DATING_ADDITIONAL

### SearchPartnerStates

SEARCH_TYPE, SEARCH_COUNTRY, SEARCH_COUNTRY_INPUT, SEARCH_CITY, SEARCH_CITY_INPUT, SEARCH_SPORT, SEARCH_GENDER, SEARCH_LEVEL, SEARCH_PRICE_RANGE, SEARCH_RESULTS, SEARCH_NO_RESULTS, SEARCH_ERROR, SEARCH_OTHER_COUNTRIES, SEARCH_OTHER_CITIES, SEARCH_DISTRICT, SEARCH_AGE_RANGE, SEARCH_DATING_GOAL, SEARCH_DISTANCE

### AddScoreState

selecting_game_type, selecting_partner, searching_partner, selecting_opponent, searching_opponent, selecting_set_score, adding_another_set, adding_media, confirming_score, searching_opponent1, searching_opponent2, selecting_opponent1, selecting_opponent2, selecting_tournament, selecting_tournament_opponent

### CreateTournamentStates / EditTournamentStates / ViewTournamentsStates

См. `models/states.py` в референс-проекте.

### PaymentStates / TournamentPaymentStates

WAITING_EMAIL, CONFIRM_PAYMENT

### AdminBroadcastStates

WAIT_FORWARD, MANUAL_MEDIA, MANUAL_TEXT, CONFIRM

### BeautyContestStates

MAIN_MENU, SELECT_GENDER, VIEW_PROFILES, CONFIRM_APPLICATION, DELETE_APPLICATION

---

## 26. Фоновые задачи

| Задача | Интервал | Действие |
|--------|----------|----------|
| `checkSubscriptions` | 24ч | expire subscriptions, notify, cleanup expired offers, subscription reminders |
| `tournamentScheduledLoop` | 15 мин | payment window expiry, remove unpaid, round-robin reminders, begin payment collection |

---

## 27. Маппинг Telegram → MAX

| Telegram (aiogram) | MAX (@maxhub/max-bot-api) |
|--------------------|---------------------------|
| `Message` private | `message_created` event |
| `CallbackQuery` | `message_callback` / `bot.action()` |
| `ReplyKeyboardMarkup` | Reply keyboard MAX API |
| `InlineKeyboardMarkup` | Inline keyboard MAX API |
| `FSMContext` + StatesGroup | Session middleware + scenes (max-bot-ts) |
| `Command("start")` | `bot.command('start')` + `bot.on('bot_started')` |
| `message.answer_photo` | attachment upload API |
| `switch_inline_query` | share link / clipboard button |
| `ChatType.PRIVATE` filter | проверка типа чата в update |
| Deep link `t.me/bot?start=` | MAX deep link format |
| Channel post | MAX channel/chat API |

**Важно для MAX:**

- Использовать webhook в production (polling: 2 RPS limit с 2026)
- Загрузка файлов через MAX upload API
- `ctx.payload` для start-параметров
- HTML parse mode — проверить поддержку в MAX

---

## 28. Требования к реализации

1. **Полный функциональный паритет** с Telegram-версией по бизнес-логике
2. **TypeScript** с strict types для моделей данных
3. **Модульная архитектура** — каждый handler в отдельном файле
4. **Docker** — Dockerfile + volume для `/app/data`
5. **Логирование** — winston/pino
6. **Graceful shutdown** — остановка фоновых задач
7. **Не хардкодить секреты** — только env
8. **Валидация** дат (DD.MM.YYYY), телефона, email, цены
9. **Пагинация** везде где списки > 5-10 элементов
10. **Единый UX** — edit message вместо новых где возможно

---

## 29. Порядок разработки (рекомендуемый)

1. Каркас: bot init, storage, i18n, session/FSM, ban middleware
2. Регистрация + профиль + главное меню
3. Поиск партнёра + просмотр профилей
4. Game offers (create + browse + channels)
5. Payments + subscription + referrals
6. Enter score + rating calculation
7. Tournaments (CRUD + lifecycle + brackets)
8. Tours, More, Invite
9. Beauty contest
10. Admin panel + broadcast
11. Background jobs
12. Web API sync

---

## 30. Пример инициализации MAX бота

```typescript
import { Bot } from '@maxhub/max-bot-api';
import dotenv from 'dotenv';

dotenv.config();

const bot = new Bot(process.env.BOT_TOKEN!);

bot.on('bot_started', async (ctx) => {
  const payload = ctx.payload; // deep link param
  // → registration handler
});

bot.command('start', async (ctx) => {
  // same as bot_started
});

bot.command('admin', adminHandler);
bot.hears(['🎾 Поиск партнера', '🎾 Find partner'], searchPartnerHandler);
// ... all menu handlers

bot.catch(console.error);
bot.start();
```

---

## 31. Как использовать этот документ

Скопируй этот файл целиком в новый чат/агент с задачей:

> **Реализуй этот бот на Node.js + TypeScript для MAX, начни с этапа 1**

Референсный исходный код: репозиторий TennisBot (Python/aiogram).
