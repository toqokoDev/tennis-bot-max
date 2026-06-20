import { TXT, fmt } from '../texts.js';
import type { CompletedGame, RatingUpdate, UserProfile } from '../types/models.js';

export function fullName(user: UserProfile | undefined): string {
  if (!user) return '—';
  return `${user.first_name} ${user.last_name}`.trim();
}

export function formatRatingLine(name: string, oldPoints: number, newPoints: number): string {
  const delta = newPoints - oldPoints;
  const sign = delta > 0 ? '+' : '';
  return fmt(TXT.enter_score.rating_line, {
    name,
    old: oldPoints,
    new: newPoints,
    delta: `${sign}${delta}`,
  });
}

export function buildRatingUpdates(
  profiles: UserProfile[],
  beforePoints: number[],
): Record<string, RatingUpdate> {
  const updates: Record<string, RatingUpdate> = {};
  profiles.forEach((p, i) => {
    updates[String(p.max_user_id)] = { before: beforePoints[i], after: p.rating_points };
  });
  return updates;
}

export function formatRatingSection(
  updates: Record<string, RatingUpdate>,
  users: Map<number, UserProfile>,
  playerOrder: number[],
): string {
  const lines = playerOrder
    .filter((id) => updates[String(id)])
    .map((id) => {
      const u = updates[String(id)];
      return formatRatingLine(fullName(users.get(id)), u.before, u.after);
    });
  if (!lines.length) return '';
  return `\n\n${TXT.enter_score.rating_changes}\n${lines.join('\n')}`;
}

export function formatGameResultSummary(
  game: CompletedGame,
  users: Map<number, UserProfile>,
  options: { tournamentName?: string } = {},
): string {
  const score = game.sets.join(', ');
  let baseSummary: string;

  if (game.game_type === 'double' && game.players.length >= 4) {
    const [p0, p1, p2, p3] = game.players;
    baseSummary = fmt(TXT.enter_score.double_summary, {
      team1_p1: fullName(users.get(p0)),
      team1_p2: fullName(users.get(p1)),
      team2_p1: fullName(users.get(p2)),
      team2_p2: fullName(users.get(p3)),
      score,
    });
  } else if (game.game_type === 'tournament') {
    baseSummary = fmt(TXT.enter_score.tournament_summary, {
      tournament: options.tournamentName ?? game.tournament_id ?? '—',
      player1: fullName(users.get(game.players[0])),
      player2: fullName(users.get(game.players[1])),
      score,
    });
  } else {
    baseSummary = fmt(TXT.enter_score.single_summary, {
      player1: fullName(users.get(game.players[0])),
      player2: fullName(users.get(game.players[1])),
      score,
    });
  }

  if (game.rating_updates && Object.keys(game.rating_updates).length) {
    return `${baseSummary}${formatRatingSection(game.rating_updates, users, game.players)}`;
  }
  return baseSummary;
}
