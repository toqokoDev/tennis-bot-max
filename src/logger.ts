import winston from 'winston';
import { env } from './config/env.js';

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack }) => {
      return stack
        ? `${timestamp} [${level}] ${message}\n${stack}`
        : `${timestamp} [${level}] ${message}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});
