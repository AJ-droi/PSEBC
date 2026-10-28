import { z } from 'zod';
import { parseEnabledEpics } from '@psebc/shared';

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
  // Web Push (phone/desktop alerts with sound when the app is closed). Generate with `npx web-push generate-vapid-keys`.
  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
  VAPID_SUBJECT: z.string().optional().default('mailto:office@example.org'),
  // Which PRD epics are live, e.g. "1-3" for the Epics 1–3 demo, or "all". See packages/shared/src/release.ts.
  ENABLED_EPICS: z
    .string()
    .optional()
    .default('all')
    .transform((v, ctx) => {
      try {
        return parseEnabledEpics(v);
      } catch (e) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
        return z.NEVER;
      }
    }),
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
export const pushEnabled = () => !!(env().VAPID_PUBLIC_KEY && env().VAPID_PRIVATE_KEY);

export function resetEnvCache(): void {
  cached = null;
}
