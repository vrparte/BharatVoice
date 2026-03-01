import { createHash } from 'crypto';
import { appendFile, mkdir } from 'fs/promises';
import path from 'path';

import { config } from '../../config';
import { logger } from '../../utils/logger';

export type IAnalyticsEventType =
  | 'demo_started'
  | 'message_sent'
  | 'message_received'
  | 'error_occurred'
  | 'demo_completed'
  | 'conversion_clicked';

export interface IAnalyticsEventBase {
  readonly type: IAnalyticsEventType;
  readonly timestamp: string;
  readonly sessionId?: string;
}

export interface IDemoStartedEvent extends IAnalyticsEventBase {
  readonly type: 'demo_started';
  readonly vertical: 'dental' | 'auto' | 'legal';
  readonly referrer: string;
  readonly country: string;
  readonly city: string;
  readonly ipHash: string;
}

export interface IMessageSentEvent extends IAnalyticsEventBase {
  readonly type: 'message_sent';
  readonly sessionId: string;
  readonly messageLength: number;
  readonly latencyMs: number;
}

export interface IMessageReceivedEvent extends IAnalyticsEventBase {
  readonly type: 'message_received';
  readonly sessionId: string;
  readonly responseLength: number;
  readonly ttsLatencyMs: number;
}

export interface IErrorOccurredEvent extends IAnalyticsEventBase {
  readonly type: 'error_occurred';
  readonly sessionId?: string;
  readonly errorType: string;
  readonly recoverySuccess: boolean;
  readonly category: 'client' | 'network' | 'server' | 'user';
}

export interface IDemoCompletedEvent extends IAnalyticsEventBase {
  readonly type: 'demo_completed';
  readonly sessionId: string;
  readonly durationSeconds: number;
  readonly turnCount: number;
  readonly outcome: 'completed' | 'dropped' | 'error' | 'converted';
}

export interface IConversionClickedEvent extends IAnalyticsEventBase {
  readonly type: 'conversion_clicked';
  readonly sessionId?: string;
  readonly ctaType: 'pricing' | 'contact';
}

export type IAnalyticsEvent =
  | IDemoStartedEvent
  | IMessageSentEvent
  | IMessageReceivedEvent
  | IErrorOccurredEvent
  | IDemoCompletedEvent
  | IConversionClickedEvent;

export interface IAnalyticsDashboard {
  readonly today: {
    readonly demosStarted: number;
    readonly avgDurationSeconds: number;
    readonly conversionRate: number;
  };
  readonly topVerticals: readonly { readonly vertical: string; readonly count: number }[];
  readonly errorRates: readonly { readonly category: string; readonly count: number; readonly rate: number }[];
  readonly geographicDistribution: readonly { readonly city: string; readonly count: number }[];
}

export interface IAnalyticsStore {
  track(event: IAnalyticsEvent): Promise<void>;
  getDashboard(now?: Date): Promise<IAnalyticsDashboard>;
  cleanupExpiredSessions(now?: Date): Promise<void>;
}

type IStorageBackend = 'console' | 'ga4' | 'postgresql';

const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const todayDateKey = (timestamp: string): string => {
  return timestamp.slice(0, 10);
};

const nowIso = (): string => new Date().toISOString();

const hashIp = (ip: string): string => {
  return createHash('sha256').update(ip).digest('hex');
};

const safeNumber = (value: number): number => (Number.isFinite(value) ? value : 0);

class InMemoryEventStore implements IAnalyticsStore {
  protected readonly events: IAnalyticsEvent[] = [];

  public async track(event: IAnalyticsEvent): Promise<void> {
    this.events.push(event);
    await this.cleanupExpiredSessions();
  }

  public getDashboard(now: Date = new Date()): Promise<IAnalyticsDashboard> {
    const today = now.toISOString().slice(0, 10);
    const todayEvents = this.events.filter((event) => todayDateKey(event.timestamp) === today);
    const started = todayEvents.filter((event) => event.type === 'demo_started');
    const completed = todayEvents.filter(
      (event): event is IDemoCompletedEvent => event.type === 'demo_completed'
    );
    const conversions = todayEvents.filter((event) => event.type === 'conversion_clicked');

    const verticalMap = new Map<string, number>();
    for (const event of started) {
      verticalMap.set(event.vertical, (verticalMap.get(event.vertical) ?? 0) + 1);
    }

    const errorEvents = todayEvents.filter(
      (event): event is IErrorOccurredEvent => event.type === 'error_occurred'
    );
    const errorMap = new Map<string, number>();
    for (const event of errorEvents) {
      errorMap.set(event.category, (errorMap.get(event.category) ?? 0) + 1);
    }

    const cityMap = new Map<string, number>();
    for (const event of started) {
      cityMap.set(event.city, (cityMap.get(event.city) ?? 0) + 1);
    }

    const avgDuration =
      completed.length > 0
        ? safeNumber(completed.reduce((sum, item) => sum + item.durationSeconds, 0) / completed.length)
        : 0;
    const conversionRate =
      started.length > 0 ? safeNumber(Number(((conversions.length / started.length) * 100).toFixed(2))) : 0;

    return Promise.resolve({
      today: {
        demosStarted: started.length,
        avgDurationSeconds: Number(avgDuration.toFixed(2)),
        conversionRate
      },
      topVerticals: [...verticalMap.entries()]
        .map(([vertical, count]) => ({ vertical, count }))
        .sort((a, b) => b.count - a.count),
      errorRates: [...errorMap.entries()].map(([category, count]) => ({
        category,
        count,
        rate: started.length > 0 ? Number(((count / started.length) * 100).toFixed(2)) : 0
      })),
      geographicDistribution: [...cityMap.entries()]
        .map(([city, count]) => ({ city, count }))
        .sort((a, b) => b.count - a.count)
    });
  }

