import winston from 'winston';
import { env } from './config/env.js';

const SKIP_CTOR = /^(TLSSocket|Socket|ClientRequest|IncomingMessage|Agent|Stream|ServerResponse)$/;

function sanitizeLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (typeof value !== 'object') return value;

  if (value instanceof Error) {
    const err = value as Error & { code?: string; response?: { status?: number; data?: unknown } };
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(err.code ? { code: err.code } : {}),
      ...(err.response
        ? {
          status: err.response.status,
          responseData: sanitizeLogValue(err.response.data, seen),
        }
        : {}),
    };
  }

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  const ctor = (value as object).constructor?.name;
  if (ctor && SKIP_CTOR.test(ctor)) return `[${ctor}]`;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'socket' || key === 'agent' || key === 'request' || key === '_httpMessage') {
      out[key] = nested && typeof nested === 'object'
        ? `[${(nested as object).constructor?.name ?? 'Object'}]`
        : nested;
      continue;
    }
    out[key] = sanitizeLogValue(nested, seen);
  }
  return out;
}

function formatMeta(rest: Record<string, unknown>): string {
  const metaKeys = Object.keys(rest).filter((k) => k !== 'splat' && !k.startsWith('Symbol('));
  if (!metaKeys.length) return '';
  try {
    return ` ${JSON.stringify(sanitizeLogValue(rest))}`;
  } catch {
    return ' [unserializable meta]';
  }
}

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack, ...rest }) => {
      const meta = formatMeta(rest as Record<string, unknown>);
      return stack
        ? `${timestamp} [${level}] ${message}${meta}\n${stack}`
        : `${timestamp} [${level}] ${message}${meta}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});
