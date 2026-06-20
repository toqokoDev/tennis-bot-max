import { NTRP_RATING_POINTS, ratingPointsToLevel } from '../config/profile.js';

const K_FACTOR = 32;

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function calculateNewRatings(
  winnerRating: number,
  loserRating: number,
): { winner: number; loser: number } {
  const expectedWinner = expectedScore(winnerRating, loserRating);
  const expectedLoser = expectedScore(loserRating, winnerRating);
  return {
    winner: Math.round(winnerRating + K_FACTOR * (1 - expectedWinner)),
    loser: Math.round(loserRating + K_FACTOR * (0 - expectedLoser)),
  };
}

export function clampRating(points: number): number {
  return Math.max(500, Math.min(2800, points));
}

export function pointsToNtrp(points: number): string {
  return ratingPointsToLevel(points);
}

export function ntrpToPoints(level: string): number {
  return NTRP_RATING_POINTS[level] ?? 1200;
}

export function applyRatingUpdate(
  winnerPoints: number,
  loserPoints: number,
): { winnerPoints: number; loserPoints: number; winnerLevel: string; loserLevel: string } {
  const { winner, loser } = calculateNewRatings(winnerPoints, loserPoints);
  const w = clampRating(winner);
  const l = clampRating(loser);
  return {
    winnerPoints: w,
    loserPoints: l,
    winnerLevel: pointsToNtrp(w),
    loserLevel: pointsToNtrp(l),
  };
}
