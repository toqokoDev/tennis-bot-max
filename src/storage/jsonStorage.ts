import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env.js';
import type {
  BannedUser,
  CompletedGame,
  Tournament,
  TournamentApplication,
  UserProfile,
  UserSession,
} from '../types/models.js';

const locks = new Map<string, Promise<void>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(key, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === next) locks.delete(key);
  }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, filePath);
}

function dataPath(...parts: string[]): string {
  return path.join(env.DATA_DIR, ...parts);
}

export class JsonStorage {
  private usersFile = dataPath('users.json');
  private gamesFile = dataPath('games.json');
  private tournamentsFile = dataPath('tournaments.json');
  private applicationsFile = dataPath('tournament_applications.json');
  private bannedFile = dataPath('banned_users.json');
  private sessionsDir = dataPath('sessions');
  private nextOfferIdFile = dataPath('next_offer_id.json');
  private nextGameIdFile = dataPath('next_game_id.json');

  async init(): Promise<void> {
    await ensureDir(env.DATA_DIR);
    await ensureDir(this.sessionsDir);
    const defaults: [string, unknown][] = [
      [this.usersFile, {}],
      [this.gamesFile, []],
      [this.tournamentsFile, {}],
      [this.applicationsFile, []],
      [this.bannedFile, {}],
      [this.nextOfferIdFile, { id: 1 }],
      [this.nextGameIdFile, { id: 1 }],
    ];
    for (const [file, fallback] of defaults) {
      try {
        await fs.access(file);
      } catch {
        await writeJsonAtomic(file, fallback);
      }
    }
  }

  async getUsers(): Promise<Record<string, UserProfile>> {
    return readJson(this.usersFile, {});
  }

  async saveUsers(users: Record<string, UserProfile>): Promise<void> {
    await withLock('users', () => writeJsonAtomic(this.usersFile, users));
  }

  async getUser(userId: number): Promise<UserProfile | undefined> {
    const users = await this.getUsers();
    return users[String(userId)];
  }

  async saveUser(user: UserProfile): Promise<void> {
    await withLock('users', async () => {
      const users = await readJson<Record<string, UserProfile>>(this.usersFile, {});
      users[String(user.max_user_id)] = user;
      await writeJsonAtomic(this.usersFile, users);
    });
  }

  async deleteUser(userId: number): Promise<void> {
    await withLock('users', async () => {
      const users = await readJson<Record<string, UserProfile>>(this.usersFile, {});
      delete users[String(userId)];
      await writeJsonAtomic(this.usersFile, users);
    });
  }

  async getGames(): Promise<CompletedGame[]> {
    return readJson(this.gamesFile, []);
  }

  async saveGames(games: CompletedGame[]): Promise<void> {
    await withLock('games', () => writeJsonAtomic(this.gamesFile, games));
  }

  async getTournaments(): Promise<Record<string, Tournament>> {
    return readJson(this.tournamentsFile, {});
  }

  async saveTournaments(tournaments: Record<string, Tournament>): Promise<void> {
    await withLock('tournaments', () => writeJsonAtomic(this.tournamentsFile, tournaments));
  }

  async getTournament(id: string): Promise<Tournament | undefined> {
    const all = await this.getTournaments();
    return all[id];
  }

  async saveTournament(t: Tournament): Promise<void> {
    await withLock('tournaments', async () => {
      const all = await readJson<Record<string, Tournament>>(this.tournamentsFile, {});
      all[t.id] = t;
      await writeJsonAtomic(this.tournamentsFile, all);
    });
  }

  async getApplications(): Promise<TournamentApplication[]> {
    return readJson(this.applicationsFile, []);
  }

  async saveApplications(apps: TournamentApplication[]): Promise<void> {
    await withLock('applications', () => writeJsonAtomic(this.applicationsFile, apps));
  }

  async getBanned(): Promise<Record<string, BannedUser>> {
    return readJson(this.bannedFile, {});
  }

  async saveBanned(banned: Record<string, BannedUser>): Promise<void> {
    await withLock('banned', () => writeJsonAtomic(this.bannedFile, banned));
  }

  async isBanned(userId: number): Promise<boolean> {
    const banned = await this.getBanned();
    return Boolean(banned[String(userId)]);
  }

  async banUser(
    userId: number,
    reason: string,
    extra: Partial<BannedUser> = {},
  ): Promise<void> {
    await withLock('banned', async () => {
      const banned = await readJson<Record<string, BannedUser>>(this.bannedFile, {});
      banned[String(userId)] = {
        reason,
        banned_at: new Date().toISOString(),
        ...extra,
      };
      await writeJsonAtomic(this.bannedFile, banned);
    });
  }

  async clearAllBans(): Promise<void> {
    await this.saveBanned({});
  }

  async unbanUser(userId: number): Promise<void> {
    await withLock('banned', async () => {
      const banned = await readJson<Record<string, BannedUser>>(this.bannedFile, {});
      delete banned[String(userId)];
      await writeJsonAtomic(this.bannedFile, banned);
    });
  }

  sessionPath(userId: number): string {
    return path.join(this.sessionsDir, `${userId}.json`);
  }

  async getSession(userId: number): Promise<UserSession> {
    return readJson(this.sessionPath(userId), { data: {} });
  }

  async saveSession(userId: number, session: UserSession): Promise<void> {
    await withLock(`session:${userId}`, () => writeJsonAtomic(this.sessionPath(userId), session));
  }

  async clearSession(userId: number): Promise<void> {
    try {
      await fs.unlink(this.sessionPath(userId));
    } catch {
      /* ignore */
    }
  }

  async nextOfferId(): Promise<number> {
    return withLock('offer_id', async () => {
      const data = await readJson<{ id: number }>(this.nextOfferIdFile, { id: 1 });
      const id = data.id;
      data.id += 1;
      await writeJsonAtomic(this.nextOfferIdFile, data);
      return id;
    });
  }

  async nextCompletedGameId(): Promise<string> {
    return withLock('game_id', async () => {
      const data = await readJson<{ id: number }>(this.nextGameIdFile, { id: 1 });
      const id = String(data.id);
      data.id += 1;
      await writeJsonAtomic(this.nextGameIdFile, data);
      return id;
    });
  }

  async listAllUserIds(): Promise<number[]> {
    const users = await this.getUsers();
    return Object.keys(users).map(Number);
  }
}

export const storage = new JsonStorage();
