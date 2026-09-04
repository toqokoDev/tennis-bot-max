import { env, getDeepLink } from '../config/env.js';
import { TXT, fmt } from '../texts.js';

export type ProLockFeature =
  | 'contacts'
  | 'all_players'
  | 'enter_score'
  | 'game_history'
  | 'game_offers';

/** Сообщение «доступ закрыт» в стиле TennisBot (Telegram). */
export function formatProLockedMessage(feature: ProLockFeature, userId: number): string {
  const referralLink = getDeepLink(`ref_${userId}`);
  const featureLine = TXT.subscription_lock.features[feature];
  const lines: string[] = [
    TXT.subscription_lock.title,
    '',
  ];

  if (feature === 'game_offers') {
    lines.push(TXT.subscription_lock.free_offers_limit, '', featureLine, '');
  } else {
    lines.push(featureLine, '');
  }

  lines.push(
    fmt(TXT.subscription_lock.price, { price: env.SUBSCRIPTION_PRICE }),
    TXT.subscription_lock.go_to_payments,
    '',
    TXT.subscription_lock.invite_friends,
    '',
    `${TXT.subscription_lock.invite_link} <code>${referralLink}</code>`,
    '',
    TXT.subscription_lock.invite_stats,
  );

  return lines.join('\n');
}
