import { TXT, fmt } from '../texts.js';
import type { CompletedGame, UserProfile } from '../types/models.js';
import { formatGameResultSummary } from './gameResult.js';

export type ProfileViewContext = {
  userId: number;
  isOwn?: boolean;
  listBackPayload?: string;
};

export function saveProfileViewContext(
  ctx: { session: { data: Record<string, unknown> } },
  profile: UserProfile,
  options: { isOwn?: boolean; listBackPayload?: string } = {},
): void {
  ctx.session.data.profileViewContext = {
    userId: profile.max_user_id,
    isOwn: options.isOwn ?? false,
    listBackPayload: options.listBackPayload,
  } satisfies ProfileViewContext;
}

export function getProfileViewContext(ctx: { session: { data: Record<string, unknown> } }): ProfileViewContext | null {
  return (ctx.session.data.profileViewContext as ProfileViewContext | undefined) ?? null;
}

export function getGamesForUser(games: CompletedGame[], userId: number): CompletedGame[] {
  return games
    .filter((g) => g.players.includes(userId))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function formatGameDate(iso: string): string {
  const date = new Date(iso);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

function isUserWinner(game: CompletedGame, userId: number): boolean {
  return game.winner_ids.includes(userId);
}

export function formatGameHistoryCard(
  game: CompletedGame,
  targetUserId: number,
  users: Map<number, UserProfile>,
  index: number,
  total: number,
  options: { isAdmin?: boolean; tournamentName?: string } = {},
): string {
  const { isAdmin = false, tournamentName } = options;
  const won = isUserWinner(game, targetUserId);
  const result = won ? TXT.profile.history_win : TXT.profile.history_loss;
  const summary = formatGameResultSummary(game, users, { tournamentName });

  const lines = [
    fmt(TXT.profile.history_game_of, { current: index + 1, total }),
    '',
    fmt(TXT.profile.history_date, { date: formatGameDate(game.created_at) }),
    fmt(TXT.profile.history_result, { result }),
    '',
    summary,
  ];

  if (isAdmin) {
    lines.push('', fmt(TXT.profile.history_game_id, { id: game.id }));
  }

  return lines.join('\n');
}
