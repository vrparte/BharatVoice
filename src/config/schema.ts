import { z } from 'zod';

const nonEmptyString = (fieldName: string): z.ZodString =>
  z
    .string({
      required_error: `${fieldName} is required.`
    })
    .trim()
    .min(1, `${fieldName} is required and cannot be empty.`);

export const nodeEnvSchema = z.enum(['development', 'production', 'test']);

export const envSchema = z
  .object({
    NODE_ENV: nodeEnvSchema.default('development'),
    BV_PORT: z.coerce.number().int().positive().optional(),
    PORT: z.coerce.number().int().positive().optional(),
    BV_LOG_LEVEL: z.string().trim().min(1).optional(),
    LOG_LEVEL: z.string().trim().min(1).optional(),
    BV_SARVAM_API_KEY: nonEmptyString('BV_SARVAM_API_KEY'),
    BV_EXOTEL_SID: nonEmptyString('BV_EXOTEL_SID'),
    BV_EXOTEL_TOKEN: nonEmptyString('BV_EXOTEL_TOKEN'),
    BV_DATABASE_URL: nonEmptyString('BV_DATABASE_URL'),
    BV_N8N_WEBHOOK_URL: z.string().trim().min(1).optional()
  })
  .passthrough();

export type IValidatedEnv = z.infer<typeof envSchema>;
