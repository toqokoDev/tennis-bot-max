import { env, getDeepLink } from '../config/env.js';
import { TXT, fmt } from '../texts.js';

export type ProLockFeature =
  | 'contacts'
  | 'all_players'
  | 'enter_score'
  | 'game_history';

/** Сообщение «доступ закрыт» в стиле TennisBot (Telegram). */
export function formatProLockedMessage(feature: ProLockFeature, userId: number): string {
  const referralLink = getDeepLink(`ref_${userId}`);
  const featureLine = TXT.subscription_lock.features[feature];
  return [
    TXT.subscription_lock.title,
    '',
    featureLine,
    '',
    fmt(TXT.subscription_lock.price, { price: env.SUBSCRIPTION_PRICE }),
    TXT.subscription_lock.go_to_payments,
    '',
    TXT.subscription_lock.invite_friends,
    '',
    `${TXT.subscription_lock.invite_link} <code>${referralLink}</code>`,
    '',
    TXT.subscription_lock.invite_stats,
  ].join('\n');
}
