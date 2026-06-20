import type { AppContext } from '../context.js';
import { storage } from '../storage/jsonStorage.js';
import { grantSubscriptionMonth } from '../utils/tournamentLifecycle.js';

export async function processReferralOnRegistration(ctx: AppContext): Promise<void> {
  const refId = ctx.session.referral_id;
  if (!refId) return;
  const referrer = await storage.getUser(refId);
  if (!referrer) return;
  referrer.referrals_invited += 1;
  if (referrer.referrals_invited >= 5) {
    referrer.subscription = {
      active: true,
      until: grantSubscriptionMonth(),
    };
    referrer.referrals_invited = 0;
  }
  await storage.saveUser(referrer);
}
