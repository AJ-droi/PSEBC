import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (Neon connection string)'),
  JWT_SECRET: z.string().min(24, 'JWT_SECRET must be at least 24 characters'),
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  RUN_SCHEDULER: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  JOBS_SECRET: z.string().optional().default(''),
  NOTIFY_EMAIL_DRIVER: z.enum(['console', 'webhook', 'none']).default('console'),
  NOTIFY_SMS_DRIVER: z.enum(['console', 'webhook', 'none']).default('console'),
  NOTIFY_WEBHOOK_URL: z.string().optional().default(''),
  REPORTS_SHOW_MEMBER_NAMES: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: re-read process.env after it is changed. */
export function resetEnvCache(): void {
  cached = null;
}
