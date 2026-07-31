import winston from 'winston';
import { env } from './config/env.js';

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack, ...rest }) => {
      const metaKeys = Object.keys(rest).filter((k) => !['splat', 'Symbol(level)'].includes(k));
      const meta = metaKeys.length
        ? ` ${JSON.stringify(rest, (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v))}`
        : '';
      return stack
        ? `${timestamp} [${level}] ${message}${meta}\n${stack}`
        : `${timestamp} [${level}] ${message}${meta}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});
