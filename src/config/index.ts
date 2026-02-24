import dotenv from 'dotenv';

import { envSchema, type IValidatedEnv } from './schema';

dotenv.config();

export type INodeEnv = 'development' | 'production' | 'test';

export interface IConfig {
  readonly env: INodeEnv;
  readonly server: {
    readonly port: number;
  };
  readonly logging: {
    readonly level: string;
  };
  readonly integrations: {
    readonly sarvam: {
      readonly apiKey: string;
    };
    readonly exotel: {
      readonly sid: string;
      readonly token: string;
    };
    readonly database: {
      readonly url: string;
    };
    readonly n8n: {
      readonly webhookUrl?: string;
    };
  };
  readonly bvEnv: Readonly<Record<string, string>>;
}

const collectBvEnv = (env: NodeJS.ProcessEnv): Record<string, string> => {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[0].startsWith('BV_') && typeof entry[1] === 'string'
    )
  );
};

const formatZodError = (error: { issues: Array<{ path: Array<string | number>; message: string }> }): string => {
  const details = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'environment';
    return `- ${path}: ${issue.message}`;
  });

  return `Invalid BharatVoice environment configuration:\n${details.join('\n')}`;
};

const buildConfig = (validatedEnv: IValidatedEnv, bvEnv: Readonly<Record<string, string>>): IConfig => {
  return {
    env: validatedEnv.NODE_ENV,
    server: {
      port: validatedEnv.BV_PORT ?? validatedEnv.PORT ?? 3000
    },
    logging: {
      level: validatedEnv.BV_LOG_LEVEL ?? validatedEnv.LOG_LEVEL ?? 'info'
    },
    integrations: {
      sarvam: {
        apiKey: validatedEnv.BV_SARVAM_API_KEY
      },
      exotel: {
        sid: validatedEnv.BV_EXOTEL_SID,
        token: validatedEnv.BV_EXOTEL_TOKEN
      },
      database: {
        url: validatedEnv.BV_DATABASE_URL
      },
      n8n: {
        webhookUrl: validatedEnv.BV_N8N_WEBHOOK_URL
      }
    },
    bvEnv
  };
};

const rawBvEnv = collectBvEnv(process.env);
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(formatZodError(parsedEnv.error));
}

export const config: IConfig = buildConfig(parsedEnv.data, rawBvEnv);
