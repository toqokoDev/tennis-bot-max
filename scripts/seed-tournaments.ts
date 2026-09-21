/**
 * Одноразовый сид-скрипт: создаёт по 5 турниров каждого типа (Олимпийская система,
 * Круговая) с числом участников от 4 до 8, добавляет тестовых игроков, во всех
 * турнирах обязательно участвует пользователь 225754809, и доигрывает все матчи
 * до конца (включая матчи за 3-е и 5-8 места в олимпийке), создавая записи в
 * games.json и обновляя рейтинги игроков.
 *
 * Запуск: npx tsx scripts/seed-tournaments.ts
 */
import { storage } from '../src/storage/jsonStorage.js';
import type { CompletedGame, Tournament, UserProfile } from '../src/types/models.js';
import {
  addParticipant,
  applyTournamentMatchResult,
  listPendingMatches,
  startTournament,
} from '../src/utils/tournamentLifecycle.js';
import { applyRatingUpdate, expectedScore } from '../src/utils/rating.js';

const REAL_USER_ID = 225754809;

const FAKE_USERS: Array<{ id: number; first: string; last: string; gender: 'Мужской' | 'Женский'; level: string; points: number }> = [
  { id: 900000001, first: 'Артём', last: 'Волков', gender: 'Мужской', level: '2.0', points: 900 },
  { id: 900000002, first: 'Игорь', last: 'Соколов', gender: 'Мужской', level: '2.5', points: 1100 },
  { id: 900000003, first: 'Мария', last: 'Кузнецова', gender: 'Женский', level: '1.5', points: 700 },
  { id: 900000004, first: 'Павел', last: 'Новиков', gender: 'Мужской', level: '3.0', points: 1200 },
  { id: 900000005, first: 'Ольга', last: 'Морозова', gender: 'Женский', level: '2.0', points: 900 },
  { id: 900000006, first: 'Денис', last: 'Крылов', gender: 'Мужской', level: '3.5', points: 1400 },
  { id: 900000007, first: 'Анна', last: 'Лебедева', gender: 'Женский', level: '2.5', points: 1100 },
];

function makeFakeProfile(f: (typeof FAKE_USERS)[number]): UserProfile {
  return {
    max_user_id: f.id,
    first_name: f.first,
    last_name: f.last,
    phone: `+375291${String(f.id).slice(-6)}`,
    birth_date: '15.05.1998',
    country: '🇧🇾 Беларусь',
    city: 'Минск',
    role: '🎯 Игрок',
    sport: '🎾Большой теннис',
    gender: f.gender,
    player_level: f.level,
    rating_points: f.points,
    games_played: 0,
    games_wins: 0,
    default_payment: '💰 Пополам',
    show_in_search: true,
    referrals_invited: 0,
    free_offers_used: 0,
    games: [],
    created_at: new Date().toISOString(),
  };
}

const SET_WIN_PAIRS: Array<[string, string]> = [
  ['6:4', '4:6'], ['6:3', '3:6'], ['6:2', '2:6'], ['7:5', '5:7'], ['6:1', '1:6'],
];

function randomSets(winnerIsP1: boolean): string[] {
  const count = Math.random() < 0.7 ? 2 : 3;
  const sets: string[] = [];
  for (let i = 0; i < count; i++) {
    const pair = SET_WIN_PAIRS[Math.floor(Math.random() * SET_WIN_PAIRS.length)]!;
    const setWinnerIsP1 = i < 2 ? winnerIsP1 : Math.random() < 0.5;
    sets.push(setWinnerIsP1 ? pair[0] : pair[1]);
  }
  return sets;
}