  public cleanupExpiredSessions(now: Date = new Date()): Promise<void> {
    const cutoff = now.getTime() - EVENT_RETENTION_MS;
    const filtered = this.events.filter((event) => new Date(event.timestamp).getTime() >= cutoff);
    if (filtered.length === this.events.length) {
      return Promise.resolve();
    }
    this.events.length = 0;
    this.events.push(...filtered);
    return Promise.resolve();
  }
}

class DevelopmentAnalyticsStore extends InMemoryEventStore {
  private readonly outputFile: string;

  public constructor(outputFile: string) {
    super();
    this.outputFile = outputFile;
  }

  public override async track(event: IAnalyticsEvent): Promise<void> {
    await super.track(event);
    logger.info('Web demo analytics event', {
      eventType: 'web_demo.analytics',
      analyticsEvent: event
    });

    await mkdir(path.dirname(this.outputFile), { recursive: true });
    await appendFile(this.outputFile, `${JSON.stringify(event)}\n`, 'utf8');
  }
}

class Ga4AnalyticsStore extends InMemoryEventStore {
  private readonly measurementId: string;
  private readonly apiSecret: string;

  public constructor(measurementId: string, apiSecret: string) {
    super();
    this.measurementId = measurementId;
    this.apiSecret = apiSecret;
  }

  public override async track(event: IAnalyticsEvent): Promise<void> {
    await super.track(event);

    const sessionKey = event.sessionId ?? 'anonymous';
    const payload = {
      client_id: `bv.${sessionKey}`,
      events: [
        {
          name: event.type,
          params: {
            ...event
          }
        }
      ]
    };

    try {
      await fetch(
        `https://www.google-analytics.com/mp/collect?measurement_id=${this.measurementId}&api_secret=${this.apiSecret}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify(payload)
        }
      );
    } catch (error: unknown) {
      logger.warn('GA4 analytics event publish failed', {
        eventType: 'web_demo.analytics.ga4_failed',
        error: error instanceof Error ? error.message : 'Unknown GA4 error'
      });
    }
  }
}

class PostgresAnalyticsStore extends InMemoryEventStore {
  private readonly connectionString: string;

  private initialized = false;
  private unavailable = false;
  private insertFn: ((event: IAnalyticsEvent) => Promise<void>) | null = null;

  public constructor(connectionString: string) {
    super();
    this.connectionString = connectionString;
  }

  private async initialize(): Promise<void> {
    if (this.initialized || this.unavailable) {
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pgModule = require('pg') as {
        readonly Pool: new (input: { connectionString: string }) => {
          query: (sql: string, values?: unknown[]) => Promise<unknown>;
        };
      };
      const pool = new pgModule.Pool({ connectionString: this.connectionString });
      await pool.query(
        'CREATE TABLE IF NOT EXISTS web_demo_analytics_events (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL, event_type TEXT NOT NULL, session_id TEXT NULL, payload JSONB NOT NULL)'
      );

      this.insertFn = async (event: IAnalyticsEvent): Promise<void> => {
        await pool.query(
          'INSERT INTO web_demo_analytics_events (created_at, event_type, session_id, payload) VALUES ($1, $2, $3, $4::jsonb)',
          [event.timestamp, event.type, event.sessionId ?? null, JSON.stringify(event)]
        );
      };
      this.initialized = true;
    } catch (error: unknown) {
      this.unavailable = true;
      logger.warn('Postgres analytics unavailable, continuing with in-memory analytics only', {
        eventType: 'web_demo.analytics.postgres_unavailable',
        error: error instanceof Error ? error.message : 'Unknown postgres analytics error'
      });
    }
  }

  public override async track(event: IAnalyticsEvent): Promise<void> {
    await super.track(event);
    await this.initialize();
    if (!this.insertFn) {
      return;
    }
    await this.insertFn(event);
  }
}

export const resolveStorageBackend = (): IStorageBackend => {
  return config.demo.analyticsProvider;
};

export const createAnalyticsStore = (): IAnalyticsStore => {
  const backend = resolveStorageBackend();
  if (backend === 'ga4') {
    const measurementId = config.bvEnv.BV_GA4_MEASUREMENT_ID ?? '';
    const apiSecret = config.bvEnv.BV_GA4_API_SECRET ?? '';
    if (measurementId && apiSecret) {
      return new Ga4AnalyticsStore(measurementId, apiSecret);
    }
    logger.warn('GA4 backend selected but credentials are missing, falling back to development analytics store', {
      eventType: 'web_demo.analytics.ga4_config_missing'
    });
    return new DevelopmentAnalyticsStore(path.resolve(process.cwd(), 'logs', 'web-demo-analytics.jsonl'));
  }

  if (backend === 'postgresql') {
    if (config.integrations.database.url) {
      return new PostgresAnalyticsStore(config.integrations.database.url);
    }
    logger.warn(
      'Postgres analytics backend selected but BV_DATABASE_URL missing, falling back to development analytics store',
      {
        eventType: 'web_demo.analytics.postgres_config_missing'
      }
    );
  }

  return new DevelopmentAnalyticsStore(path.resolve(process.cwd(), 'logs', 'web-demo-analytics.jsonl'));
};

export const createDemoStartedEvent = (input: {
  readonly sessionId: string;
  readonly vertical: 'dental' | 'auto' | 'legal';
  readonly referrer: string;
  readonly country: string;
  readonly city: string;
  readonly ipAddress: string;
}): IDemoStartedEvent => ({
  type: 'demo_started',
  timestamp: nowIso(),
  sessionId: input.sessionId,
  vertical: input.vertical,
  referrer: input.referrer,
  country: input.country,
  city: input.city,
  ipHash: hashIp(input.ipAddress)
});
