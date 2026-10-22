import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  // Never log personal data: request bodies are not logged and these keys are redacted.
  redact: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.healthFlags', '*.unwellInstructions'],
});