async function main(): Promise<void> {
  const users = await storage.getUsers();
  const realUser = users[String(REAL_USER_ID)];
  if (!realUser) {
    throw new Error(`Пользователь ${REAL_USER_ID} не найден в data/users.json`);
  }

  for (const f of FAKE_USERS) {
    if (!users[String(f.id)]) {
      users[String(f.id)] = makeFakeProfile(f);
    }
  }
  await storage.saveUsers(users);

  const usersMap = new Map<number, UserProfile>(
    Object.values(users).map((u) => [u.max_user_id, u]),
  );

  const tournaments: Record<string, Tournament> = await storage.getTournaments();
  const games: CompletedGame[] = await storage.getGames();

  let seq = 0;
  const sizes = [4, 5, 6, 7, 8];
  const types: Tournament['type'][] = ['Олимпийская система', 'Круговая'];

  for (const type of types) {
    for (const n of sizes) {
      seq += 1;
      const id = `seed_${type === 'Олимпийская система' ? 'ol' : 'rr'}_${n}_${Date.now()}_${seq}`;
      const shortLabel = type === 'Олимпийская система' ? 'Олимпийка' : 'Круговая';

      let t: Tournament = {
        id,
        name: `Тест ${shortLabel} на ${n} игроков`,
        sport: '🎾Большой теннис',
        country: '🇧🇾 Беларусь',
        city: 'Минск',
        type,
        category: 'Без категории',
        level: 'Без уровня',
        age_group: 'Взрослые',
        duration: 'Однодневные',
        participants_count: n,
        participants: {},
        show_in_list: true,
        hide_bracket: false,
        status: 'active',
        entry_fee: 0,
        payments: {},
        created_by: String(REAL_USER_ID),
        created_at: new Date().toISOString(),
      };

      t = addParticipant(t, REAL_USER_ID, `${realUser.first_name} ${realUser.last_name}`.trim());
      for (let i = 0; i < n - 1; i++) {
        const f = FAKE_USERS[i]!;
        t = addParticipant(t, f.id, `${f.first} ${f.last}`);
      }

      t = startTournament(t);

      let guard = 0;
      while (guard < 500) {
        guard += 1;
        const pending = listPendingMatches(t, games);
        if (!pending.length) break;
        const m = pending[0]!;

        const p1 = usersMap.get(m.player1)!;
        const p2 = usersMap.get(m.player2)!;
        const beforeP1 = p1.rating_points;
        const beforeP2 = p2.rating_points;

        const p1WinProb = expectedScore(p1.rating_points, p2.rating_points);
        const p1Wins = Math.random() < p1WinProb;
        const winnerId = p1Wins ? p1.max_user_id : p2.max_user_id;
        const sets = randomSets(p1Wins);

        const { winnerPoints, loserPoints, winnerLevel, loserLevel } = applyRatingUpdate(
          p1Wins ? p1.rating_points : p2.rating_points,
          p1Wins ? p2.rating_points : p1.rating_points,
        );
        if (p1Wins) {
          p1.rating_points = winnerPoints; p1.player_level = winnerLevel; p1.games_played += 1; p1.games_wins += 1;
          p2.rating_points = loserPoints; p2.player_level = loserLevel; p2.games_played += 1;
        } else {
          p2.rating_points = winnerPoints; p2.player_level = winnerLevel; p2.games_played += 1; p2.games_wins += 1;
          p1.rating_points = loserPoints; p1.player_level = loserLevel; p1.games_played += 1;
        }

        const gameId = await storage.nextCompletedGameId();
        const game: CompletedGame = {
          id: gameId,
          sport: '🎾Большой теннис',
          game_type: 'tournament',
          players: [p1.max_user_id, p2.max_user_id],
          sets,
          winner_ids: [winnerId],
          tournament_id: t.id,
          rating_updates: {
            [String(p1.max_user_id)]: { before: beforeP1, after: p1.rating_points },
            [String(p2.max_user_id)]: { before: beforeP2, after: p2.rating_points },
          },
          created_at: new Date().toISOString(),
          created_by: REAL_USER_ID,
        };
        games.push(game);

        t = applyTournamentMatchResult(t, m.id, winnerId, sets);
      }

      tournaments[t.id] = t;
      console.log(`✅ ${t.name} (${t.id}) — статус: ${t.status}, участников: ${Object.keys(t.participants).length}`);
    }
  }

  await storage.saveTournaments(tournaments);
  await storage.saveGames(games);
  await storage.saveUsers(Object.fromEntries([...usersMap.entries()].map(([id, u]) => [String(id), u])));

  console.log(`\nГотово. Создано турниров: ${sizes.length * types.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
