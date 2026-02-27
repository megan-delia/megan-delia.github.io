import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid postgresql:// URL' }),
  PORTAL_JWT_SECRET: z.string().min(16, {
    message: 'PORTAL_JWT_SECRET must be at least 16 characters',
  }),
});

export type AppConfig = z.infer<typeof configSchema>;

// Called by ConfigModule.forRoot({ validate }) -- throws at startup if any var is missing or invalid
export function validate(config: Record<string, unknown>): AppConfig {
  const result = configSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${issues}`);
  }
  return result.data;
}
