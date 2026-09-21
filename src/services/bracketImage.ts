import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import type { Api } from '@maxhub/max-bot-api';
import type { AttachmentRequest } from '@maxhub/max-bot-api/types';
import { env } from '../config/env.js';
import { storage } from '../storage/jsonStorage.js';
import type { Tournament } from '../types/models.js';
import { generateOlympicBracket, type BracketMatch, type BracketTree } from '../utils/bracket/index.js';
import { ensureSeeding } from '../utils/tournamentLifecycle.js';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts', 'bracket', 'generate_bracket.py');
const CACHE_DIR = path.join(env.DATA_DIR, 'brackets');
const AVATAR_CACHE_DIR = path.join(env.DATA_DIR, 'avatars');

/**
 * Profile photos are stored as remote URLs (MAX CDN / tennis-play.com), but the
 * Python bracket renderer can only draw local files. Download and cache each
 * photo locally so the bracket image can actually show it instead of silently
 * falling back to initials. Cache key is a hash of the URL, so a changed photo
 * gets its own file automatically.
 */
async function resolveAvatarPath(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    const hash = crypto.createHash('md5').update(url).digest('hex');
    const ext = path.extname(new URL(url).pathname).slice(0, 5) || '.jpg';
    const filePath = path.join(AVATAR_CACHE_DIR, `${hash}${ext}`);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // not cached yet, fall through to download
    }
    await fs.mkdir(AVATAR_CACHE_DIR, { recursive: true });
    const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 15000 });
    await fs.writeFile(filePath, Buffer.from(res.data));
    return filePath;
  } catch (err) {
    logger.warn('Failed to cache avatar for bracket image', { err: String(err), url });
    return null;
  }
}

type BracketPlayer = { id: string; name: string; photo_path?: string | null };
type BracketRoundMatch = {
  player1_id?: string | null;
  player2_id?: string | null;
  winner_id?: string | null;
  score?: string | null;
  is_bye?: boolean;
};

function resolvePythonBin(): string {
  return process.env.PYTHON_PATH || process.env.BRACKET_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

async function runPython(inputPath: string, outputPath: string): Promise<void> {
  const bin = resolvePythonBin();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, [SCRIPT, '--input', inputPath, '--output', outputPath], {
      cwd: ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Bracket script exited with ${code}: ${stderr || stdout || 'no output'}`));
    });
  });
}

function roundsFromBracket(bracket: BracketTree | undefined): BracketRoundMatch[][] {
  if (!bracket?.rounds?.length) return [];
  return bracket.rounds.map((round: BracketMatch[]) =>
    round.map((m) => ({
      player1_id: m.player1 != null ? String(m.player1) : null,
      player2_id: m.player2 != null ? String(m.player2) : null,
      winner_id: m.winner != null ? String(m.winner) : null,
      score: m.score?.length ? m.score.join(', ') : null,
      is_bye: (m.player1 == null) !== (m.player2 == null),
    })),
  );
}

async function buildPayload(tourn: Tournament): Promise<Record<string, unknown>> {
  const users = await storage.getUsers();
  const players: BracketPlayer[] = await Promise.all(
    Object.values(tourn.participants).map(async (p) => {
      const u = users[String(p.user_id)];
      const avatarPath = await resolveAvatarPath(u?.photo_path);
      return {
        id: String(p.user_id),
        name: p.name || `${u?.first_name ?? ''} ${u?.last_name ?? ''}`.trim() || String(p.user_id),
        photo_path: avatarPath,
        photo_url: avatarPath,
      };
    }),
  );

  const games = await storage.getGames();
  const completed_games = games
    .filter((g) => g.tournament_id === tourn.id)
    .map((g) => {
      const [a, b] = g.players;
      return {
        players: {
          team1: a != null ? [String(a)] : [],
          team2: b != null ? [String(b)] : [],
        },
        score: (g.sets || []).join(', '),
        winner_id: g.winner_ids?.[0] != null ? String(g.winner_ids[0]) : null,
      };
    });

  // Пока турнир не стартовал официально, tourn.bracket ещё не сохранён — строим
  // предпросмотр сетки по уже заявленным участникам, чтобы сетка была видна сразу,
  // а не только после набора минимума и явного запуска турнира.
  const savedBracket = tourn.bracket as unknown as BracketTree | undefined;
  const previewBracket = !savedBracket && tourn.type === 'Олимпийская система'
    ? generateOlympicBracket(ensureSeeding(tourn).map(Number))
    : undefined;
  const rounds = roundsFromBracket(savedBracket ?? previewBracket);

  return {
    name: tourn.name,
    type: tourn.type,
    hide_bracket: Boolean(tourn.hide_bracket),
    participants_count: tourn.participants_count || 8,
    players,
    rounds,
    completed_games,
  };
}

/** Generate bracket PNG on disk; returns absolute path or null on failure. */
export async function generateBracketImageFile(tourn: Tournament): Promise<string | null> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const payload = await buildPayload(tourn);
    const stamp = Date.now();
    const inputPath = path.join(os.tmpdir(), `bracket_${tourn.id}_${stamp}.json`);
    const outputPath = path.join(CACHE_DIR, `${tourn.id}_${stamp}.png`);
    await fs.writeFile(inputPath, JSON.stringify(payload), 'utf-8');
    try {
      await runPython(inputPath, outputPath);
    } finally {
      await fs.unlink(inputPath).catch(() => undefined);
    }
    return outputPath;
  } catch (err) {
    logger.warn('Failed to generate bracket image', { err: String(err), tournamentId: tourn.id });
    return null;
  }
}

/** Upload bracket image and return MAX attachment request, or null. */
export async function uploadBracketImage(api: Api, tourn: Tournament): Promise<AttachmentRequest | null> {
  const filePath = await generateBracketImageFile(tourn);
  if (!filePath) return null;
  try {
    // Buffer upload is more reliable than ReadStream on Windows
    const buffer = await fs.readFile(filePath);
    const uploaded = await api.uploadImage({ source: buffer });
    const json = uploaded.toJson() as AttachmentRequest;
    if (!json || json.type !== 'image') {
      logger.warn('Unexpected bracket upload payload', { tournamentId: tourn.id, json });
      return null;
    }
    return json;
  } catch (err) {
    logger.warn('Failed to upload bracket image', {
      err: err instanceof Error ? err.message : String(err),
      tournamentId: tourn.id,
    });
    return null;
  } finally {
    await fs.unlink(filePath).catch(() => undefined);
  }
}
