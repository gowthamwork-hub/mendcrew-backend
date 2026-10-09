import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:\/\//.test(value)),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  AUTH_MODE: z.enum(['otp', 'development']).default('otp'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://127.0.0.1:5173'),
  SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  OTP_PROVIDER_URL: z.url().optional(),
  OTP_PROVIDER_TOKEN: z.string().min(16).optional(),
  SUPPORT_CONTACT: z.string().optional(),
  WORKING_HOUR_START: z.coerce.number().int().min(0).max(23).optional(),
  WORKING_HOUR_END: z.coerce.number().int().min(1).max(24).optional(),
  BOOKING_LEAD_MINUTES: z.coerce.number().int().min(0).default(0),
  CANCELLATION_LEAD_MINUTES: z.coerce.number().int().min(0).default(0),
  PILOT_RULES_CONFIRMED: z.enum(['true', 'false']).default('false'),
});

export function readConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success)
    throw new Error(
      `Invalid environment keys: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  const config = result.data;
  if (
    (config.WORKING_HOUR_START === undefined) !==
      (config.WORKING_HOUR_END === undefined) ||
    (config.WORKING_HOUR_START !== undefined &&
      config.WORKING_HOUR_START >= config.WORKING_HOUR_END!)
  )
    throw new Error('Configure a valid start and end working hour');
  if (config.NODE_ENV === 'production') {
    if (
      config.AUTH_MODE !== 'otp' ||
      !config.OTP_PROVIDER_URL?.startsWith('https://') ||
      !config.OTP_PROVIDER_TOKEN
    )
      throw new Error(
        'Production requires a configured HTTPS OTP provider; development authentication is forbidden',
      );
    if (
      config.PILOT_RULES_CONFIRMED !== 'true' ||
      !config.SUPPORT_CONTACT ||
      config.WORKING_HOUR_START === undefined
    )
      throw new Error(
        'Production requires confirmed pilot rules, support contact and working hours',
      );
    if (
      !process.env.BOOKING_LEAD_MINUTES?.trim() ||
      !process.env.CANCELLATION_LEAD_MINUTES?.trim()
    )
      throw new Error(
        'Production requires explicit booking notice and cancellation rules',
      );
    if (
      !config.CORS_ORIGINS.split(',').every((origin) =>
        origin.trim().startsWith('https://'),
      )
    )
      throw new Error('Production CORS origins must use HTTPS');
  }
  return config;
}
export type PilotConfig = ReturnType<typeof readConfig>;
export const serviceAreas = ['Nagercoil', 'Suchindram'] as const;
