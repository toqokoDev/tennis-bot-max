import type { AppContext } from '../context.js';

export function getCallbackPayload(ctx: AppContext): string {
  const payload = ctx.callback?.payload;
  if (!payload) throw new Error('No callback payload');
  return payload;
}
