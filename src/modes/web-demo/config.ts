import net from 'net';

import { config } from '../../config';
import { logger } from '../../utils/logger';

import type { IWebDemoVertical } from './session-store';

export interface IWebDemoModeConfig {
  readonly mode: 'standalone' | 'embedded' | 'disabled';
  readonly port: number;
  readonly sessionTtlMinutes: number;
  readonly maxConcurrent: number;
  readonly corsOrigins: readonly string[];
  readonly analytics: {
    readonly enabled: boolean;
    readonly provider: 'console' | 'postgresql' | 'ga4';
  };
  readonly featureFlags: {
    readonly verticals: Readonly<Record<IWebDemoVertical, boolean>>;
  };
}

const DEFAULT_LOCAL_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
] as const;

const buildVerticalFlags = (
  enabled: readonly ('dental' | 'auto' | 'legal')[]
): Readonly<Record<IWebDemoVertical, boolean>> => ({
  dental: enabled.includes('dental'),
  auto: enabled.includes('auto'),
  legal: enabled.includes('legal')
});

const dedupeOrigins = (origins: readonly string[]): readonly string[] => {
  return [...new Set(origins)];
};

const ensurePortAvailable = async (port: number): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Web demo port ${port} is already in use.`));
        return;
      }
      reject(error);
    });

    server.once('listening', () => {
      server.close(() => resolve());
    });

    server.listen(port, '0.0.0.0');
  });
};

const validateDependencies = (demoConfig: IWebDemoModeConfig): void => {
  if (demoConfig.mode === 'disabled') {
    return;
  }

  if (config.integrations.sarvam.apiKey.trim().length === 0) {
    throw new Error('Web demo requires BV_SARVAM_API_KEY to be configured.');
  }

  if (demoConfig.analytics.enabled && demoConfig.analytics.provider === 'ga4') {
    const measurementId = config.bvEnv.BV_GA4_MEASUREMENT_ID ?? '';
    const apiSecret = config.bvEnv.BV_GA4_API_SECRET ?? '';
    if (measurementId.trim().length === 0 || apiSecret.trim().length === 0) {
      throw new Error(
        'Web demo analytics provider ga4 requires BV_GA4_MEASUREMENT_ID and BV_GA4_API_SECRET.'
      );
    }
  }

  if (demoConfig.mode === 'embedded' && demoConfig.corsOrigins.length === 0) {
    throw new Error('Embedded demo mode requires at least one BV_CORS_ORIGINS entry.');
  }
};

const buildDemoConfig = (): IWebDemoModeConfig => {
  const configuredOrigins = config.demo.corsOrigins;
  const mergedOrigins =
    config.demo.mode === 'embedded'
      ? dedupeOrigins(configuredOrigins)
      : dedupeOrigins([...DEFAULT_LOCAL_ORIGINS, ...configuredOrigins]);

  return {
    mode: config.demo.mode,
    port: config.demo.wsPort,
    sessionTtlMinutes: config.demo.ttlMinutes,
    maxConcurrent: config.demo.maxConcurrent,
    corsOrigins: mergedOrigins,
    analytics: {
      enabled: config.demo.features.analytics,
      provider: config.demo.analyticsProvider
    },
    featureFlags: {
      verticals: buildVerticalFlags(config.demo.features.enabledVerticals)
    }
  };
};

export const webDemoConfig: IWebDemoModeConfig = buildDemoConfig();

export const validateWebDemoStartup = async (): Promise<void> => {
  validateDependencies(webDemoConfig);

  if (webDemoConfig.mode === 'disabled') {
    logger.info('Web demo mode is disabled by configuration', {
      eventType: 'web_demo.config.disabled'
    });
    return;
  }

  await ensurePortAvailable(webDemoConfig.port);

  logger.info('Web demo configuration loaded', {
    eventType: 'web_demo.config.loaded',
    mode: webDemoConfig.mode,
    port: webDemoConfig.port,
    sessionTtlMinutes: webDemoConfig.sessionTtlMinutes,
    maxConcurrent: webDemoConfig.maxConcurrent,
    analyticsEnabled: webDemoConfig.analytics.enabled,
    analyticsProvider: webDemoConfig.analytics.provider,
    enabledVerticals: webDemoConfig.featureFlags.verticals,
    corsOriginsCount: webDemoConfig.corsOrigins.length
  });
};
