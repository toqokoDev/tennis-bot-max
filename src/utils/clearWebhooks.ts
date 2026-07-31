import { logger } from '../logger.js';

const MAX_API_BASE = 'https://platform-api.max.ru';

type Subscription = {
  url?: string;
};

type SubscriptionsResponse = {
  subscriptions?: Subscription[];
};

/** Removes webhook subscriptions so long polling can receive updates. */
export async function clearWebhookSubscriptions(token: string): Promise<void> {
  const headers = { Authorization: token };

  try {
    const listRes = await fetch(`${MAX_API_BASE}/subscriptions`, { headers });
    if (!listRes.ok) {
      logger.warn('Failed to list webhook subscriptions', { status: listRes.status });
      return;
    }

    const data = (await listRes.json()) as SubscriptionsResponse;
    const subscriptions = data.subscriptions ?? [];

    if (subscriptions.length === 0) {
      logger.info('No webhook subscriptions to clear');
      return;
    }

    for (const sub of subscriptions) {
      if (!sub.url) continue;
      const delRes = await fetch(
        `${MAX_API_BASE}/subscriptions?url=${encodeURIComponent(sub.url)}`,
        { method: 'DELETE', headers },
      );
      if (delRes.ok) {
        logger.info('Cleared webhook subscription', { url: sub.url });
      } else {
        logger.warn('Failed to clear webhook subscription', {
          url: sub.url,
          status: delRes.status,
        });
      }
    }
  } catch (err) {
    logger.warn('Webhook cleanup failed', { err });
  }
}
