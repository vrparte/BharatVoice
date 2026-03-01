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
  readonly demo: {
    readonly mode: 'standalone' | 'embedded' | 'disabled';
    readonly wsPort: number;
    readonly ttlMinutes: number;
    readonly maxConcurrent: number;
    readonly analyticsProvider: 'console' | 'postgresql' | 'ga4';
    readonly corsOrigins: readonly string[];
    readonly features: {
      readonly analytics: boolean;
      readonly enabledVerticals: readonly ('dental' | 'auto' | 'legal')[];
    };
  };
  readonly bvEnv: Readonly<Record<string, string>>;
}

const DEMO_VERTICALS = ['dental', 'auto', 'legal'] as const;
type IDemoVertical = (typeof DEMO_VERTICALS)[number];

const collectBvEnv = (env: NodeJS.ProcessEnv): Record<string, string> => {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[0].startsWith('BV_') && typeof entry[1] === 'string'
    )
  );
};

const formatZodError = (error: { issues: { path: (string | number)[]; message: string }[] }): string => {
  const details = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'environment';
    return `- ${path}: ${issue.message}`;
  });

  return `Invalid BharatVoice environment configuration:\n${details.join('\n')}`;
};

const parseBooleanFlag = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) {
    return defaultValue;
  }
  return value.trim().toLowerCase() === 'true';
};

const parseCsv = (input: string | undefined): readonly string[] => {
  if (!input) {
    return [];
  }
  return input
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const parseEnabledVerticals = (input: string | undefined): readonly IDemoVertical[] => {
  const requested = parseCsv(input).map((item) => item.toLowerCase());
  if (requested.length === 0) {
    return DEMO_VERTICALS;
  }

  const selected = requested.filter((item): item is IDemoVertical =>
    DEMO_VERTICALS.includes(item as IDemoVertical)
  );
  return selected.length > 0 ? selected : DEMO_VERTICALS;
};

const resolveAnalyticsProvider = (
  validatedEnv: IValidatedEnv
): 'console' | 'postgresql' | 'ga4' => {
  if (validatedEnv.BV_ANALYTICS_PROVIDER) {
    return validatedEnv.BV_ANALYTICS_PROVIDER;
  }
  if (validatedEnv.BV_ANALYTICS_BACKEND === 'postgres') {
    return 'postgresql';
  }
  if (validatedEnv.BV_ANALYTICS_BACKEND === 'ga4') {
    return 'ga4';
  }
  return 'console';
};

const buildConfig = (validatedEnv: IValidatedEnv, bvEnv: Readonly<Record<string, string>>): IConfig => {
  const corsOrigins = parseCsv(validatedEnv.BV_CORS_ORIGINS);
  const analyticsProvider = resolveAnalyticsProvider(validatedEnv);

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
    demo: {
      mode: validatedEnv.BV_DEMO_MODE ?? 'standalone',
      wsPort: validatedEnv.BV_DEMO_WS_PORT ?? 3001,
      ttlMinutes: validatedEnv.BV_DEMO_TTL_MINUTES ?? 60,
      maxConcurrent: validatedEnv.BV_DEMO_MAX_CONCURRENT ?? 100,
      analyticsProvider,
      corsOrigins,
      features: {
        analytics: parseBooleanFlag(validatedEnv.BV_DEMO_ENABLE_ANALYTICS, true),
        enabledVerticals: parseEnabledVerticals(validatedEnv.BV_DEMO_ENABLED_VERTICALS)
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
