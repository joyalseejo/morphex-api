import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

const envSchema = z.object({
  PORT: z
    .string()
    .default('3000')
    .transform(Number)
    .refine((n) => n > 0 && n < 65536, 'PORT must be a valid port number'),

  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL is required (Prisma connection string)' })
    .min(1),

  DIRECT_URL: z
    .string({ required_error: 'DIRECT_URL is required (non-pooled connection for migrations)' })
    .min(1),

  REDIS_URL: z
    .string({ required_error: 'REDIS_URL is required (BullMQ / rate-limiting)' })
    .url('REDIS_URL must be a valid URL, e.g. redis://localhost:6379'),

  ANTHROPIC_API_KEY: z
    .string({ required_error: 'ANTHROPIC_API_KEY is required' })
    .startsWith('sk-ant-', 'ANTHROPIC_API_KEY must start with sk-ant-'),

  JWT_SECRET: z
    .string({ required_error: 'JWT_SECRET is required' })
    .min(32, 'JWT_SECRET must be at least 32 characters'),

  STRIPE_SECRET_KEY: z
    .string({ required_error: 'STRIPE_SECRET_KEY is required' })
    .min(1),

  STRIPE_WEBHOOK_SECRET: z
    .string({ required_error: 'STRIPE_WEBHOOK_SECRET is required' })
    .min(1),

  FRONTEND_URL: z
    .string({ required_error: 'FRONTEND_URL is required (CORS origin)' })
    .url('FRONTEND_URL must be a valid URL'),

  SENTRY_DSN: z.string().optional().default(''),
});

function parseConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `\n\nInvalid environment configuration — fix the following before starting:\n${issues}\n`
    );
  }

  return result.data;
}

export const config = parseConfig();

export const isDev = config.NODE_ENV === 'development';
export const isProd = config.NODE_ENV === 'production';
